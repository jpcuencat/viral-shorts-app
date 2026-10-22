import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import axios from 'axios'
import sharp from 'sharp'
import { z } from 'zod'
import type { Part } from '@google/generative-ai'
import { generateJson } from '@/lib/ai/gemini'
import { FFMPEG_PATH, FFPROBE_PATH, YTDLP_PATH } from '@/lib/media-config'
import { vaultStore, type VaultEntry } from '@/lib/vault-store'
import type { VisualResult } from '@/services/image-service'

const execFileAsync = promisify(execFile)

/**
 * MOTOR DE METRAJE REAL v4
 *
 * El motor anterior bajaba a ciegas un tramo fijo de 1-2 videos y lo rechazaba si tenía cualquier texto.
 * Este motor:
 *  1. Busca muchos candidatos SIN descargar (solo metadatos) y Gemini los ordena según la noticia.
 *  2. Mira el video COMPLETO a través de sus miniaturas de navegación (storyboards de YouTube) y
 *     Gemini marca los tramos que son metraje de campo limpio (sin presentador, sin gráficos).
 *  3. Descarga solo el tramo elegido para cada escena.
 *  4. En vez de rechazar por cintillos o logos, Gemini indica DÓNDE están y se recorta la zona limpia
 *     (el reel solo usa un recuadro ~1080x960 del video horizontal).
 *  5. Registra cada decisión en logs/footage.jsonl para poder ajustar con datos.
 */
export const FOOTAGE_GATE_VERSION = 'v4'

/** Relación de aspecto del primer plano del reel (1080x960). */
const TARGET_ASPECT = 1080 / 960
const OUT_W = 1080
const OUT_H = 960
const MAX_ANALYZED_PER_REEL = 8
const MAX_NEW_ANALYSES_PER_SCENE = 3
const MAX_TILES_PER_SHEET = 48
const MAX_TILES = 96
const TILE_W = 192
const TILE_H = 108

export interface StoryContext {
    title: string
    description?: string
    location?: string
    eventDate?: string
    factBrief?: string
    category?: string
}

interface Segment {
    key: string
    videoId: string
    videoTitle: string
    start: number
    end: number
    /** Hasta dónde ya se usó (para no repetir imágenes entre escenas). */
    usedUntil: number
    description: string
    relevance: number
    failed?: boolean
}

interface Candidate {
    id: string
    title: string
    channel: string
    duration: number
    score: number
    preferred: boolean
    analyzed: boolean
}

// ---------- Esquemas de respuesta de Gemini ----------
const RankSchema = z.looseObject({
    ranking: z.array(z.looseObject({
        index: z.coerce.number().int(),
        score: z.coerce.number().catch(0),
    })).default([]),
})

const StoryboardSchema = z.looseObject({
    video_kind: z.string().optional(),
    segments: z.array(z.looseObject({
        start_tile: z.coerce.number().int(),
        end_tile: z.coerce.number().int(),
        description: z.string().default(''),
        relevance: z.coerce.number().catch(5),
    })).default([]),
})

const PickSchema = z.looseObject({
    choice: z.coerce.number().int().catch(-1),
    reason: z.string().optional(),
})

const GateSchema = z.looseObject({
    is_real_footage: z.boolean().catch(false),
    is_relevant: z.boolean().catch(false),
    overlays: z.array(z.looseObject({
        label: z.string().optional(),
        box_2d: z.array(z.coerce.number()).min(4),
    })).default([]),
    reason: z.string().optional(),
})

type Box = { x0: number; y0: number; x1: number; y1: number }

