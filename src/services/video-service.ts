import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID as uuidv4 } from 'crypto'

import { FFMPEG_PATH, FFPROBE_PATH, SUBTITLE_FONT_FILE, MUSIC_VOLUME, TARGET_LUFS, escapeFilterPath } from '@/lib/media-config'

// Rutas multiplataforma (variables de entorno → binarios del proyecto → PATH del sistema)
ffmpeg.setFfmpegPath(FFMPEG_PATH)
ffmpeg.setFfprobePath(FFPROBE_PATH)

interface VideoSettings {
    width?: number
    height?: number
    fps?: number
}

class VideoService {
    private tempDir: string
    private outputDir: string
    private musicDir: string

    constructor() {
        this.tempDir = path.join(process.cwd(), 'public', 'temp')
        this.outputDir = path.join(process.cwd(), 'public', 'output')
        this.musicDir = path.join(process.cwd(), 'public', 'music')

        // Ensure dirs exist
        this.initDirs()
    }

    private async initDirs() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true })
            await fs.mkdir(this.outputDir, { recursive: true })
            await fs.mkdir(this.musicDir, { recursive: true })
        } catch (e) {
            console.error('Error creating dirs', e)
        }
    }

    /**
     * Get Audio Duration using ffprobe
     */
    async getAudioDuration(audioPath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) return reject(err)
                const duration = metadata.format.duration
                resolve(duration || 0)
            })
        })
    }

    /**
     * Get Video Dimensions (width & height) using ffprobe to detect horizontal (16:9) vs vertical (9:16) clips
     */
    async getVideoDimensions(videoPath: string): Promise<{ width: number; height: number }> {
        return new Promise((resolve) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) return resolve({ width: 1080, height: 1920 })
                const vStream = metadata?.streams?.find((s: any) => s.codec_type === 'video' || s.width)
                resolve({
                    width: vStream?.width || 1080,
                    height: vStream?.height || 1920
                })
            })
        })
    }

    /**
     * Ensures a default royalty-free ambient synth background track exists in public/music/
     * Returns path to a background .mp3/.wav file (or null if generation fails)
     */
    async ensureBackgroundMusic(): Promise<string | null> {
        try {
            await fs.mkdir(this.musicDir, { recursive: true })
            const existingFiles = (await fs.readdir(this.musicDir)).filter(f => /\.(mp3|wav)$/i.test(f))
            if (existingFiles.length > 0) {
                const chosen = existingFiles[Math.floor(Math.random() * existingFiles.length)]
                return path.join(this.musicDir, chosen)
            }

            // Synthesize a smooth 20-second atmospheric minor-chord synth pad directly into WAV (instant, 0 external deps)
            const defaultMusicPath = path.join(this.musicDir, 'ambient_viral_bg.wav')
            const sampleRate = 24000
            const durationSec = 20
            const totalSamples = sampleRate * durationSec
            const pcm = Buffer.alloc(totalSamples * 2) // 16-bit mono

            const freqs = [110.0, 164.81, 220.0, 261.63, 329.63] // A minor 7 warm pad
            for (let i = 0; i < totalSamples; i++) {
                const t = i / sampleRate
                const lfo = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.2 * t)
                // Smooth fade-in/out at loop boundaries
                const env = Math.min(1, t / 1.5, (durationSec - t) / 1.5)
                let val = 0
                for (let fIdx = 0; fIdx < freqs.length; fIdx++) {
                    val += Math.sin(2 * Math.PI * freqs[fIdx] * t) * (0.22 / (fIdx + 1))
                }
                const sampleInt = Math.max(-32767, Math.min(32767, Math.floor(val * lfo * env * 16000)))
                pcm.writeInt16LE(sampleInt, i * 2)
            }

            const header = Buffer.alloc(44)
            header.write('RIFF', 0)
            header.writeUInt32LE(36 + pcm.length, 4)
            header.write('WAVE', 8)
            header.write('fmt ', 12)
            header.writeUInt32LE(16, 16)
            header.writeUInt16LE(1, 20)
            header.writeUInt16LE(1, 22)
            header.writeUInt32LE(sampleRate, 24)
            header.writeUInt32LE(sampleRate * 2, 28)
            header.writeUInt16LE(2, 32)
            header.writeUInt16LE(16, 34)
            header.write('data', 36)
            header.writeUInt32LE(pcm.length, 40)

            await fs.writeFile(defaultMusicPath, Buffer.concat([header, pcm]))
            return defaultMusicPath
        } catch (e) {
            console.warn('[VideoService] Could not prepare background music:', e)
            return null
        }
    }

    /**
     * Helper to wrap text for FFmpeg
     */
    private wrapText(text: string, maxCharsPerLine = 30): string {
        const words = text.split(' ')
        let currentLine = ''
        const lines = []

        for (const word of words) {
            if ((currentLine + word).length > maxCharsPerLine) {
                lines.push(currentLine.trim())
                currentLine = word + ' '
            } else {
                currentLine += word + ' '
            }
        }
        lines.push(currentLine.trim())
        return lines.join('\n')
    }

    /**
     * Create a video from a single image/video and audio file with high-quality 9:16 scaling,
     * Ken Burns camera motion for static AI images, and zero-drift ASS karaoke subtitles.
     */
    async createSceneVideo(imagePath: string, audioPath: string, outputPath: string, text?: string, subtitlePath?: string, settings: VideoSettings & { videoStartTime?: number; duration?: number; sceneIndex?: number } = {}): Promise<string> {
        const { width = 1080, height = 1920, fps = 30, videoStartTime = 0, sceneIndex = 0 } = settings

        const isVideoBackground = imagePath.toLowerCase().endsWith('.mp4')
        const audioDuration = settings.duration || (await this.getAudioDuration(audioPath)) || 4

        console.log(`Creating scene: ${path.basename(imagePath)} (IsVideo: ${isVideoBackground}, dur: ${audioDuration.toFixed(2)}s) + ${path.basename(audioPath)}`)

        const filters: string[] = []

        if (isVideoBackground) {
            const dims = await this.getVideoDimensions(imagePath)
            const isHorizontal = dims.width > dims.height

            if (isHorizontal) {
                // SMART BROADCAST 9:16 CINEMA CANVAS FOR 16:9 VIDEOS:
                // Fills ~70% of the vertical 9:16 frame with sharp action (no tiny letterbox strip)
                // over a darkened cinema-blurred 9:16 background + subtle dark lower-third for subtitle contrast.
                filters.push(
                    `split[bg][fg];[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=28,eq=brightness=-0.30[bgblur];[fg]scale=2040:-2,crop=${width}:ih[fgsharp];[bgblur][fgsharp]overlay=(W-w)/2:(H-h)/2-110,drawbox=x=0:y=1400:w=${width}:h=520:color=black@0.32:t=fill`
                )
            } else {
                // Native vertical 9:16 video clip + subtle lower-third contrast band for subtitles
                filters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`)
                filters.push(`crop=${width}:${height}`)
                filters.push(`drawbox=x=0:y=1420:w=${width}:h=500:color=black@0.26:t=fill`)
            }
            filters.push(`setsar=1`)
            filters.push(`fps=${fps}`)
            filters.push(`setpts=PTS-STARTPTS`)
        } else {
            // 1B. STATIC AI IMAGE BACKGROUND: Native 9:16 crisp scale + smooth Ken Burns camera motion + lower-third subtitle contrast
            const totalFrames = Math.ceil((audioDuration + 0.5) * fps)
            filters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`)
            filters.push(`crop=${width}:${height}`)
            filters.push(`setsar=1`)
            filters.push(`zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps}`)
            filters.push(`drawbox=x=0:y=1420:w=${width}:h=500:color=black@0.25:t=fill`)
            filters.push(`setsar=1`)
            filters.push(`setpts=PTS-STARTPTS`)
        }

        // Subtle color-grading pop for viral Shorts aesthetic
        filters.push(`eq=contrast=1.05:saturation=1.10`)

        // 2. Render Subtitles on top of the 0-based PTS 1080x1920 canvas
        if (subtitlePath) {
            const escapedSubtitlePath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:')

            if (subtitlePath.toLowerCase().endsWith('.ass')) {
                filters.push(`ass=filename='${escapedSubtitlePath}'`)
            } else {
                const style = `Alignment=2,Fontname=Arial,Fontsize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=3,Shadow=1,MarginV=85,Bold=1`
                filters.push(`subtitles=filename='${escapedSubtitlePath}':force_style='${style}'`)
            }
        }
        else if (text) {
            const sanitizedText = this.wrapText(text)
                .replace(/:/g, '\\:')
                .replace(/'/g, '')
                .replace(/\n/g, '\\n')

            const fontPath = escapeFilterPath(SUBTITLE_FONT_FILE)
            filters.push(`drawtext=fontfile='${fontPath}':text='${sanitizedText}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-(h*0.25):borderw=4:bordercolor=black:line_spacing=20`)
        }

        // Force uniform yuv420p TV-range format after subtitles so .mp4 and .jpg scenes have 100% identical H.264 stream headers
        filters.push(`format=yuv420p`)

        return new Promise((resolve, reject) => {
            const command = ffmpeg()

            if (isVideoBackground) {
                const inputOpts = ['-stream_loop -1']
                if (videoStartTime > 0) {
                    inputOpts.push(`-ss ${videoStartTime}`)
                }
                command.input(imagePath).inputOptions(inputOpts)
            } else {
                command.input(imagePath)
            }

            command
                .input(audioPath)
                .videoFilters(filters)
                .audioFilters(['asetpts=PTS-STARTPTS'])
                .outputOptions([
                    '-c:v libx264',
                    '-preset fast',
                    '-crf 18',
                    '-maxrate 8M',
                    '-bufsize 16M',
                    '-pix_fmt yuv420p',
                    '-color_range tv',
                    '-colorspace bt709',
                    '-color_primaries bt709',
                    '-color_trc bt709',
                    '-video_track_timescale 30000',
                    '-r 30',
                    '-c:a aac',
                    '-b:a 192k',
                    '-ar 44100',
                    '-ac 2',
                    `-t ${audioDuration.toFixed(3)}`, // Lock scene video length to exact audio length to prevent cumulative drift
                    '-avoid_negative_ts make_zero',
                    '-map 0:v:0',
                    '-map 1:a:0'
                ])
                .output(outputPath)
                .on('end', () => resolve(outputPath))
                .on('error', (err) => {
                    console.error('FFmpeg Error (Scene):', err.message)
                    reject(err)
                })
                .run()
        })
    }

    /**
     * EXTRACT FRAME FOR AI AUDIT
     * Extracts a jpg frame at the specified second mark from the video
     */
    async extractFrame(videoPath: string, timeSec: number = 1.5): Promise<string> {
        return new Promise((resolve) => {
            const framePath = path.join(this.tempDir, `frame_${uuidv4()}.jpg`)

            const safeVideoPath = videoPath.replace(/\\/g, '/')
            const safeFramePath = framePath.replace(/\\/g, '/')

            ffmpeg()
                .input(safeVideoPath)
                .inputOptions([`-ss ${timeSec.toFixed(2)}`])
                .outputOptions(['-vframes 1', '-q:v 2', '-update 1'])
                .output(safeFramePath)
                .on('end', () => resolve(framePath))
                .on('error', (err) => {
                    console.error('Frame Extraction Error:', err.message)
                    resolve('')
                })
                .run()
        })
    }

    /**
     * Concatenate multiple videos
     */
    async concatenateVideos(videoPaths: string[], outputPath: string): Promise<string> {
        return new Promise(async (resolve, reject) => {
            try {
                const listFileName = `concat_${uuidv4()}.txt`
                const listFilePath = path.join(this.tempDir, listFileName)

                const listContent = videoPaths
                    .map(p => `file '${p.replace(/\\/g, '/')}'`)
                    .join('\n')

                await fs.writeFile(listFilePath, listContent)

                const safeListPath = listFilePath.replace(/\\/g, '/')
                console.log(`[VideoService] Concatenating via list: ${safeListPath} -> ${outputPath}`)

                ffmpeg()
                    .input(safeListPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions([
                        '-c:v libx264',
                        '-preset veryfast',
                        '-crf 18',
                        '-pix_fmt yuv420p',
                        '-color_range tv',
                        '-colorspace bt709',
                        '-r 30',
                        '-c:a aac',
                        '-b:a 192k',
                        '-ar 44100',
                        '-ac 2',
                        '-movflags +faststart'
                    ])
                    .output(outputPath)
                    .on('end', async () => {
                        await fs.unlink(listFilePath).catch(() => { })
                        resolve(outputPath)
                    })
                    .on('error', (err) => {
                        console.error('FFmpeg Concatenate Error:', err.message)
                        reject(err)
                    })
                    .run()

            } catch (err) {
                reject(err)
            }
        })
    }

    /**
     * Normaliza solo la sonoridad (sin música) a TARGET_LUFS. Devuelve false si falla.
     */
    private normalizeLoudness(inputVideoPath: string, outputVideoPath: string): Promise<boolean> {
        return new Promise((resolve) => {
            ffmpeg()
                .input(inputVideoPath)
                .audioFilters([`loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`, 'aresample=44100'])
                .outputOptions(['-c:v copy', '-c:a aac', '-b:a 192k', '-movflags +faststart'])
                .output(outputVideoPath)
                .on('end', () => resolve(true))
                .on('error', (err) => {
                    console.warn('[VideoService] loudnorm failed:', err.message)
                    resolve(false)
                })
                .run()
        })
    }

    /**
     * Mixes subtle background music (10% volume with audio ducking) under the concatenated voiceover video
     */
    async mixBackgroundMusic(inputVideoPath: string, outputVideoPath: string): Promise<string> {
        const musicPath = await this.ensureBackgroundMusic()
        if (!musicPath) {
            const normalized = await this.normalizeLoudness(inputVideoPath, outputVideoPath)
            if (normalized) await fs.unlink(inputVideoPath).catch(() => { })
            else await fs.rename(inputVideoPath, outputVideoPath)
            return outputVideoPath
        }

        return new Promise((resolve) => {
            ffmpeg()
                .input(inputVideoPath)
                .input(musicPath)
                .inputOptions(['-stream_loop -1'])
                .complexFilter([
                    // La voz se divide: una copia va a la mezcla y otra actúa como "llave" del ducking
                    '[0:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[voice][key]',
                    // sidechaincompress exige mismo formato en ambas entradas (la música es 24 kHz mono)
                    `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${MUSIC_VOLUME}[bgraw]`,
                    // Ducking real: la música baja automáticamente mientras habla el narrador
                    '[bgraw][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350:makeup=1[bgduck]',
                    // normalize=0 evita que amix divida el volumen de la voz entre 2
                    '[voice][bgduck]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[mix]',
                    // Sonoridad estándar de plataformas (YouTube/TikTok/IG ≈ -14 LUFS)
                    `[mix]loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11,aresample=44100[aout]`
                ])
                .outputOptions([
                    '-c:v copy',
                    '-map 0:v:0',
                    '-map [aout]',
                    '-c:a aac',
                    '-b:a 192k',
                    '-shortest',
                    '-movflags +faststart'
                ])
                .output(outputVideoPath)
                .on('end', async () => {
                    await fs.unlink(inputVideoPath).catch(() => { })
                    resolve(outputVideoPath)
                })
                .on('error', async (err) => {
                    console.warn('[VideoService] Music mix failed, keeping voice-only video:', err.message)
                    const normalized = await this.normalizeLoudness(inputVideoPath, outputVideoPath)
                    if (!normalized) await fs.rename(inputVideoPath, outputVideoPath).catch(() => { })
                    else await fs.unlink(inputVideoPath).catch(() => { })
                    resolve(outputVideoPath)
                })
                .run()
        })
    }

    /**
     * Main pipeline: Image[] + Audio[] -> Scene Videos -> Concatenated -> Mixed with Background Music -> Final Video
     * When `options.reelId` is provided, each scene's rendered .mp4 is persisted in `public/output/scenes_${reelId}/scene_${i}.mp4`.
     * When `options.onlySceneIndex` is provided, ONLY that single scene is re-rendered while all other scenes remain 100% untouched!
     */
    async generateVideo(
        scenes: { imagePath: string; audioPath: string; text?: string; subtitlePath?: string; videoStartTime?: number; duration?: number }[],
        options: { reelId?: string; onlySceneIndex?: number } = {}
    ): Promise<string> {
        const sceneVideos: string[] = []
        const { reelId, onlySceneIndex } = options

        try {
            await this.initDirs()

            const sceneCacheDir = reelId
                ? path.join(this.outputDir, `scenes_${reelId}`)
                : null

            if (sceneCacheDir) {
                await fs.mkdir(sceneCacheDir, { recursive: true })
            }

            // 1. Generate (or reuse untouched cached) Scene Videos
            for (let i = 0; i < scenes.length; i++) {
                const { imagePath, audioPath, text, subtitlePath, videoStartTime, duration } = scenes[i]
                const outputPath = sceneCacheDir
                    ? path.join(sceneCacheDir, `scene_${i}.mp4`)
                    : path.join(this.tempDir, `scene_${i}_${uuidv4()}.mp4`)

                let canReuseCachedScene = false
                if (sceneCacheDir && onlySceneIndex !== undefined && i !== onlySceneIndex) {
                    try {
                        const stat = await fs.stat(outputPath)
                        if (stat.size > 5000) {
                            canReuseCachedScene = true
                        }
                    } catch {
                        canReuseCachedScene = false
                    }
                }

                if (canReuseCachedScene) {
                    console.log(`[VideoService] Keeping untouched scene #${i + 1}: ${outputPath}`)
                } else {
                    await this.createSceneVideo(imagePath, audioPath, outputPath, text, subtitlePath, {
                        videoStartTime,
                        duration,
                        sceneIndex: i
                    })
                }
                sceneVideos.push(outputPath)
            }

            // 2. Concatenate
            const concatFilename = `concat_raw_${uuidv4()}.mp4`
            const concatPath = path.join(this.tempDir, concatFilename)
            await this.concatenateVideos(sceneVideos, concatPath)

            // 3. Mix subtle background music
            const finalFilename = `final_${uuidv4()}.mp4`
            const finalPath = path.join(this.outputDir, finalFilename)
            await this.mixBackgroundMusic(concatPath, finalPath)

            // 4. Cleanup temporary Scene Videos only if not persisted in sceneCacheDir
            if (!sceneCacheDir) {
                sceneVideos.forEach(p => fs.unlink(p).catch(() => { }))
            }

            return `/output/${finalFilename}`

        } catch (err) {
            console.error('Generate Video Pipeline Error:', err)
            throw err
        }
    }
}

export const videoService = new VideoService()

