import axios from 'axios'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID as uuidv4 } from 'crypto'
import { generateJson } from '@/lib/ai/gemini'
import { ClipRelevanceSchema } from '@/lib/ai/schemas'
import { FFMPEG_PATH, FFPROBE_PATH, YTDLP_PATH } from '@/lib/media-config'

const execFileAsync = promisify(execFile)
const ffmpegPath = FFMPEG_PATH

/** Versión del filtro visual. Los clips del vault validados con una versión anterior se re-validan antes de reutilizarse. */
const CLIP_GATE_VERSION = 'v2'
/** Intentos máximos de descarga de clips por escena (cada intento rechazado se excluye del siguiente). */
const MAX_CLIP_ATTEMPTS = 4

export interface VaultEntry {
    fileName: string
    filePath: string
    mediaType?: 'image' | 'video'
    category: string
    subjectKey: string
    tags: string[]
    prompt: string
    createdAt: string
    /** Imagen IA generada sin personas identificables (apta para escenas sobre personas reales). */
    personFree?: boolean
    /** Resultado del filtro visual de clips: 'v2-ok' | 'v2-rejected'. Sin valor = validado con el filtro antiguo. */
    clipCheck?: string
    clipCheckReason?: string
    sourceVideoId?: string
}

export type VisualGenerationMode = 'hybrid' | 'real_video' | 'ai_images'

export type VisualSourceKind = 'custom_video' | 'real_video' | 'ai_image'

export interface VisualResult {
    imagePath: string
    sourceLabel: string
    fromVault: boolean
    videoStartTime?: number
    kind: VisualSourceKind
}

class ImageService {
    private tempDir: string
    private vaultDir: string
    private vaultIndexPath: string
    private ytDlpPath: string

    constructor() {
        this.tempDir = path.join(process.cwd(), 'public', 'temp')
        this.vaultDir = path.join(process.cwd(), 'public', 'ai-vault')
        this.vaultIndexPath = path.join(this.vaultDir, 'index.json')
        this.ytDlpPath = YTDLP_PATH

        fs.mkdir(this.tempDir, { recursive: true }).catch(() => { })
        fs.mkdir(this.vaultDir, { recursive: true }).catch(() => { })
    }

