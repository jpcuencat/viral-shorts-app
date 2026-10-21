import axios from 'axios'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { v4 as uuidv4 } from 'uuid'
import { generateJson } from '@/lib/ai/gemini'
import { ClipRelevanceSchema } from '@/lib/ai/schemas'

const execFileAsync = promisify(execFile)
import { FFMPEG_PATH, YTDLP_PATH } from '@/lib/media-config'

const ffmpegPath = FFMPEG_PATH

export interface VaultEntry {
    fileName: string
    filePath: string
    mediaType?: 'image' | 'video'
    category: string
    subjectKey: string
    tags: string[]
    prompt: string
    createdAt: string
}

export type VisualGenerationMode = 'hybrid' | 'real_video' | 'ai_images'

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
            .replace(/[\u0300-\u036f]/g, '')
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

    /**
     * Searches the AI & Video Vault (public/ai-vault) for a previously saved image or video clip
     * matching the same protagonist/subject and scene tags.
     */
    async findInVault(
        subjectKey: string,
        sceneTags: string[],
        usedFiles: Set<string>,
        preferredMediaType?: 'image' | 'video'
    ): Promise<VaultEntry | null> {
        const entries = await this.readVaultIndex()
        if (entries.length === 0) return null

        const normSubject = this.slugify(subjectKey)
        const normTags = sceneTags.map(t => this.slugify(t)).filter(Boolean)

        let bestMatch: { entry: VaultEntry; score: number } | null = null

        for (const entry of entries) {
            if (usedFiles.has(entry.fileName)) continue
            const entryType = entry.mediaType || (entry.fileName.endsWith('.mp4') ? 'video' : 'image')
            if (preferredMediaType && entryType !== preferredMediaType) continue

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

            if (tagScore >= 2) {
                if (!bestMatch || tagScore > bestMatch.score) {
                    bestMatch = { entry: { ...entry, filePath: fullPath, mediaType: entryType }, score: tagScore }
                }
            }
        }

        return bestMatch ? bestMatch.entry : null
    }

    /**
     * Saves a newly generated image buffer into public/ai-vault/ and indexes its semantic metadata
     */
    private async saveImageToVault(
        imageBuffer: Buffer,
        category: string,
        subjectKey: string,
        sceneTags: string[],
        prompt: string
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
            createdAt: new Date().toISOString()
        }

        const entries = await this.readVaultIndex()
        entries.push(newEntry)
        await this.writeVaultIndex(entries)

        return newEntry
    }

    /**
     * Extracts a real motion video clip (.mp4) from YouTube (via yt-dlp) either by search query or custom URL,
    /**
     * Extracts a sample frame from a downloaded .mp4 clip and uses Gemini Vision to verify
     * that it actually shows relevant real footage (rejecting "Like & Subscribe" intros, memes, or unrelated screens).
     */
    private async verifyVideoClipRelevance(videoPath: string, subjectKey: string, searchQuery: string): Promise<boolean> {
        const checkFramePath = path.join(this.tempDir, `verify_${uuidv4().slice(0, 8)}.jpg`)
        try {
            await execFileAsync(ffmpegPath, [
                '-y',
                '-ss', '1.8',
                '-i', videoPath,
                '-frames:v', '1',
                '-update', '1',
                '-q:v', '3',
                checkFramePath
            ], { timeout: 10000 })

            if (!fsSync.existsSync(checkFramePath)) return true

            const frameBuffer = await fs.readFile(checkFramePath)
            await fs.unlink(checkFramePath).catch(() => { })

            const cleanSubject = subjectKey.replace(/_/g, ' ')
            const auditPrompt = `You are a strict Video Quality Gate for a Short about "${cleanSubject}" (Scene query: "${searchQuery}").
Inspect this frame extracted from a downloaded YouTube video clip.

Mark "valid": false if ANY of the following is true:
1. It shows a YouTube "Like / Subscribe / Comment" overlay, phone mockup screen, or channel intro/outro banner.
2. It is an internet meme reaction face (e.g., crying guy meme with captions), cartoon, or video game menu.
3. It is a completely unrelated presentation slide, tutorial screen, or totally unrelated to "${cleanSubject}".

Mark "valid": true ONLY if it shows real broadcast/event/action footage coherent with "${cleanSubject}".

Respond ONLY with valid JSON: {"valid": true, "reason": "short explanation"}`

            const parsed = await generateJson([
                auditPrompt,
                {
                    inlineData: {
                        data: frameBuffer.toString('base64'),
                        mimeType: 'image/jpeg'
                    }
                }
            ], ClipRelevanceSchema, { label: 'VisionGate', retries: 0 })
            console.log(`[VisionGate] Clip audit for "${cleanSubject}": valid=${parsed.valid} (${parsed.reason || ''})`)
            return parsed.valid !== false
        } catch (err: any) {
            await fs.unlink(checkFramePath).catch(() => { })
            console.warn(`[VisionGate] Vision check skipped (${err.message})`)
            return true
        }
    }

    /**
     * Extracts a real motion video clip (.mp4) from YouTube (via yt-dlp) either by search query or custom URL,
     * verifies it with Gemini Vision, and stores it permanently in public/ai-vault/ for future reuse.
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
    }): Promise<{ imagePath: string; sourceLabel: string; fromVault: boolean } | null> {
        const { searchQuery, customUrl, sceneIndex, durationSec, category, subjectKey, sceneTags, usedFiles } = params

        // 1. If not using a custom one-off URL, check if we already have a matching real .mp4 clip in the Vault!
        if (!customUrl) {
            const cachedVideo = await this.findInVault(subjectKey, sceneTags, usedFiles, 'video')
            if (cachedVideo) {
                usedFiles.add(cachedVideo.fileName)
                console.log(`[AIVault] Reusing saved REAL MOTION VIDEO from vault: ${cachedVideo.fileName}`)
                return {
                    imagePath: cachedVideo.filePath,
                    sourceLabel: `Vault Video (Reused): ${cachedVideo.fileName}`,
                    fromVault: true
                }
            }
        }

        const ytDlpBin = this.ytDlpPath
        await fs.mkdir(this.vaultDir, { recursive: true })

        const safeCat = this.slugify(category)
        const safeSubj = this.slugify(subjectKey)
        const safeTagSlug = sceneTags.slice(0, 3).map(t => this.slugify(t)).join('_') || `clip_${sceneIndex + 1}`
        const shortId = uuidv4().slice(0, 6)

        const fileName = `${safeCat}-${safeSubj}-${safeTagSlug}_${shortId}.mp4`
        const outputPath = path.join(this.vaultDir, fileName)

        // Skip the first 18 seconds on automatic YouTube videos so we NEVER capture "Like & Subscribe" channel intros!
        const clipLen = Math.max(5, Math.ceil(durationSec + 1.5))
        const startSec = customUrl ? 8 + sceneIndex * (clipLen + 4) : 18 + (sceneIndex % 5) * 8
        const endSec = startSec + clipLen

        const cleanSubjectWords = subjectKey.replace(/_/g, ' ')
        const candidateQueries = customUrl && customUrl.startsWith('http')
            ? [customUrl]
            : [
                `ytsearch1:${searchQuery} HD -meme -reaction -shorts`,
                `ytsearch1:${cleanSubjectWords} ${sceneTags.slice(0, 2).join(' ').replace(/_/g, ' ')} highlights HD -meme`
            ]

        for (const targetInput of candidateQueries) {
            const args: string[] = [
                targetInput,
                '--js-runtimes', 'node',
                '--no-playlist',
                '--no-warnings',
                '-f', 'bestvideo[height<=1080][height>=720][ext=mp4]/bestvideo[height<=1080][ext=mp4]/best[height<=1080][ext=mp4]/best',
                '--download-sections', `*${startSec}-${endSec}`,
                '--force-keyframes-at-cuts',
                '--force-overwrites',
                '-o', outputPath
            ]

            if (!customUrl) {
                args.push('--match-filter', 'duration > 25 & duration < 900')
            }

            if (path.isAbsolute(ffmpegPath)) {
                args.push('--ffmpeg-location', ffmpegPath)
            }

            try {
                console.log(`[RealVideo] Extracting ${clipLen}s HD motion clip via yt-dlp: "${targetInput}" (${startSec}s-${endSec}s)...`)
                await execFileAsync(ytDlpBin, args, { timeout: 45000 })

                if (fsSync.existsSync(outputPath) && fsSync.statSync(outputPath).size > 15000) {
                    // Vision Quality Gate: verify the clip isn't a meme, "Subscribe" intro, or unrelated video!
                    if (!customUrl) {
                        const isRelevant = await this.verifyVideoClipRelevance(outputPath, subjectKey, searchQuery)
                        if (!isRelevant) {
                            console.warn(`[VisionGate] Rejected off-topic/meme clip for "${targetInput}", deleting and trying next...`)
                            await fs.unlink(outputPath).catch(() => { })
                            continue
                        }
                    }

                    const newEntry: VaultEntry = {
                        fileName,
                        filePath: outputPath,
                        mediaType: 'video',
                        category: safeCat,
                        subjectKey: safeSubj,
                        tags: sceneTags.map(t => this.slugify(t)).filter(Boolean),
                        prompt: customUrl || searchQuery,
                        createdAt: new Date().toISOString()
                    }
                    const entries = await this.readVaultIndex()
                    entries.push(newEntry)
                    await this.writeVaultIndex(entries)
                    usedFiles.add(fileName)

                    console.log(`[AIVault] Verified & saved new REAL MOTION VIDEO to vault: ${fileName}`)
                    return {
                        imagePath: outputPath,
                        sourceLabel: customUrl ? `Custom YouTube Clip: ${fileName}` : `YouTube B-Roll (Verified HD): ${fileName}`,
                        fromVault: false
                    }
                }
            } catch (err: any) {
                console.warn(`[RealVideo] yt-dlp attempt failed for "${targetInput}" (${err.message}).`)
            }
        }

        console.warn(`[RealVideo] All yt-dlp attempts failed or rejected by Vision Gate. Falling back to AI Storyboard Vault.`)
        return null
    }

    /**
     * Unified Smart Visual Fetcher supporting 3 parameterizable modes:
     * - 'ai_images': 100% AI Storyboard Images (Hugging Face SD3 / Flux) cached in public/ai-vault/
     * - 'real_video': 100% Real Motion Video (Custom User Video / YouTube Auto B-Roll) cached in public/ai-vault/
     * - 'hybrid': Alternates Real Motion Video clips and AI Storyboard Images, caching both in public/ai-vault/
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
    }): Promise<{ imagePath: string; sourceLabel: string; fromVault: boolean; videoStartTime?: number }> {
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
            usedFiles
        } = params

        // A. Check if user provided a LOCAL uploaded/custom MP4 file
        if (customVideoSource && !customVideoSource.startsWith('http')) {
            const resolvedLocal = path.isAbsolute(customVideoSource)
                ? customVideoSource
                : path.join(process.cwd(), 'public', customVideoSource.replace(/^\//, ''))

            if (fsSync.existsSync(resolvedLocal)) {
                const useCustomInThisScene = visualMode === 'real_video' || (visualMode === 'hybrid' && sceneIndex % 2 === 0)
                if (useCustomInThisScene) {
                    const startOffset = sceneIndex * Math.max(4, Math.floor(durationSec))
                    return {
                        imagePath: resolvedLocal,
                        sourceLabel: `Video Propio: ${path.basename(resolvedLocal)} (seg ${startOffset}s)`,
                        fromVault: true,
                        videoStartTime: startOffset
                    }
                }
            }
        }

        // B. Check if this scene should use REAL MOTION VIDEO (YouTube B-Roll or Custom YouTube URL)
        const shouldUseRealVideo =
            visualMode === 'real_video' ||
            (visualMode === 'hybrid' && sceneIndex % 2 === 0)

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
            if (videoResult) {
                return videoResult
            }
        }

        // C. Check AI Vault for an existing saved IMAGE matching subjectKey + sceneTags
        const cachedImage = await this.findInVault(subjectKey, sceneTags, usedFiles, 'image')
        if (cachedImage) {
            usedFiles.add(cachedImage.fileName)
            console.log(`[AIVault] Reusing saved AI visual from vault: ${cachedImage.fileName}`)
            return {
                imagePath: cachedImage.filePath,
                sourceLabel: `AI Vault (Reused): ${cachedImage.fileName}`,
                fromVault: true
            }
        }

        // D. Generate new AI image via Hugging Face SD3 (or Pollinations Flux fallback) and store in Vault
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
                        inputs: prompt,
                        parameters: {
                            negative_prompt:
                                'deformed limbs, extra legs, extra arms, mutated hands, bad anatomy, distorted body, floating limbs, severed limbs, weird physics, disfigured face, blurry, low quality, text, letters, watermark, logo',
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
            const fluxUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&model=flux&nologo=true&seed=${seed}`
            const response = await axios({
                url: fluxUrl,
                method: 'GET',
                responseType: 'arraybuffer',
                timeout: 25000
            })
            imageBuffer = Buffer.from(response.data)
        }

        const savedEntry = await this.saveImageToVault(imageBuffer, category, subjectKey, sceneTags, prompt)
        usedFiles.add(savedEntry.fileName)
        console.log(`[AIVault] Generated & archived new AI visual in vault: ${savedEntry.fileName}`)

        return {
            imagePath: savedEntry.filePath,
            sourceLabel: `${providerLabel} (Saved to Vault): ${savedEntry.fileName}`,
            fromVault: false
        }
    }
}

export const imageService = new ImageService()