// ---------- Utilidades ----------
function cleanQuery(q: string): string {
    return q.replace(/\b(en vivo|live|short|shorts)\b/gi, ' ').replace(/[^\p{L}\p{N}\s.-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function fmt(t: number): string {
    return `${t.toFixed(1)}s`
}

/**
 * Busca el recuadro más grande con la relación de aspecto del reel que no toque ningún texto/logo.
 * Coordenadas en píxeles del video original.
 */
export function findCleanCrop(W: number, H: number, boxes: Box[], aspect = TARGET_ASPECT): { x: number; y: number; w: number; h: number } | null {
    const margin = 0.015
    const expanded = boxes.map(b => ({
        x0: Math.max(0, b.x0 - W * margin), y0: Math.max(0, b.y0 - H * margin),
        x1: Math.min(W, b.x1 + W * margin), y1: Math.min(H, b.y1 + H * margin),
    }))
    const intersects = (x: number, y: number, w: number, h: number) =>
        expanded.some(b => x < b.x1 && x + w > b.x0 && y < b.y1 && y + h > b.y0)

    for (let f = 1.0; f >= 0.5 - 1e-9; f -= 0.05) {
        let h = H * f
        let w = h * aspect
        if (w > W) { w = W; h = W / aspect }
        const stepX = Math.max(1, W / 48)
        const stepY = Math.max(1, H / 48)
        let best: { x: number; y: number; d: number } | null = null
        for (let y = 0; y <= H - h + 0.5; y += stepY) {
            for (let x = 0; x <= W - w + 0.5; x += stepX) {
                if (intersects(x, y, w, h)) continue
                // Preferir el centro horizontal y la parte superior-media (donde suele estar la acción)
                const d = Math.abs(x + w / 2 - W / 2) / W + Math.abs(y + h / 2 - H * 0.45) / H
                if (!best || d < best.d) best = { x, y, d }
            }
        }
        if (best) {
            const even = (n: number) => Math.floor(n / 2) * 2
            const cw = Math.max(2, even(w))
            const ch = Math.max(2, even(h))
            return { x: Math.min(even(best.x), W - cw), y: Math.min(even(best.y), H - ch), w: cw, h: ch }
        }
    }
    return null
}

export class FootageFinder {
    private candidates = new Map<string, Candidate>()
    private segments: Segment[] = []
    private searched = new Set<string>()
    private analyzedCount = 0
    private storyboardOk = 0
    private readonly tempDir = path.join(process.cwd(), 'public', 'temp', 'footage')
    private readonly vaultDir = path.join(process.cwd(), 'public', 'ai-vault')
    private readonly logFile = path.join(process.cwd(), 'logs', 'footage.jsonl')
    private readonly runId = randomUUID().slice(0, 8)

    constructor(private story: StoryContext, opts: { preferredIds?: string[] } = {}) {
        for (const id of opts.preferredIds || []) {
            this.candidates.set(id, { id, title: '', channel: '', duration: 0, score: 11, preferred: true, analyzed: false })
        }
        fsSync.mkdirSync(this.tempDir, { recursive: true })
        fsSync.mkdirSync(path.dirname(this.logFile), { recursive: true })
    }

    /** true si al menos un video se pudo analizar por miniaturas (si es 0, conviene usar el motor anterior). */
    get hasWorkingStoryboards(): boolean {
        return this.storyboardOk > 0
    }

    private track(event: string, data: Record<string, unknown>) {
        try {
            fsSync.appendFileSync(this.logFile, JSON.stringify({ ts: new Date().toISOString(), run: this.runId, story: this.story.title.slice(0, 80), event, ...data }) + '\n')
        } catch { /* el registro nunca rompe la generación */ }
    }

    private storyBlock(): string {
        return [
            `NEWS STORY: "${this.story.title}"`,
            this.story.description ? `CONTEXT: "${this.story.description.slice(0, 400)}"` : '',
            this.story.location ? `PLACE: ${this.story.location}` : '',
            this.story.eventDate ? `DATE: ${this.story.eventDate}` : '',
            this.story.factBrief ? `VERIFIED FACTS:\n${this.story.factBrief.slice(0, 1200)}` : '',
        ].filter(Boolean).join('\n')
    }

    private ytArgs(extra: string[]): string[] {
        return [...extra, '--js-runtimes', 'node', '--no-warnings']
    }

    // ---------- 1. Búsqueda (solo metadatos) + ranking ----------
    private async search(query: string, mode: 'relevance' | 'date') {
        const q = cleanQuery(query)
        const key = `${mode}:${q.toLowerCase()}`
        if (!q || this.searched.has(key)) return
        this.searched.add(key)
        const input = mode === 'date' ? `ytsearchdate10:${q}` : `ytsearch15:${q}`
        let entries: any[] = []
        try {
            const { stdout } = await execFileAsync(YTDLP_PATH, this.ytArgs([input, '--flat-playlist', '-J']), { timeout: 45000, maxBuffer: 20 * 1024 * 1024 })
            entries = JSON.parse(stdout)?.entries || []
        } catch (err: any) {
            console.warn(`[Footage] Búsqueda fallida "${q}": ${String(err?.message || err).slice(0, 160)}`)
            this.track('search_error', { query: q, mode, error: String(err?.message || err).slice(0, 300) })
            return
        }
        const fresh: Candidate[] = []
        for (const e of entries) {
            const id = String(e?.id || '')
            if (!id || this.candidates.has(id)) continue
            const url = String(e?.url || '')
            const duration = Number(e?.duration) || 0
            if (url.includes('/shorts/')) continue
            if (e?.live_status === 'is_live' || e?.live_status === 'is_upcoming') continue
            if (duration && (duration < 40 || duration > 3600)) continue
            fresh.push({ id, title: String(e?.title || ''), channel: String(e?.channel || e?.uploader || ''), duration, score: 0, preferred: false, analyzed: false })
        }
        this.track('search', { query: q, mode, results: entries.length, kept: fresh.length })
        if (fresh.length === 0) return

        try {
            const prompt = `You select YouTube videos that may contain REAL FILMED FOOTAGE of a news story, for use as b-roll.
${this.storyBlock()}

Score each video 0-10:
- 8-10: news report / raw footage / official video clearly about THIS story (same people, place, event).
- 5-7: same topic or place, likely has usable field footage.
- 0-4: unrelated, another event, studio talk show, podcast, opinion/commentary, reaction video, compilation, music, gaming, slideshow.

VIDEOS:
${fresh.map((c, i) => `[${i}] "${c.title}" — channel: ${c.channel || '?'} — ${c.duration ? Math.round(c.duration) + 's' : '?'}`).join('\n')}

Respond ONLY with JSON: {"ranking":[{"index":0,"score":8}]}`
            const res = await generateJson(prompt, RankSchema, { label: 'FootageRank' })
            for (const r of res.ranking) if (fresh[r.index]) fresh[r.index].score = r.score
        } catch (err: any) {
            console.warn(`[Footage] Ranking no disponible: ${err?.message || err}`)
            fresh.forEach((c, i) => { c.score = 5 - i * 0.1 })
        }
        for (const c of fresh) this.candidates.set(c.id, c)
        this.track('rank', { query: q, top: fresh.sort((a, b) => b.score - a.score).slice(0, 5).map(c => ({ id: c.id, t: c.title.slice(0, 70), s: c.score })) })
    }

    // ---------- 2. Análisis del video completo por miniaturas ----------
    private async analyze(c: Candidate): Promise<void> {
        c.analyzed = true
        this.analyzedCount++
        const url = `https://www.youtube.com/watch?v=${c.id}`
        let info: any
        try {
            const { stdout } = await execFileAsync(YTDLP_PATH, this.ytArgs([url, '-J', '--skip-download', '--no-playlist']), { timeout: 60000, maxBuffer: 50 * 1024 * 1024 })
            info = JSON.parse(stdout)
        } catch (err: any) {
            this.track('analyze_error', { id: c.id, stage: 'info', error: String(err?.message || err).slice(0, 300) })
            return
        }
        c.title = c.title || String(info?.title || '')
        c.channel = c.channel || String(info?.channel || '')
        const duration = Number(info?.duration) || c.duration
        c.duration = duration
        const vw = Number(info?.width) || 0
        const vh = Number(info?.height) || 0
        if (vw && vh && vh > vw) {
            this.track('analyze_skip', { id: c.id, reason: 'vertical' })
            return
        }

        const boards = (info?.formats || []).filter((f: any) =>
            (f?.format_note === 'storyboard' || String(f?.format_id || '').startsWith('sb')) && Array.isArray(f?.fragments) && f.fragments.length > 0)
        if (boards.length === 0) {
            this.track('analyze_skip', { id: c.id, reason: 'sin storyboards' })
            return
        }
        const board = boards.sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height))[0]
        const rows = Number(board.rows) || 1
        const cols = Number(board.columns) || 1
        const perSheet = rows * cols

        // Momento de cada miniatura
        type TileRef = { sheet: number; idx: number; time: number }
        const tiles: TileRef[] = []
        let t0 = 0
        board.fragments.forEach((frag: any, sheet: number) => {
            const fdur = Number(frag?.duration) || perSheet / (Number(board.fps) || 0.5)
            const spacing = fdur / perSheet
            for (let idx = 0; idx < perSheet; idx++) {
                const time = t0 + idx * spacing
                if (time > duration - 2) break
                if (time >= 3) tiles.push({ sheet, idx, time })
            }
            t0 += fdur
        })
        let chosen = tiles
        if (tiles.length > MAX_TILES) {
            const step = tiles.length / MAX_TILES
            chosen = Array.from({ length: MAX_TILES }, (_, k) => tiles[Math.floor(k * step)])
        }
        if (chosen.length < 4) {
            this.track('analyze_skip', { id: c.id, reason: 'video muy corto' })
            return
        }
        const spacing = chosen.length > 1 ? (chosen[chosen.length - 1].time - chosen[0].time) / (chosen.length - 1) : 2

        // Descargar las hojas necesarias y armar hojas de contacto numeradas
        const sheetIds = [...new Set(chosen.map(t => t.sheet))]
        const sheetBufs = new Map<number, Buffer>()
        await Promise.all(sheetIds.map(async s => {
            try {
                const fragUrl = String(board.fragments[s].url || '')
                const full = fragUrl.startsWith('http') ? fragUrl : `${board.fragment_base_url || ''}${fragUrl}`
                const res = await axios.get(full, { responseType: 'arraybuffer', timeout: 20000 })
                sheetBufs.set(s, Buffer.from(res.data))
            } catch { /* hoja no disponible */ }
        }))
        const usable = chosen.filter(t => sheetBufs.has(t.sheet))
        if (usable.length < 4) {
            this.track('analyze_error', { id: c.id, stage: 'storyboard_download', sheets: sheetIds.length, got: sheetBufs.size })
            return
        }

        const tileImgs: Buffer[] = []
        const metaCache = new Map<number, { w: number; h: number }>()
        for (let k = 0; k < usable.length; k++) {
            const t = usable[k]
            const buf = sheetBufs.get(t.sheet)!
            let meta = metaCache.get(t.sheet)
            if (!meta) {
                const m = await sharp(buf).metadata()
                meta = { w: m.width || 0, h: m.height || 0 }
                metaCache.set(t.sheet, meta)
            }
            const tw = Math.floor(meta.w / cols)
            const th = Math.floor(meta.h / rows)
            const left = (t.idx % cols) * tw
            const top = Math.floor(t.idx / cols) * th
            if (!tw || !th || left + tw > meta.w || top + th > meta.h) continue
            const label = Buffer.from(`<svg width="${TILE_W}" height="${TILE_H}"><rect x="0" y="0" width="34" height="22" fill="black" fill-opacity="0.75"/><text x="4" y="17" font-family="Arial" font-size="16" font-weight="bold" fill="#ffd400">${k}</text></svg>`)
            const img = await sharp(buf).extract({ left, top, width: tw, height: th })
                .resize(TILE_W, TILE_H, { fit: 'fill' })
                .composite([{ input: label, top: 0, left: 0 }])
                .jpeg({ quality: 82 }).toBuffer()
            tileImgs.push(img)
        }
        const sheetsOut: Buffer[] = []
        for (let s = 0; s < tileImgs.length; s += MAX_TILES_PER_SHEET) {
            const group = tileImgs.slice(s, s + MAX_TILES_PER_SHEET)
            const gc = 8
            const gr = Math.ceil(group.length / gc)
            const sheet = await sharp({ create: { width: gc * TILE_W, height: gr * TILE_H, channels: 3, background: '#000' } })
                .composite(group.map((input, i) => ({ input, left: (i % gc) * TILE_W, top: Math.floor(i / gc) * TILE_H })))
                .jpeg({ quality: 82 }).toBuffer()
            sheetsOut.push(sheet)
        }
        this.storyboardOk++

        const parts: (string | Part)[] = [`You are a b-roll editor. The images below are contact sheets of thumbnails taken from ONE video in time order (~${spacing.toFixed(1)} s apart). Each thumbnail has its number in the top-left corner (0 to ${tileImgs.length - 1}).
VIDEO: "${c.title}" (channel: ${c.channel || '?'})
${this.storyBlock()}

Find SEGMENTS (runs of consecutive thumbnail numbers) that show REAL FILMED FIELD FOOTAGE useful for this story: the place, the people involved at the event, police/rescue operations, crowds, buildings, vehicles, match action, etc.
NOT usable: news anchors or presenters in a studio, talk-show or podcast sets, a person talking to camera in a studio, full-screen graphics, maps, text slides, still photos with graphics, split screens or picture-in-picture, ads, intros/outros, black or transition frames.
A small channel logo, a lower-third name bar or a ticker IS ACCEPTABLE if the main picture is real field footage (they will be cropped away later).
Rate "relevance" 0-10 (10 = clearly this exact event/person/place). Give a short Spanish "description" (max 12 words) of what is shown.

Respond ONLY with JSON: {"video_kind":"news_report|raw_footage|studio_talk|other","segments":[{"start_tile":3,"end_tile":7,"description":"...","relevance":8}]}`]
        sheetsOut.forEach((b, i) => {
            parts.push(`\nContact sheet ${i + 1}:`)
            parts.push({ inlineData: { data: b.toString('base64'), mimeType: 'image/jpeg' } })
        })

        try {
            const res = await generateJson(parts, StoryboardSchema, { label: 'FootageStoryboard' })
            let added = 0
            for (const s of res.segments) {
                const a = Math.max(0, Math.min(s.start_tile, s.end_tile))
                const b = Math.min(usable.length - 1, Math.max(s.start_tile, s.end_tile))
                if (!usable[a] || !usable[b]) continue
                const start = usable[a].time
                const end = Math.min(duration - 1, usable[b].time + spacing)
                if (end - start < 2.5 || s.relevance < 5) continue
                this.segments.push({
                    key: `${c.id}@${Math.round(start)}`, videoId: c.id, videoTitle: c.title,
                    start, end, usedUntil: start, description: s.description, relevance: s.relevance,
                })
                added++
            }
            console.log(`[Footage] ${c.id} "${c.title.slice(0, 60)}": ${tileImgs.length} miniaturas → ${added} tramos útiles (${res.video_kind || '?'})`)
            this.track('analyze', { id: c.id, title: c.title.slice(0, 90), channel: c.channel, kind: res.video_kind, tiles: tileImgs.length, spacing: Number(spacing.toFixed(2)), segments: res.segments.length, kept: added })
        } catch (err: any) {
            this.track('analyze_error', { id: c.id, stage: 'gemini', error: String(err?.message || err).slice(0, 300) })
        }
    }

    // ---------- 3. Elegir tramo para la escena ----------
    private async pickSegment(sceneText: string, sceneQuery: string, needSec: number): Promise<Segment | null> {
        const avail = this.segments.filter(s => !s.failed && s.end - s.usedUntil >= Math.min(needSec * 0.75, 4))
        if (avail.length === 0) return null
        const list = avail.slice(0, 25)
        try {
            const prompt = `Pick the b-roll segment that best illustrates this narration line of a news short.
${this.storyBlock()}
NARRATION (Spanish): "${sceneText}"
VISUAL IDEA: "${sceneQuery}"

SEGMENTS:
${list.map((s, i) => `[${i}] ${s.description} (relevance ${s.relevance}/10, ${Math.round(s.end - s.usedUntil)}s left, from "${s.videoTitle.slice(0, 60)}")`).join('\n')}

Prefer segments that match what the narration talks about; otherwise the most relevant footage of the same event. Answer -1 only if NONE belongs to this story.
Respond ONLY with JSON: {"choice":0,"reason":"..."}`
            const res = await generateJson(prompt, PickSchema, { label: 'FootagePick' })
            const seg = list[res.choice]
            this.track('pick', { scene: sceneText.slice(0, 80), choice: res.choice, seg: seg?.key, desc: seg?.description, reason: res.reason })
            return seg || null
        } catch {
            return list.sort((a, b) => b.relevance - a.relevance)[0]
        }
    }

    // ---------- 4. Descargar el tramo, revisar y recortar la zona limpia ----------
    private async probe(file: string) {
        const { stdout } = await execFileAsync(FFPROBE_PATH, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { timeout: 15000 })
        const j = JSON.parse(stdout)
        return { w: Number(j?.streams?.[0]?.width) || 0, h: Number(j?.streams?.[0]?.height) || 0, d: Number(j?.format?.duration) || 0 }
    }

    private async downloadAndClean(seg: Segment, clipLen: number, p: { category: string; subjectKey: string; sceneTags: string[] }): Promise<{ file: string; reason: string } | null> {
        const room = seg.end - seg.usedUntil
        const start = Math.max(0, seg.usedUntil + Math.max(0, Math.min(1, (room - clipLen) / 2)))
        const end = start + clipLen
        const base = `fx_${this.runId}_${randomUUID().slice(0, 6)}`
        const raw = path.join(this.tempDir, `${base}.%(ext)s`)
        const args = this.ytArgs([
            `https://www.youtube.com/watch?v=${seg.videoId}`, '--no-playlist',
            '-f', 'bestvideo[height<=1080][height>=480][ext=mp4]/bestvideo[height<=1080][ext=mp4]/best[height<=1080][ext=mp4]/best',
            '--download-sections', `*${start.toFixed(1)}-${end.toFixed(1)}`, '--force-keyframes-at-cuts', '--force-overwrites', '-o', raw,
        ])
        if (path.isAbsolute(FFMPEG_PATH)) args.push('--ffmpeg-location', FFMPEG_PATH)
        const t = Date.now()
        await execFileAsync(YTDLP_PATH, args, { timeout: 90000 }).catch(err => {
            this.track('download_error', { seg: seg.key, error: String(err?.message || err).slice(0, 300) })
        })
        const produced = fsSync.readdirSync(this.tempDir).find(f => f.startsWith(`${base}.`) && /\.(mp4|webm|mkv)$/.test(f))
        if (!produced) return null
        const rawPath = path.join(this.tempDir, produced)
        const frames: string[] = []
        try {
            const { w, h, d } = await this.probe(rawPath)
            if (!w || !h || d < 1.5) {
                this.track('gate', { seg: seg.key, ok: false, reason: 'clip ilegible o vacío' })
                return null
            }
            for (const frac of [0.15, 0.5, 0.85]) {
                const fp = path.join(this.tempDir, `${base}_g${Math.round(frac * 100)}.jpg`)
                await execFileAsync(FFMPEG_PATH, ['-y', '-ss', (d * frac).toFixed(2), '-i', rawPath, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', fp], { timeout: 20000 })
                if (fsSync.existsSync(fp)) frames.push(fp)
            }
            if (frames.length === 0) return null

            const parts: (string | Part)[] = [`You check b-roll frames (start, middle, end of one clip) for a news short.
${this.storyBlock()}
Segment expected to show: "${seg.description}".

1) "is_real_footage": true if it is real filmed video (not a studio anchor/presenter, not a talk-show set, not full-screen graphics, map, text slide, still photo, split screen, cartoon or game) in ALL frames, and not black/blurred transition frames.
2) "is_relevant": true if it plausibly shows this story (place, people, event or closely related scene).
3) "overlays": EVERY region, in ANY frame, with text or graphics added in post-production: lower-thirds, name bars, tickers, captions/subtitles, titles, channel logos/bugs, watermarks, social handles, "EN VIVO/LIVE" badges, clocks. Give each as "box_2d": [ymin, xmin, ymax, xmax] normalized 0-1000 over the full frame. Combine all frames (a logo in one frame counts for the whole clip). Text that physically exists in the scene (street signs, banners, uniforms, jerseys) is NOT an overlay.

Respond ONLY with JSON: {"is_real_footage":true,"is_relevant":true,"overlays":[{"label":"lower third","box_2d":[780,40,900,700]}],"reason":"..."}`]
            for (let i = 0; i < frames.length; i++) {
                parts.push(`\nFrame ${i + 1}:`)
                parts.push({ inlineData: { data: (await fs.readFile(frames[i])).toString('base64'), mimeType: 'image/jpeg' } })
            }
            const g = await generateJson(parts, GateSchema, { label: 'FootageGate', retries: 1 })
            const boxes: Box[] = g.overlays.map(o => {
                const [y0, x0, y1, x1] = o.box_2d
                return { x0: (Math.min(x0, x1) / 1000) * w, y0: (Math.min(y0, y1) / 1000) * h, x1: (Math.max(x0, x1) / 1000) * w, y1: (Math.max(y0, y1) / 1000) * h }
            })
            if (!g.is_real_footage || !g.is_relevant) {
                this.track('gate', { seg: seg.key, ok: false, real: g.is_real_footage, relevant: g.is_relevant, overlays: boxes.length, reason: g.reason, ms: Date.now() - t })
                console.warn(`[Footage] Tramo descartado ${seg.key}: ${g.reason || 'no es metraje real relevante'}`)
                return null
            }
            const crop = findCleanCrop(w, h, boxes)
            if (!crop || crop.h < 300) {
                this.track('gate', { seg: seg.key, ok: false, reason: 'textos/logos cubren la imagen', overlays: g.overlays.map(o => o.label), ms: Date.now() - t })
                console.warn(`[Footage] Tramo descartado ${seg.key}: sin zona limpia suficiente`)
                return null
            }

            await fs.mkdir(this.vaultDir, { recursive: true })
            const slug = (s: string) => (s || 'general').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36) || 'general'
            const tagSlug = p.sceneTags.slice(0, 3).map(slug).join('_') || 'clip'
            const fileName = `${slug(p.category)}-${slug(p.subjectKey)}-${tagSlug}_${randomUUID().slice(0, 6)}.clean.mp4`
            const outPath = path.join(this.vaultDir, fileName)
            await execFileAsync(FFMPEG_PATH, [
                '-y', '-i', rawPath, '-an',
                '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1`,
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', outPath,
            ], { timeout: 90000 })

            const reason = `${g.reason || 'Limpio'} · recorte ${crop.w}x${crop.h}@${crop.x},${crop.y} de ${w}x${h} · ${boxes.length} textos/logos evitados`
            const entry: VaultEntry = {
                fileName, filePath: outPath, mediaType: 'video', category: slug(p.category), subjectKey: slug(p.subjectKey),
                tags: p.sceneTags.map(slug).filter(Boolean), prompt: `${seg.description} | ${seg.videoTitle}`,
                createdAt: new Date().toISOString(), clipCheck: `${FOOTAGE_GATE_VERSION}-ok`, clipCheckReason: reason.slice(0, 500), sourceVideoId: seg.videoId,
            }
            await vaultStore.add(entry)
            seg.usedUntil = end
            this.track('gate', { seg: seg.key, ok: true, crop, src: `${w}x${h}`, overlays: g.overlays.map(o => o.label), start: Number(start.toFixed(1)), file: fileName, ms: Date.now() - t })
            return { file: fileName, reason }
        } catch (err: any) {
            this.track('gate_error', { seg: seg.key, error: String(err?.message || err).slice(0, 300) })
            return null
        } finally {
            await fs.unlink(rawPath).catch(() => { })
            await Promise.all(frames.map(f => fs.unlink(f).catch(() => { })))
        }
    }

    // ---------- API pública ----------
    async findClip(p: {
        sceneIndex: number
        sceneText: string
        sceneQuery: string
        durationSec: number
        category: string
        subjectKey: string
        sceneTags: string[]
        usedFiles: Set<string>
    }): Promise<VisualResult | null> {
        const clipLen = Math.max(4, Math.ceil(p.durationSec + 1))
        const t = Date.now()

        // Búsquedas: la de la escena (por relevancia) y, la primera vez, la más reciente
        await this.search(p.sceneQuery, 'relevance')
        if (this.searched.size <= 1) await this.search(p.sceneQuery, 'date')

        let newAnalyses = 0
        for (let round = 0; round < 6; round++) {
            const seg = await this.pickSegment(p.sceneText, p.sceneQuery, clipLen)
            if (seg) {
                const res = await this.downloadAndClean(seg, clipLen, p)
                if (res) {
                    p.usedFiles.add(res.file)
                    console.log(`[Footage] Escena ${p.sceneIndex + 1}: ${seg.description} (${seg.videoId} ${fmt(seg.usedUntil - clipLen)}) en ${Math.round((Date.now() - t) / 1000)}s`)
                    return {
                        imagePath: path.join(this.vaultDir, res.file),
                        sourceLabel: `YouTube real v4 (${seg.videoId} @${Math.round(seg.usedUntil - clipLen)}s): ${seg.description}`,
                        fromVault: false,
                        kind: 'real_video',
                        sourceVideoId: seg.videoId,
                    }
                }
                seg.failed = true
                continue
            }
            // No hay tramos útiles: analizar el siguiente mejor candidato
            if (newAnalyses >= MAX_NEW_ANALYSES_PER_SCENE || this.analyzedCount >= MAX_ANALYZED_PER_REEL) break
            const next = [...this.candidates.values()].filter(c => !c.analyzed && c.score >= 5).sort((a, b) => b.score - a.score)[0]
            if (!next) break
            newAnalyses++
            await this.analyze(next)
        }
        this.track('scene_fail', { scene: p.sceneIndex, query: p.sceneQuery, analyzed: this.analyzedCount, segments: this.segments.length, ms: Date.now() - t })
        console.warn(`[Footage] Escena ${p.sceneIndex + 1}: sin metraje real (${this.analyzedCount} videos analizados, ${this.segments.length} tramos).`)
        return null
    }
}
