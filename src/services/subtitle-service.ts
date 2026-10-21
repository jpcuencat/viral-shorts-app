import fs from 'fs'
import path from 'path'
import { randomUUID as uuidv4 } from 'crypto'
import { WordBoundaryCue } from './audio-service'

export class SubtitleService {
    private tempDir: string

    constructor() {
        this.tempDir = path.join(process.cwd(), 'public', 'temp')
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true })
        }
    }

    /**
     * Generates an Advanced SubStation Alpha (.ass) subtitle file with OpusClip/Hormozi
     * word-by-word active yellow highlight on a 1080x1920 canvas, strictly synced to audio.
     */
    async generateSRT(text: string, durationSeconds: number, wordCues: WordBoundaryCue[] = []): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                // 1. Build word list with [startSec, endSec]
                let timedWords: { word: string; start: number; end: number }[] = []

                if (wordCues && wordCues.length > 0) {
                    timedWords = wordCues
                        .map(c => ({
                            word: (c.part || '').trim(),
                            start: Math.max(0, c.start / 1000),
                            end: Math.max(0, c.end / 1000)
                        }))
                        .filter(w => w.word.length > 0)
                }

                // Fallback to weighted timing if wordCues wasn't returned
                if (timedWords.length === 0) {
                    const rawWords = text.replace(/\n/g, ' ').split(/\s+/).filter(w => w.length > 0)
                    const weights = rawWords.map(w => {
                        const punctBonus = /[.,!?;:]$/.test(w) ? 3.0 : 0
                        return Math.max(w.length + punctBonus, 2)
                    })
                    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1
                    const effectiveDur = Math.max(durationSeconds - 0.1, 0.4)

                    let cursor = 0
                    timedWords = rawWords.map((w, idx) => {
                        const dur = (weights[idx] / totalWeight) * effectiveDur
                        const start = cursor
                        const end = idx === rawWords.length - 1 ? effectiveDur : Math.min(cursor + dur, effectiveDur)
                        cursor = end
                        return { word: w, start, end }
                    })
                }

                // 2. Sanitize timestamps: ensure monotonic non-overlapping [start, end]
                for (let i = 0; i < timedWords.length; i++) {
                    const w = timedWords[i]
                    if (w.end <= w.start) {
                        w.end = w.start + 0.12
                    }
                    if (i < timedWords.length - 1) {
                        const next = timedWords[i + 1]
                        if (next.start < w.start) {
                            next.start = w.end
                        }
                        // If tiny gap (< 0.18s) and no punctuation at end of word, bridge smoothly
                        const gap = next.start - w.end
                        const hasPunct = /[.,!?;:]$/.test(w.word)
                        if (gap > 0 && gap < 0.18 && !hasPunct) {
                            w.end = next.start
                        } else if (w.end > next.start) {
                            // Strictly prevent overlap!
                            w.end = next.start
                        }
                    }
                }

                // 3. Group timed words into 2-3 word display phrases, breaking on punctuation or speech pauses (>0.22s)
                const groups: { word: string; start: number; end: number }[][] = []
                let currentGroup: { word: string; start: number; end: number }[] = []

                for (let i = 0; i < timedWords.length; i++) {
                    const tw = timedWords[i]
                    const prev = currentGroup.length > 0 ? currentGroup[currentGroup.length - 1] : null
                    const pauseBefore = prev ? (tw.start - prev.end) : 0
                    const prevHadPunct = prev ? /[.,!?;:]$/.test(prev.word) : false
                    const candidateText = [...currentGroup.map(g => g.word), tw.word].join(' ')

                    if (
                        currentGroup.length >= 3 ||
                        (currentGroup.length >= 1 && candidateText.length > 18) ||
                        prevHadPunct ||
                        pauseBefore > 0.22
                    ) {
                        if (currentGroup.length > 0) groups.push(currentGroup)
                        currentGroup = [tw]
                    } else {
                        currentGroup.push(tw)
                    }
                }
                if (currentGroup.length > 0) {
                    groups.push(currentGroup)
                }

                // ASS Header for 1080x1920 vertical Shorts
                let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,76,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,5,3,2,60,60,380,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

                // Emit strictly non-overlapping Dialogue events
                for (const group of groups) {
                    for (let activeIdx = 0; activeIdx < group.length; activeIdx++) {
                        const activeWord = group[activeIdx]
                        const nextWordInGroup = activeIdx < group.length - 1 ? group[activeIdx + 1] : null
                        const startSec = activeWord.start
                        const endSec = nextWordInGroup
                            ? Math.max(startSec + 0.04, nextWordInGroup.start)
                            : Math.max(startSec + 0.08, activeWord.end)

                        if (endSec <= startSec) continue

                        const startAss = this.formatAssTime(startSec)
                        const endAss = this.formatAssTime(endSec)

                        const formattedPhrase = group
                            .map((w, idx) => {
                                const cleanWord = w.word.toUpperCase().replace(/[{}]/g, '')
                                if (idx === activeIdx) {
                                    return `{\\c&H00FFFF&}${cleanWord}{\\c&HFFFFFF&}`
                                }
                                return cleanWord
                            })
                            .join(' ')

                        assContent += `Dialogue: 0,${startAss},${endAss},Default,,0,0,0,,${formattedPhrase}\n`
                    }
                }

                const filename = `subs_${uuidv4()}.ass`
                const filepath = path.join(this.tempDir, filename)
                fs.writeFileSync(filepath, assContent, 'utf-8')

                resolve(filepath)
            } catch (e) {
                console.error('ASS Subtitle Generation Error:', e)
                reject(e)
            }
        })
    }

    private formatAssTime(seconds: number): string {
        const clamped = Math.max(0, seconds)
        const hrs = Math.floor(clamped / 3600)
        const mins = Math.floor((clamped % 3600) / 60)
        const secs = Math.floor(clamped % 60)
        const centis = Math.floor((clamped - Math.floor(clamped)) * 100)
        return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
    }
}

export const subtitleService = new SubtitleService()

