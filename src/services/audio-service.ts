// @ts-ignore
const { EdgeTTS } = require('node-edge-tts')
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'

class AudioService {
    private tempDir: string

    constructor() {
        this.tempDir = path.join(process.cwd(), 'public', 'temp')
        fs.mkdirSync(this.tempDir, { recursive: true })
    }

    async generateAudio(text: string, lang = 'es'): Promise<string> {
        return new Promise(async (resolve, reject) => {
            try {
                const filename = `audio_${uuidv4()}.mp3`
                const filepath = path.join(this.tempDir, filename)

                // Select Neural Voice
                // es-MX-DaliaNeural: Mexican/Latino (Good for viral reels)
                // es-ES-AlvaroNeural: Spain (Alternative)
                const voice = lang === 'es' ? 'es-MX-DaliaNeural' : 'en-US-ChristopherNeural'

                const tts = new EdgeTTS({
                    voice: voice,
                    lang: lang,
                    outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
                })

                await tts.ttsPromise(text, filepath)
                resolve(filepath)

            } catch (e) {
                console.error('EdgeTTS Error:', e)
                reject(e)
            }
        })
    }
}

export const audioService = new AudioService()
