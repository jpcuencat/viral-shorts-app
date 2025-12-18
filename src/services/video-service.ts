import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'

// Configure FFmpeg path locally
const ffmpegPath = path.join(process.cwd(), 'ffmpeg', 'bin', 'ffmpeg.exe')
const ffprobePath = path.join(process.cwd(), 'ffmpeg', 'bin', 'ffprobe.exe')

// Only set if they exist (or force it if we are sure)
ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath)

interface VideoSettings {
    width?: number
    height?: number
    fps?: number
}

class VideoService {
    private tempDir: string
    private outputDir: string

    constructor() {
        this.tempDir = path.join(process.cwd(), 'public', 'temp')
        this.outputDir = path.join(process.cwd(), 'public', 'output')

        // Ensure dirs exist
        this.initDirs()
    }

    private async initDirs() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true })
            await fs.mkdir(this.outputDir, { recursive: true })
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
     * Create a video from a single image and audio file
     */
    async createSceneVideo(imagePath: string, audioPath: string, outputPath: string, text?: string, subtitlePath?: string, settings: VideoSettings & { videoStartTime?: number } = {}): Promise<string> {
        const { width = 1080, height = 1920, fps = 30, videoStartTime = 0 } = settings

        const isVideoBackground = imagePath.toLowerCase().endsWith('.mp4')

        // Simple logging for debugging
        console.log(`Creating scene: ${path.basename(imagePath)} (IsVideo: ${isVideoBackground}) + ${path.basename(audioPath)}`)

        const filters: string[] = []

        // If subtitle is provided, use it. Otherwise fallback to static text.
        if (subtitlePath) {
            // FFmpeg requires escaped paths for subtitle filter
            // e.g D:/path/to/file.srt -> D\:/path/to/file.srt
            const escapedSubtitlePath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:')

            // Hormozi Style:
            // Alignment=2 (Bottom Center)
            // MarginV=60 (Move up a bit)
            // Fontsize=24 (Large)
            // PrimaryColour=&H00FFFFFF (White - BGR AA BB GG RR)
            // Outline=1 (Black outline)
            // BackColour=&H80000000 (Transparent Black Box background optionally)
            const style = `Alignment=2,Fontname=Arial,Fontsize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H40000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=70,Bold=1`
            filters.push(`subtitles=filename='${escapedSubtitlePath}':force_style='${style}'`)
        }
        else if (text) {
            // Escape special characters for FFmpeg
            const sanitizedText = this.wrapText(text)
                .replace(/:/g, '\\:')
                .replace(/'/g, '') // remove single quotes to avoid breaking command
                .replace(/\n/g, '\\n') // Literal newline for ffmpeg

            // Windows Font Path (Hardcoded for now, ideal would be to bundle a font)
            const fontPath = 'C\\:/Windows/Fonts/arial.ttf'

            // DrawText: White text, black border (outline), centered horizontally, bottom 20%
            filters.push(`drawtext=fontfile='${fontPath}':text='${sanitizedText}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=h-(h*0.25):box=1:boxcolor=black@0.6:boxborderw=20:line_spacing=20`)
        }

        return new Promise((resolve, reject) => {
            const command = ffmpeg()

            if (isVideoBackground) {
                // VIDEO BACKGROUND LOGIC
                // Use stream_loop -1 (infinite) BEFORE input to ensure it never runs out
                command.input(imagePath).inputOptions(['-stream_loop -1', `-ss ${videoStartTime}`])
            } else {
                // IMAGE BACKGROUND LOGIC
                command.input(imagePath).inputOptions(['-loop 1'])
            }

            command
                .input(audioPath)
                .outputOptions([
                    '-c:v libx264',
                    // '-tune stillimage', // Tune stillimage is bad for video
                    '-c:a copy', // Copy audio codec (TTS)
                    '-pix_fmt yuv420p',
                    '-shortest', // Stop when shortest input ends (usually audio if video is long enough)
                    `-r ${fps}`,
                    `-s ${width}x${height}`,
                    '-avoid_negative_ts make_zero', // Fix timestamps
                    '-map 0:v', // Use Video from Input 0 (Background)
                    '-map 1:a'  // Use Audio from Input 1 (TTS)
                ])

            if (filters.length > 0) {
                command.videoFilters(filters)
            }

            command
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
     * Extracts a jpg frame at 1s mark from the video
     */
    async extractFrame(videoPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const framePath = path.join(this.tempDir, `frame_${uuidv4()}.jpg`)

            // Normalize for Windows
            const safeVideoPath = videoPath.replace(/\\/g, '/')
            const safeFramePath = framePath.replace(/\\/g, '/')

            ffmpeg()
                .input(safeVideoPath)
                .outputOptions(['-vframes 1', '-ss 00:00:01']) // Capture 1 frame at 1s
                .output(safeFramePath)
                .on('end', () => resolve(framePath))
                .on('error', (err) => {
                    console.error('Frame Extraction Error:', err.message)
                    resolve('') // Resolve empty string on error to not break flow
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
                // Create list file
                const listFileName = `concat_${uuidv4()}.txt`
                const listFilePath = path.join(this.tempDir, listFileName)

                // Format: file 'path' (escape backslashes for Windows)
                const listContent = videoPaths
                    .map(p => `file '${p.replace(/\\/g, '/')}'`)
                    .join('\n')

                await fs.writeFile(listFilePath, listContent)

                // Normalize paths for FFmpeg CLI Input (List File needs forward slashes)
                const safeListPath = listFilePath.replace(/\\/g, '/')

                // Output Path: Use the raw system path provided (Node handles quoting usually)
                // If it fails again, we might try safeOutputPath, but 'Invalid Argument' usually means folder missing.
                // Reverting to `outputPath` as it was passed.
                console.log(`[VideoService] Concatenating via list: ${safeListPath} -> ${outputPath}`)

                ffmpeg()
                    .input(safeListPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c copy'])
                    .output(outputPath)
                    .on('end', async () => {
                        // Cleanup list file
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
     * Main pipeline: Image[] + Audio[] -> Final Video
     */
    async generateVideo(scenes: { imagePath: string; audioPath: string; text?: string; subtitlePath?: string; videoStartTime?: number }[]): Promise<string> {
        const sceneVideos: string[] = []

        try {

            // Ensure directories exist immediately before writing
            await this.initDirs()

            // 1. Generate Scene Videos
            for (let i = 0; i < scenes.length; i++) {
                const { imagePath, audioPath, text, subtitlePath, videoStartTime } = scenes[i]
                const outputPath = path.join(this.tempDir, `scene_${i}_${uuidv4()}.mp4`)

                await this.createSceneVideo(imagePath, audioPath, outputPath, text, subtitlePath, { videoStartTime })
                sceneVideos.push(outputPath)
            }

            // 2. Concatenate
            const finalFilename = `final_${uuidv4()}.mp4`
            const finalPath = path.join(this.outputDir, finalFilename) // public/output/...

            await this.concatenateVideos(sceneVideos, finalPath)

            // 3. Cleanup Scene Videos (Async, don't wait)
            sceneVideos.forEach(p => fs.unlink(p).catch(() => { }))

            // Return relative path for frontend
            return `/output/${finalFilename}`

        } catch (err) {
            console.error('Generate Video Pipeline Error:', err)
            throw err
        }
    }
}

export const videoService = new VideoService()
