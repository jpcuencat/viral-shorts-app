import axios from 'axios'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID as uuidv4 } from 'crypto'
import { generateJson } from '@/lib/ai/gemini'
import { ClipRelevanceSchema } from '@/lib/ai/schemas'
import { FFMPEG_PATH, FFPROBE_PATH, YTDLP_PATH, BROADCAST_SAFE_CROP } from '@/lib/media-config'
import { vaultStore, type VaultEntry } from '@/lib/vault-store'

const execFileAsync = promisify(execFile)
const ffmpegPath = FFMPEG_PATH

/** Versión del filtro visual. Los clips del vault validados con una versión anterior se re-validan antes de reutilizarse. */
const CLIP_GATE_VERSION = 'v3'
/** Intentos máximos de descarga de clips nuevos por escena (cada intento rechazado se excluye del siguiente). */
const MAX_CLIP_ATTEMPTS = 2

export type { VaultEntry }

export type VisualGenerationMode = 'hybrid' | 'real_video' | 'ai_images'

export type VisualSourceKind = 'custom_video' | 'real_video' | 'ai_image' | 'news_card'

export interface VisualResult {
    imagePath: string
    sourceLabel: string
    fromVault: boolean
    videoStartTime?: number
    kind: VisualSourceKind
    /** Id del video de YouTube de origen (para reutilizar otros tramos de una fuente ya validada). */
    sourceVideoId?: string
}

class ImageService {
    private tempDir: string
    private vaultDir: string
    private ytDlpPath: string