    private slugify(text: string): string {
        return (text || 'general')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 36) || 'general'
    }

    private async readVaultIndex(): Promise<VaultEntry[]> {
        try {
            if (!fsSync.existsSync(this.vaultIndexPath)) return []
            const raw = await fs.readFile(this.vaultIndexPath, 'utf-8')
            const parsed = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed : []
        } catch {
            return []
        }
    }

    private async writeVaultIndex(entries: VaultEntry[]): Promise<void> {
        await fs.mkdir(this.vaultDir, { recursive: true })
        await fs.writeFile(this.vaultIndexPath, JSON.stringify(entries, null, 2), 'utf-8')
    }

    private async updateVaultEntry(fileName: string, patch: Partial<VaultEntry>): Promise<void> {
        const entries = await this.readVaultIndex()
        const idx = entries.findIndex(e => e.fileName === fileName)
        if (idx >= 0) {
            entries[idx] = { ...entries[idx], ...patch }
            await this.writeVaultIndex(entries)
        }
    }

    /**
     * Busca en el vault una imagen o clip del mismo sujeto con tags parecidos.
     * - Nunca devuelve clips rechazados por el filtro visual.
     * - Con `requirePersonFree`, solo devuelve imágenes IA generadas sin personas identificables.
     */
    async findInVault(
        subjectKey: string,
        sceneTags: string[],
        usedFiles: Set<string>,
        preferredMediaType?: 'image' | 'video',
        opts: { requirePersonFree?: boolean; skip?: Set<string> } = {}
    ): Promise<VaultEntry | null> {
        const entries = await this.readVaultIndex()
        if (entries.length === 0) return null

        const normSubject = this.slugify(subjectKey)
        const normTags = sceneTags.map(t => this.slugify(t)).filter(Boolean)

        let bestMatch: { entry: VaultEntry; score: number } | null = null

        for (const entry of entries) {
            if (usedFiles.has(entry.fileName) || opts.skip?.has(entry.fileName)) continue
            const entryType = entry.mediaType || (entry.fileName.endsWith('.mp4') ? 'video' : 'image')
            if (preferredMediaType && entryType !== preferredMediaType) continue
            if (entryType === 'video' && entry.clipCheck?.endsWith('-rejected')) continue
            if (entryType === 'image' && opts.requirePersonFree && !entry.personFree) continue

            const fullPath = path.join(this.vaultDir, entry.fileName)
            if (!fsSync.existsSync(fullPath)) continue

            const entrySubject = this.slugify(entry.subjectKey)
            const sameSubject =
                entrySubject === normSubject ||
                entrySubject.includes(normSubject) ||
                normSubject.includes(entrySubject)
            if (!sameSubject) continue

            const entryTagSet = new Set((entry.tags || []).map(t => this.slugify(t)))
            let tagScore = 0
            for (const tag of normTags) {
                if (entryTagSet.has(tag)) tagScore += 2
                else if ([...entryTagSet].some(et => et.includes(tag) || tag.includes(et))) tagScore += 1
            }

            if (tagScore >= 2 && (!bestMatch || tagScore > bestMatch.score)) {
                bestMatch = { entry: { ...entry, filePath: fullPath, mediaType: entryType }, score: tagScore }
            }
        }

        return bestMatch ? bestMatch.entry : null
    }

    private async saveImageToVault(
        imageBuffer: Buffer,
        category: string,
        subjectKey: string,
        sceneTags: string[],
        prompt: string,
        personFree: boolean
    ): Promise<VaultEntry> {
        await fs.mkdir(this.vaultDir, { recursive: true })

        const safeCat = this.slugify(category)
        const safeSubj = this.slugify(subjectKey)
        const safeTagSlug = sceneTags.slice(0, 3).map(t => this.slugify(t)).join('_') || 'scene'
        const shortId = uuidv4().slice(0, 6)

        const fileName = `${safeCat}-${safeSubj}-${safeTagSlug}_${shortId}.jpg`
        const filePath = path.join(this.vaultDir, fileName)
        await fs.writeFile(filePath, imageBuffer)

        const newEntry: VaultEntry = {
            fileName,
            filePath,
            mediaType: 'image',
            category: safeCat,
            subjectKey: safeSubj,
            tags: sceneTags.map(t => this.slugify(t)).filter(Boolean),
            prompt,
            createdAt: new Date().toISOString(),
            ...(personFree ? { personFree: true } : {})
        }

        const entries = await this.readVaultIndex()
        entries.push(newEntry)
        await this.writeVaultIndex(entries)
        return newEntry
    }

    private async probeVideo(videoPath: string): Promise<{ duration: number; width: number; height: number }> {
        try {
            const { stdout } = await execFileAsync(FFPROBE_PATH, [
                '-v', 'error',
                '-select_streams', 'v:0',
                '-show_entries', 'stream=width,height:format=duration',
                '-of', 'json',
                videoPath
            ], { timeout: 15000 })
            const info = JSON.parse(stdout)
            return {
                duration: Number(info?.format?.duration) || 0,
                width: Number(info?.streams?.[0]?.width) || 0,
                height: Number(info?.streams?.[0]?.height) || 0
            }
        } catch {
            return { duration: 0, width: 0, height: 0 }
        }
    }

    /**
     * FILTRO VISUAL ESTRICTO (v2) para clips descargados.
     * Rechaza: videos verticales (casi siempre Shorts/Reels ajenos), y cualquier clip con texto superpuesto
     * (titulares, subtítulos quemados, cintillos), logos de canal, marcas de agua, botones de redes,
     * pantallas divididas, grabaciones de pantalla o contenido ajeno al tema.
     * Revisa 3 fotogramas (inicio, medio, final). Si la revisión no puede hacerse, el clip se rechaza.
     */
    async auditClip(
        videoPath: string,
        subjectKey: string,
        searchQuery: string,
        opts: { allowVertical?: boolean } = {}
    ): Promise<{ ok: boolean; reason: string }> {
        const { duration, width, height } = await this.probeVideo(videoPath)
        if (!duration || !width || !height) {
            return { ok: false, reason: 'No se pudo leer el clip' }
        }
        if (!opts.allowVertical && height > width) {
            return { ok: false, reason: `Clip vertical ${width}x${height} (probable Short/Reel ajeno con textos)` }
        }

        const framePaths: string[] = []
        try {
            for (const frac of [0.15, 0.5, 0.85]) {
                const framePath = path.join(this.tempDir, `gate_${uuidv4().slice(0, 8)}.jpg`)
                await execFileAsync(ffmpegPath, [
                    '-y', '-ss', (duration * frac).toFixed(2), '-i', videoPath,
                    '-frames:v', '1', '-vf', 'scale=768:-2', '-q:v', '3', framePath
                ], { timeout: 15000 })
                if (fsSync.existsSync(framePath)) framePaths.push(framePath)
            }
            if (framePaths.length === 0) return { ok: false, reason: 'No se pudieron extraer fotogramas' }

            const cleanSubject = subjectKey.replace(/_/g, ' ')
            const parts: any[] = [
                `You are a STRICT footage gate for a vertical short video about "${cleanSubject}" (scene query: "${searchQuery}").
Our app burns its OWN subtitles and graphics on top, so the source footage must be CLEAN.
You will see ${framePaths.length} frames from the same clip (start, middle, end).

Set "has_overlay_text": true if ANY frame shows text added in post-production: titles, headlines, burned-in subtitles or captions, news lower-thirds, tickers/chyrons, quotes, hashtags, emoji stickers, "subscribe/like" prompts, end screens.
(Text that physically exists in the filmed scene — a street sign, a banner on a wall, a jersey number, a stadium scoreboard — does NOT count.)
Set "has_logo_or_watermark": true if ANY frame shows a TV/channel logo or bug, a watermark, a social-media handle or a creator's branding.
Set "is_relevant": true only if the footage is real filmed video coherent with "${cleanSubject}" (not a meme, cartoon, video game, slideshow of stills with graphics, split screen, picture-in-picture, or a phone/screen recording) AND every frame is usable: not mostly black, not a glitch/transition effect, not heavily motion-blurred, not a vertical video pillarboxed inside a horizontal frame.
Set "valid": true ONLY if has_overlay_text=false AND has_logo_or_watermark=false AND is_relevant=true.

Respond ONLY with JSON: {"valid": bool, "has_overlay_text": bool, "has_logo_or_watermark": bool, "is_relevant": bool, "reason": "short explanation"}`
            ]
            for (let i = 0; i < framePaths.length; i++) {
                parts.push(`\nFrame ${i + 1}:`)
                parts.push({ inlineData: { data: (await fs.readFile(framePaths[i])).toString('base64'), mimeType: 'image/jpeg' } })
            }

            const verdict = await generateJson(parts, ClipRelevanceSchema, { label: 'ClipGate', retries: 1 })
            const ok = verdict.valid === true && verdict.has_overlay_text !== true && verdict.has_logo_or_watermark !== true && verdict.is_relevant !== false
            return { ok, reason: verdict.reason || (ok ? 'Limpio' : 'Rechazado') }
        } catch (err: any) {
            return { ok: false, reason: `Revisión visual no disponible (${err?.message || err})` }
        } finally {
            await Promise.all(framePaths.map(p => fs.unlink(p).catch(() => { })))
        }
    }

    /**
     * Obtiene un clip de video real limpio para la escena:
     * 1) Reutiliza un clip del vault que pase el filtro v2 (los antiguos se re-validan una vez).
     * 2) Si no hay, descarga de YouTube con yt-dlp (solo horizontales y de más de 60 s, excluyendo los ya rechazados)
     *    y lo pasa por el filtro visual estricto. Hasta MAX_CLIP_ATTEMPTS intentos.
     */
    async fetchRealVideoClipToVault(params: {
        searchQuery: string
        customUrl?: string
        sceneIndex: number
        durationSec: number
        category: string
        subjectKey: string
        sceneTags: string[]
        usedFiles: Set<string>
    }): Promise<VisualResult | null> {
        const { searchQuery, customUrl, sceneIndex, durationSec, category, subjectKey, sceneTags, usedFiles } = params

        // 1. Reutilizar clips del vault (re-validando los que no pasaron por el filtro v2)
        if (!customUrl) {
            const skip = new Set<string>()
            for (let i = 0; i < 4; i++) {
                const cached = await this.findInVault(subjectKey, sceneTags, usedFiles, 'video', { skip })
                if (!cached) break
                if (cached.clipCheck !== `${CLIP_GATE_VERSION}-ok`) {
                    const check = await this.auditClip(cached.filePath, subjectKey, searchQuery)
                    await this.updateVaultEntry(cached.fileName, {
                        clipCheck: `${CLIP_GATE_VERSION}-${check.ok ? 'ok' : 'rejected'}`,
                        clipCheckReason: check.reason
                    })
                    if (!check.ok) {
                        console.warn(`[ClipGate] Clip del vault descartado (${check.reason}): ${cached.fileName}`)
                        skip.add(cached.fileName)
                        continue
                    }
                }
                usedFiles.add(cached.fileName)
                console.log(`[AIVault] Reutilizando clip limpio del vault: ${cached.fileName}`)
                return {
                    imagePath: cached.filePath,
                    sourceLabel: `Vault Video (Reused): ${cached.fileName}`,
                    fromVault: true,
                    kind: 'real_video'
                }
            }
        }

        // 2. Descargar de YouTube
        await fs.mkdir(this.vaultDir, { recursive: true })
        const safeCat = this.slugify(category)
        const safeSubj = this.slugify(subjectKey)
        const safeTagSlug = sceneTags.slice(0, 3).map(t => this.slugify(t)).join('_') || `clip_${sceneIndex + 1}`

        const clipLen = Math.max(5, Math.ceil(durationSec + 1.5))
        const cleanSubjectWords = subjectKey.replace(/_/g, ' ')
        const queries = customUrl && customUrl.startsWith('http')
            ? [customUrl]
            : [
                `ytsearch10:${searchQuery}`,
                `ytsearch10:${cleanSubjectWords} ${sceneTags.slice(0, 2).join(' ').replace(/_/g, ' ')} noticia video`
            ]

        const rejectedIds = new Set<string>()
        let attempts = 0

        for (const targetInput of queries) {
            while (attempts < MAX_CLIP_ATTEMPTS) {
                attempts++
                const startSec = customUrl ? 8 + sceneIndex * (clipLen + 4) : 18 + (sceneIndex % 5) * 8
                const baseName = `${safeCat}-${safeSubj}-${safeTagSlug}_${uuidv4().slice(0, 6)}`
                const outputTemplate = path.join(this.vaultDir, `${baseName}.%(id)s.%(ext)s`)

                const args: string[] = [
                    targetInput,
                    '--js-runtimes', 'node',
                    '--no-playlist',
                    '--no-warnings',
                    '-f', 'bestvideo[height<=1080][height>=720][ext=mp4]/bestvideo[height<=1080][ext=mp4]/best[height<=1080][ext=mp4]/best',
                    '--download-sections', `*${startSec}-${startSec + clipLen}`,
                    '--force-keyframes-at-cuts',
                    '--force-overwrites',
                    '-o', outputTemplate
                ]
                if (!customUrl) {
                    // Solo videos horizontales (>60 s, no en vivo) y excluyendo los ya rechazados
                    const exclude = [...rejectedIds].map(id => ` & id != '${id}'`).join('')
                    args.push('--match-filter', `duration > 60 & duration < 1800 & !is_live & aspect_ratio >? 1.2${exclude}`)
                    args.push('--max-downloads', '1')
                }
                if (path.isAbsolute(ffmpegPath)) {
                    args.push('--ffmpeg-location', ffmpegPath)
                }

                console.log(`[RealVideo] Intento ${attempts}: "${targetInput}" (${startSec}s-${startSec + clipLen}s)...`)
                // --max-downloads termina con código distinto de 0 aunque haya descargado: se revisa el archivo igual
                await execFileAsync(this.ytDlpPath, args, { timeout: 60000 }).catch(() => { })

                const produced = fsSync.readdirSync(this.vaultDir).find(f => f.startsWith(`${baseName}.`) && f.endsWith('.mp4'))
                if (!produced) {
                    console.warn(`[RealVideo] Sin resultados válidos para "${targetInput}".`)
                    break // pasar a la siguiente consulta
                }

                const outputPath = path.join(this.vaultDir, produced)
                const videoId = produced.slice(baseName.length + 1, -4)

                if (fsSync.statSync(outputPath).size < 15000) {
                    await fs.unlink(outputPath).catch(() => { })
                    rejectedIds.add(videoId)
                    if (customUrl) break
                    continue
                }

                const check = await this.auditClip(outputPath, subjectKey, searchQuery, { allowVertical: Boolean(customUrl) })
                if (!check.ok) {
                    console.warn(`[ClipGate] Rechazado ${videoId}: ${check.reason}`)
                    await fs.unlink(outputPath).catch(() => { })
                    rejectedIds.add(videoId)
                    if (customUrl) break
                    continue
                }

                const fileName = `${baseName}.mp4`
                const finalPath = path.join(this.vaultDir, fileName)
                await fs.rename(outputPath, finalPath)

                const newEntry: VaultEntry = {
                    fileName,
                    filePath: finalPath,
                    mediaType: 'video',
                    category: safeCat,
                    subjectKey: safeSubj,
                    tags: sceneTags.map(t => this.slugify(t)).filter(Boolean),
                    prompt: customUrl || searchQuery,
                    createdAt: new Date().toISOString(),
                    clipCheck: `${CLIP_GATE_VERSION}-ok`,
                    clipCheckReason: check.reason,
                    sourceVideoId: videoId
                }
                const entries = await this.readVaultIndex()
                entries.push(newEntry)
                await this.writeVaultIndex(entries)
                usedFiles.add(fileName)

                console.log(`[AIVault] Clip limpio verificado y guardado: ${fileName}`)
                return {
                    imagePath: finalPath,
                    sourceLabel: customUrl ? `Custom YouTube Clip: ${fileName}` : `YouTube B-Roll (Clean v2): ${fileName}`,
                    fromVault: false,
                    kind: 'real_video'
                }
            }
            if (attempts >= MAX_CLIP_ATTEMPTS) break
        }

        console.warn(`[RealVideo] No se encontró metraje limpio tras ${attempts} intentos (${rejectedIds.size} rechazados).`)
        return null
    }

    /**
     * Descarga el tramo de un video indicado por el usuario (YouTube u otra web compatible con yt-dlp)
     * para una escena concreta. El usuario garantiza que el video está limpio, así que no pasa por el
     * filtro visual automático (se aceptan también videos verticales). Se guarda en el vault para reutilizarlo.
     */
    async fetchUserVideoClip(params: {
        url: string
        startSec?: number
        durationSec: number
        category: string
        subjectKey: string
        sceneTags: string[]
    }): Promise<VisualResult> {
        const { url, durationSec, category, subjectKey, sceneTags } = params
        let parsed: URL
        try {
            parsed = new URL(url.trim())
        } catch {
            throw new Error('La URL del video no es válida.')
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('La URL del video debe empezar con http:// o https://')
        }

        await fs.mkdir(this.vaultDir, { recursive: true })
        const startSec = Math.max(0, Math.floor(params.startSec || 0))
        const clipLen = Math.max(5, Math.ceil(durationSec + 1.5))
        const baseName = `${this.slugify(category)}-${this.slugify(subjectKey)}-user_clip_${uuidv4().slice(0, 6)}`
        const outputTemplate = path.join(this.vaultDir, `${baseName}.%(id)s.%(ext)s`)

        const args: string[] = [
            parsed.toString(),
            '--js-runtimes', 'node',
            '--no-playlist',
            '--no-warnings',
            '-f', 'bestvideo[height<=1080][ext=mp4]/best[height<=1080][ext=mp4]/bestvideo[height<=1080]+bestaudio/best',
            '--merge-output-format', 'mp4',
            '--download-sections', `*${startSec}-${startSec + clipLen}`,
            '--force-keyframes-at-cuts',
            '--force-overwrites',
            '-o', outputTemplate
        ]
        if (path.isAbsolute(ffmpegPath)) {
            args.push('--ffmpeg-location', ffmpegPath)
        }

        console.log(`[UserClip] Descargando ${clipLen}s desde ${startSec}s de ${parsed.toString()}`)
        let ytErr = ''
        await execFileAsync(this.ytDlpPath, args, { timeout: 120000 }).catch((e: any) => {
            ytErr = (e?.stderr || e?.message || '').toString().split('\n').filter(Boolean).slice(-1)[0] || ''
        })

        const produced = fsSync.readdirSync(this.vaultDir).find(f => f.startsWith(`${baseName}.`) && f.endsWith('.mp4'))
        if (!produced) {
            throw new Error(`No se pudo descargar el video de esa URL${ytErr ? `: ${ytErr}` : '.'}`)
        }

        const producedPath = path.join(this.vaultDir, produced)
        const { duration } = await this.probeVideo(producedPath)
        if (duration < 1) {
            await fs.unlink(producedPath).catch(() => { })
            throw new Error('El tramo descargado está vacío. Revisa el segundo de inicio (¿es mayor que la duración del video?).')
        }

        const fileName = `${baseName}.mp4`
        const finalPath = path.join(this.vaultDir, fileName)
        await fs.rename(producedPath, finalPath)

        const entries = await this.readVaultIndex()
        entries.push({
            fileName,
            filePath: finalPath,
            mediaType: 'video',
            category: this.slugify(category),
            subjectKey: this.slugify(subjectKey),
            tags: sceneTags.map(t => this.slugify(t)).filter(Boolean),
            prompt: parsed.toString(),
            createdAt: new Date().toISOString(),
            clipCheck: 'user-provided',
            sourceVideoId: produced.slice(baseName.length + 1, -4)
        })
        await this.writeVaultIndex(entries)

        return {
            imagePath: finalPath,
            sourceLabel: `Video indicado por el usuario (desde ${startSec}s): ${fileName}`,
            fromVault: false,
            kind: 'real_video'
        }
    }

    /**
     * Obtiene el visual de una escena según el modo:
     * - 'ai_images': imágenes IA guardadas en el vault
     * - 'real_video': metraje real (video propio o B-roll de YouTube limpio)
     * - 'hybrid': alterna metraje real e imágenes IA
     *
     * REGLA DE PERSONAS REALES (`realPerson`): una escena que muestra a una persona real identificable
     * nunca recibe una cara generada por IA. Se intenta metraje real (en hybrid/real_video); si no hay,
     * se genera una imagen IA SIN personas identificables usando `personFreePrompt` (lugar, objetos, ambiente).
     */
    async generateOrGetFromVault(params: {
        prompt: string
        videoSearchQuery?: string
        visualMode?: VisualGenerationMode
        customVideoSource?: string
        sceneIndex?: number
        durationSec?: number
        category: string
        subjectKey: string
        sceneTags: string[]
        usedFiles: Set<string>
        realPerson?: boolean
        personFreePrompt?: string
    }): Promise<VisualResult> {
        const {
            prompt,
            videoSearchQuery,
            visualMode = 'ai_images',
            customVideoSource,
            sceneIndex = 0,
            durationSec = 4,
            category,
            subjectKey,
            sceneTags,
            usedFiles,
            realPerson = false,
            personFreePrompt
        } = params

        // A. Video propio subido por el usuario
        if (customVideoSource && !customVideoSource.startsWith('http')) {
            const resolvedLocal = path.isAbsolute(customVideoSource)
                ? customVideoSource
                : path.join(process.cwd(), 'public', customVideoSource.replace(/^\//, ''))

            if (fsSync.existsSync(resolvedLocal)) {
                const useCustomInThisScene =
                    visualMode === 'real_video' || (visualMode === 'hybrid' && (sceneIndex % 2 === 0 || realPerson))
                if (useCustomInThisScene) {
                    const startOffset = sceneIndex * Math.max(4, Math.floor(durationSec))
                    return {
                        imagePath: resolvedLocal,
                        sourceLabel: `Video Propio: ${path.basename(resolvedLocal)} (seg ${startOffset}s)`,
                        fromVault: true,
                        videoStartTime: startOffset,
                        kind: 'custom_video'
                    }
                }
            }
        }

        // B. Metraje real (en hybrid, las escenas con persona real siempre lo intentan)
        const shouldUseRealVideo =
            visualMode === 'real_video' ||
            (visualMode === 'hybrid' && (sceneIndex % 2 === 0 || realPerson))

        if (shouldUseRealVideo && (videoSearchQuery || (customVideoSource && customVideoSource.startsWith('http')))) {
            const videoResult = await this.fetchRealVideoClipToVault({
                searchQuery: videoSearchQuery || `${subjectKey.replace(/_/g, ' ')} ${sceneTags.slice(0, 2).join(' ')}`,
                customUrl: customVideoSource && customVideoSource.startsWith('http') ? customVideoSource : undefined,
                sceneIndex,
                durationSec,
                category,
                subjectKey,
                sceneTags,
                usedFiles
            })
            if (videoResult) return videoResult
        }

        // C/D. Imagen IA. Con persona real: solo imágenes sin personas identificables.
        const effectivePrompt = realPerson
            ? (personFreePrompt?.trim() ||
                `Vertical 9:16 documentary photograph of the real location and objects related to ${subjectKey.replace(/_/g, ' ')}, no identifiable people, no faces, natural light`)
            : prompt

        const cachedImage = await this.findInVault(subjectKey, sceneTags, usedFiles, 'image', { requirePersonFree: realPerson })
        if (cachedImage) {
            usedFiles.add(cachedImage.fileName)
            console.log(`[AIVault] Reutilizando imagen IA del vault: ${cachedImage.fileName}`)
            return {
                imagePath: cachedImage.filePath,
                sourceLabel: `AI Vault (Reused): ${cachedImage.fileName}`,
                fromVault: true,
                kind: 'ai_image'
            }
        }

        const baseNegative =
            'deformed limbs, extra legs, extra arms, mutated hands, bad anatomy, distorted body, floating limbs, severed limbs, weird physics, disfigured face, blurry, low quality, text, letters, watermark, logo'
        const negativePrompt = realPerson
            ? `${baseNegative}, face, portrait, close-up of a person, identifiable person, celebrity, priest portrait, politician portrait`
            : baseNegative

        let imageBuffer: Buffer | null = null
        let providerLabel = 'HuggingFace SD3'

        const hfKey = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || process.env.NEXT_PUBLIC_HUGGINGFACE_API_KEY
        if (hfKey) {
            try {
                const response = await axios({
                    url: 'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers',
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${hfKey}`,
                        'Content-Type': 'application/json',
                        Accept: 'image/jpeg'
                    },
                    data: {
                        inputs: effectivePrompt,
                        parameters: {
                            negative_prompt: negativePrompt,
                            width: 768,
                            height: 1344,
                            num_inference_steps: 26,
                            guidance_scale: 7.0
                        }
                    },
                    responseType: 'arraybuffer',
                    timeout: 45000
                })
                imageBuffer = Buffer.from(response.data)
            } catch (hfErr: any) {
                console.warn(`[ImageService] Hugging Face SD3 error (${hfErr.message}), trying Pollinations Flux...`)
            }
        }

        if (!imageBuffer) {
            providerLabel = 'Flux AI'
            const seed = Math.floor(Math.random() * 999999)
            const fluxPrompt = realPerson ? `${effectivePrompt}, no people, no faces` : effectivePrompt
            const fluxUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fluxPrompt)}?width=1080&height=1920&model=flux&nologo=true&seed=${seed}`
            const response = await axios({ url: fluxUrl, method: 'GET', responseType: 'arraybuffer', timeout: 25000 })
            imageBuffer = Buffer.from(response.data)
        }

        const savedEntry = await this.saveImageToVault(imageBuffer, category, subjectKey, sceneTags, effectivePrompt, realPerson)
        usedFiles.add(savedEntry.fileName)
        console.log(`[AIVault] Nueva imagen IA${realPerson ? ' (sin personas)' : ''} guardada: ${savedEntry.fileName}`)

        return {
            imagePath: savedEntry.filePath,
            sourceLabel: `${providerLabel}${realPerson ? ' (sin personas)' : ''} (Saved to Vault): ${savedEntry.fileName}`,
            fromVault: false,
            kind: 'ai_image'
        }
    }
}

export const imageService = new ImageService()
