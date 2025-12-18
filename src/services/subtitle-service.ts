
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

export class SubtitleService {
    private tempDir: string

    constructor() {
        this.tempDir = path.join(process.cwd(), 'public', 'temp')
        // Ensure dir exists
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true })
        }
    }

    /**
     * Generates an SRT file for the given text distributed over durationSeconds.
     * Splitting by words for "Hormozi" style (fast paced).
     */
    async generateSRT(text: string, durationSeconds: number): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const words = text.replace(/\n/g, ' ').split(' ').filter(w => w.length > 0)
                const totalChars = words.reduce((acc, w) => acc + w.length, 0)
                const timePerChar = durationSeconds / totalChars

                let srtContent = ''
                let currentTime = 0
                let entryIndex = 1

                // Group words into chunks (e.g., 2-3 words) or single words for high energy
                // For "Hormozi", single word or pairs is best. Let's do single words for now.
                for (const word of words) {
                    const wordDuration = word.length * timePerChar

                    // Min duration check (0.2s) to avoid flickering
                    const displayDuration = Math.max(wordDuration, 0.2)
                    const endTime = Math.min(currentTime + displayDuration, durationSeconds)

                    srtContent += `${entryIndex}\n`
                    srtContent += `${this.formatTime(currentTime)} --> ${this.formatTime(endTime)}\n`
                    srtContent += `${word}\n\n`

                    // Advance time
                    // Overlap slightly or consecutive? Consecutive for now.
                    currentTime = endTime
                    entryIndex++
                }

                const filename = `subs_${uuidv4()}.srt`
                const filepath = path.join(this.tempDir, filename)
                fs.writeFileSync(filepath, srtContent)

                resolve(filepath)
            } catch (e) {
                console.error('SRT Generation Error:', e)
                reject(e)
            }
        })
    }

    private formatTime(seconds: number): string {
        const date = new Date(0)
        date.setMilliseconds(seconds * 1000)
        const iso = date.toISOString() // 1970-01-01T00:00:00.000Z
        return iso.slice(11, 23).replace('.', ',') // 00:00:00,000
    }
}

export const subtitleService = new SubtitleService()