    constructor() {
        this.tempDir = path.join(process.cwd(), 'public', 'temp')
        this.vaultDir = path.join(process.cwd(), 'public', 'ai-vault')
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
        const entries = await vaultStore.list(preferredMediaType ? { mediaType: preferredMediaType } : {})
        if (entries.length === 0) return null

        const normSubject = this.slugify(subjectKey)
        const normTags = sceneTags.map(t => this.slugify(t)).filter(Boolean)

        let bestMatch: { entry: VaultEntry; score: number } | null = null

        for (const entry of entries) {
            if (usedFiles.has(entry.fileName) || opts.skip?.has(entry.fileName)) continue
            const entryType = entry.mediaType || (entry.fileName.endsWith('.mp4') ? 'video' : 'image')
            if (preferredMediaType && entryType !== preferredMediaType) continue
            // Solo se descartan los rechazados por la versión ACTUAL del filtro (los antiguos se re-evalúan)
            if (entryType === 'video' && entry.clipCheck === `${CLIP_GATE_VERSION}-rejected`) continue
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

        await vaultStore.add(newEntry)
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
                    // Horizontales: se evalúa la imagen YA recortada, que es lo que se verá en el reel
                    '-frames:v', '1', '-vf', width > height ? `${BROADCAST_SAFE_CROP},scale=768:-2` : 'scale=768:-2', '-q:v', '3', framePath
                ], { timeout: 15000 })
                if (fsSync.existsSync(framePath)) framePaths.push(framePath)
            }
            if (framePaths.length === 0) return { ok: false, reason: 'No se pudieron extraer fotogramas' }

            const cleanSubject = subjectKey.replace(/_/g, ' ')
            const parts: any[] = [
                `You are a footage gate for a vertical short video about "${cleanSubject}" (scene query: "${searchQuery}").
Our app burns its OWN subtitles and graphics on top, so the visible footage must be CLEAN.
You will see ${framePaths.length} frames from the same clip (start, middle, end). For horizontal footage these frames are
ALREADY CROPPED to exactly the area that will be shown (corner channel logos and bottom tickers of TV news are cut away).
Judge ONLY what is visible in these frames.

Set "has_overlay_text": true if ANY frame clearly shows legible text added in post-production: titles, headlines, burned-in subtitles or captions, lower-thirds, tickers, quotes, hashtags, emoji stickers, "subscribe/like" prompts, end screens.
(Text that physically exists in the filmed scene — a street sign, a banner, a uniform patch, a jersey number, a scoreboard — does NOT count. A tiny unreadable fragment cut at the very edge does NOT count.)
Set "has_logo_or_watermark": true if ANY frame clearly shows a TV/channel logo, a watermark, a social-media handle or a creator's branding (tiny unreadable fragments at the very edge do NOT count).
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
        /** Videos de YouTube que ya pasaron el filtro en este reel: se prueban otros tramos antes de buscar nuevos. */
        preferredSourceIds?: string[]
    }): Promise<VisualResult | null> {
        const { searchQuery, customUrl, sceneIndex, durationSec, category, subjectKey, sceneTags, usedFiles } = params
        const preferredSourceIds = (params.preferredSourceIds || []).slice(0, 2)

        // 1. Reutilizar clips del vault (re-validando los que no pasaron por el filtro v2)
        if (!customUrl) {
            const skip = new Set<string>()
            for (let i = 0; i < 4; i++) {
                const cached = await this.findInVault(subjectKey, sceneTags, usedFiles, 'video', { skip })
                if (!cached) break
                if (cached.clipCheck !== `${CLIP_GATE_VERSION}-ok`) {
                    const check = await this.auditClip(cached.filePath, subjectKey, searchQuery)
                    await vaultStore.update(cached.fileName, {
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
                    kind: 'real_video',
                    sourceVideoId: cached.sourceVideoId
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
        // Objetivos en orden: (1) otros tramos de fuentes ya validadas en este reel, (2) búsquedas nuevas
        type Target = { input: string; direct: boolean }
        const targets: Target[] = customUrl && customUrl.startsWith('http')
            ? [{ input: customUrl, direct: true }]
            : [
                ...preferredSourceIds.map(id => ({ input: `https://www.youtube.com/watch?v=${id}`, direct: true })),
                { input: `ytsearch10:${searchQuery}`, direct: false },
                { input: `ytsearch10:${searchQuery.replace(/\b(video|en vivo)\b/gi, '').trim()} noticia`, direct: false },
            ]
        void cleanSubjectWords

        const rejectedIds = new Set<string>()
        let attempts = 0

        for (const target of targets) {
            const targetInput = target.input
            const isPreferred = target.direct && !customUrl
            while (isPreferred || attempts < MAX_CLIP_ATTEMPTS) {
                if (!isPreferred) attempts++
                // Fuentes ya validadas: un tramo distinto por escena para no repetir imágenes
                const startSec = customUrl
                    ? 8 + sceneIndex * (clipLen + 4)
                    : isPreferred
                        ? 20 + sceneIndex * (clipLen + 6)
                        : 18 + (sceneIndex % 5) * 8
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
                if (!target.direct) {
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
                    break // pasar al siguiente objetivo
                }

                const outputPath = path.join(this.vaultDir, produced)
                const videoId = produced.slice(baseName.length + 1, -4)

                if (fsSync.statSync(outputPath).size < 15000) {
                    await fs.unlink(outputPath).catch(() => { })
                    rejectedIds.add(videoId)
                    if (target.direct) break
                    continue
                }

                const check = await this.auditClip(outputPath, subjectKey, searchQuery, { allowVertical: Boolean(customUrl) })
                if (!check.ok) {
                    console.warn(`[ClipGate] Rechazado ${videoId}: ${check.reason}`)
                    await fs.unlink(outputPath).catch(() => { })
                    rejectedIds.add(videoId)
                    if (target.direct) break // un solo intento por fuente directa (evita bucles)
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
                await vaultStore.add(newEntry)
                usedFiles.add(fileName)

                console.log(`[AIVault] Clip limpio verificado y guardado: ${fileName}`)
                return {
                    imagePath: finalPath,
                    sourceLabel: customUrl
                        ? `Custom YouTube Clip: ${fileName}`
                        : `YouTube B-Roll (${isPreferred ? 'misma fuente, otro tramo' : `Clean ${CLIP_GATE_VERSION}`}): ${fileName}`,
                    fromVault: false,
                    kind: 'real_video',
                    sourceVideoId: videoId
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

        await vaultStore.add({
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

        return {
            imagePath: finalPath,
            sourceLabel: `Video indicado por el usuario (desde ${startSec}s): ${fileName}`,
            fromVault: false,
            kind: 'real_video'
        }
    }

    /**
     * Usa un video subido por el usuario (public/custom-videos) para una escena concreta,
     * tomando el tramo desde `startSec`. Solo acepta archivos dentro de public/custom-videos.
     */
    async useUploadedVideo(params: {
        publicPath: string
        startSec?: number
        durationSec: number
    }): Promise<VisualResult> {
        const uploadsDir = path.join(process.cwd(), 'public', 'custom-videos')
        const resolved = path.resolve(path.join(process.cwd(), 'public', params.publicPath.replace(/^\/+/, '')))
        if (!resolved.startsWith(uploadsDir + path.sep)) {
            throw new Error('Ruta de video subido no válida.')
        }
        if (!fsSync.existsSync(resolved)) {
            throw new Error('No se encontró el video subido. Vuelve a subirlo.')
        }

        const { duration } = await this.probeVideo(resolved)
        if (!duration) {
            throw new Error('No se pudo leer el video subido (¿formato dañado?).')
        }
        const startSec = Math.max(0, Math.floor(params.startSec || 0))
        if (startSec >= duration) {
            throw new Error(`El inicio (${startSec}s) supera la duración del video (${Math.floor(duration)}s).`)
        }
        if (duration - startSec < params.durationSec) {
            console.warn(`[UploadedClip] El tramo disponible (${(duration - startSec).toFixed(1)}s) es menor que la escena; se repetirá en bucle.`)
        }

        return {
            imagePath: resolved,
            sourceLabel: `Video subido por el usuario (desde ${startSec}s): ${path.basename(resolved)}`,
            fromVault: true,
            videoStartTime: startSec,
            kind: 'custom_video'
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
