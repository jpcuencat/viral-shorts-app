// @ts-ignore
const { EdgeTTS } = require('node-edge-tts')
// @ts-ignore
const drm = require('node-edge-tts/dist/drm')
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { randomUUID as uuidv4 } from 'crypto'

export interface WordBoundaryCue {
    part: string
    start: number // ms
    end: number   // ms
}

const WINDOWS_FILE_TIME_EPOCH = BigInt(11644473600)
let clockOffsetMs = 0
let clockSynced = false

async function syncServerClock() {
    if (clockSynced) return
    try {
        const res = await fetch('https://www.google.com', { method: 'HEAD' })
        const dateHeader = res.headers.get('date')
        if (dateHeader) {
            const serverTime = new Date(dateHeader).getTime()
            clockOffsetMs = serverTime - Date.now()
            clockSynced = true
        }
    } catch {
        // Ignore and use local clock if offline
    }
}

// Patch node-edge-tts DRM token generator to account for local PC clock skew
drm.generateSecMsGecToken = function () {
    const syncedNowMs = Date.now() + clockOffsetMs
    const ticks = BigInt(Math.floor((syncedNowMs / 1000) + Number(WINDOWS_FILE_TIME_EPOCH))) * BigInt(10000000)
    const roundedTicks = ticks - (ticks % BigInt(3000000000))
    const strToHash = `${roundedTicks}${drm.TRUSTED_CLIENT_TOKEN}`
    return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase()
}

function createWavBufferFromPcm(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
    const blockAlign = (numChannels * bitsPerSample) / 8
    const dataSize = pcmBuffer.length
    const header = Buffer.alloc(44)

    header.write('RIFF', 0)
    header.writeUInt32LE(36 + dataSize, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16) // PCM chunk size
    header.writeUInt16LE(1, 20)  // Audio format 1 = PCM
    header.writeUInt16LE(numChannels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitsPerSample, 34)
    header.write('data', 36)
    header.writeUInt32LE(dataSize, 40)

    return Buffer.concat([header, pcmBuffer])
}

class AudioService {
    private tempDir: string

    constructor() {
        this.tempDir = path.join(process.cwd(), 'public', 'temp')
        fs.mkdirSync(this.tempDir, { recursive: true })
    }

    private async generateGeminiTTS(text: string, filepath: string): Promise<string> {
        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) throw new Error('GEMINI_API_KEY missing for Gemini TTS')

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Lee esto en español con tono dinámico, claro y energético de creador de Shorts: ${text}`
                    }]
                }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Puck' }
                        }
                    }
                }
            })
        })

        if (!res.ok) {
            throw new Error(`Gemini TTS HTTP ${res.status}`)
        }

        const data = await res.json()
        const base64Audio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
        if (!base64Audio) {
            throw new Error('No audio data returned from Gemini TTS')
        }

        const pcmBuffer = Buffer.from(base64Audio, 'base64')
        const wavBuffer = createWavBufferFromPcm(pcmBuffer, 24000, 1, 16)
        const wavPath = filepath.replace(/\.mp3$/i, '.wav')
        fs.writeFileSync(wavPath, wavBuffer)
        return wavPath
    }

    /**
     * Generates neural voiceover and returns both the audio path and exact word-boundary timestamps (when available)
     */
    async generateAudioWithSubtitles(
        text: string,
        lang = 'es',
        voiceId = 'es-EC-LuisNeural'
    ): Promise<{ audioPath: string; wordCues: WordBoundaryCue[] }> {
        const filename = `audio_${uuidv4()}.mp3`
        const filepath = path.join(this.tempDir, filename)

        // 1. Try EdgeTTS (with 1 automatic retry on 429)
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                await syncServerClock()

                const voice = lang === 'es' ? (voiceId || 'es-EC-LuisNeural') : 'en-US-ChristopherNeural'
                const langMatch = voice.match(/^[a-z]{2}-[A-Z]{2}/)
                const fullLang = langMatch ? langMatch[0] : (lang === 'es' ? 'es-EC' : 'en-US')

                const tts = new EdgeTTS({
                    voice,
                    lang: fullLang,
                    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                    saveSubtitles: true,
                    rate: '+8%',
                    timeout: 8000
                })

                await tts.ttsPromise(text, filepath)

                let wordCues: WordBoundaryCue[] = []
                const jsonSubPath = `${filepath}.json`
                if (fs.existsSync(jsonSubPath)) {
                    try {
                        wordCues = JSON.parse(fs.readFileSync(jsonSubPath, 'utf-8'))
                        fs.unlinkSync(jsonSubPath)
                    } catch {
                        // Ignore subtitle JSON parse error
                    }
                }

                // Small cooldown to avoid Edge TTS 429 burst limit on next scene
                await new Promise(r => setTimeout(r, 300))
                return { audioPath: filepath, wordCues }
            } catch (e: any) {
                if (attempt === 1) {
                    await new Promise(r => setTimeout(r, 700))
                } else {
                    console.warn(`[AudioService] EdgeTTS unavailable (${e?.message || e}), trying Gemini 2.5 Native TTS...`)
                }
            }
        }

        // 2. Fallback to Gemini 2.5 Flash Native TTS (Neural Studio Voice)
        try {
            const wavPath = await this.generateGeminiTTS(text, filepath)
            return { audioPath: wavPath, wordCues: [] }
        } catch (geminiErr: any) {
            throw new Error(`No se pudo generar la voz: Edge TTS y Gemini TTS fallaron (${geminiErr?.message || geminiErr}).`)
        }
    }
}

export const audioService = new AudioService()


