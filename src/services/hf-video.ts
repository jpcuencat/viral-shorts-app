import axios from 'axios'
import sharp from 'sharp'
import { getHfToken } from '@/services/hf-image'

/**
 * ANIMAR IMÁGENES CON HUGGING FACE (imagen → video corto)
 * Convierte una imagen fija en un clip de unos segundos con movimiento real (cámara, personas, luces),
 * en vez del zoom lento. Va por router.huggingface.co (proveedor fal) y cobra de los créditos de HF.
 * Es más caro que una imagen, por eso solo se usa en escenas clave (ver HF_ANIMATE_SCENES).
 *
 *  1. LTX-2 distilled (Lightricks): rápido y buena calidad.
 *  2. Wan 2.2 A14B (Alibaba): movimiento muy natural, más lento.
 */
interface HfVideoModel { id: string; label: string; body: (imageUrl: string, prompt: string) => Record<string, unknown> }

const VIDEO_CHAIN: HfVideoModel[] = [
    { id: 'fal-ai/ltx-2-19b/distilled/image-to-video', label: 'LTX-2', body: (image_url, prompt) => ({ image_url, prompt, generate_audio: false }) },
    { id: 'fal-ai/wan/v2.2-a14b/image-to-video', label: 'Wan 2.2', body: (image_url, prompt) => ({ image_url, prompt, resolution: '720p', aspect_ratio: 'auto' }) },
]

const ROUTER = 'https://router.huggingface.co/fal-ai'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function errText(err: any): string {
    const body = err?.response?.data
    let txt = ''
    try { txt = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body) } catch { /* nada */ }
    return `${err?.response?.status || ''} ${txt || err?.message || err}`.trim().slice(0, 300)
}

/** Cola de fal a través del router de HF: enviar → consultar estado → leer resultado. */
async function runQueued(model: HfVideoModel, token: string, imageDataUrl: string, prompt: string, timeoutMs: number): Promise<Buffer> {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const submit = await axios.post(`${ROUTER}/${model.id}?_subdomain=queue`, model.body(imageDataUrl, prompt), { headers, timeout: 60000 })
    const responseUrl: string | undefined = submit.data?.response_url
    if (!responseUrl) throw new Error('la cola no devolvió response_url: ' + JSON.stringify(submit.data).slice(0, 200))
    const reqPath = new URL(responseUrl).pathname // /fal-ai/<modelo>/requests/<id>
    const statusUrl = `${ROUTER}${reqPath}/status?_subdomain=queue`
    const resultUrl = `${ROUTER}${reqPath}?_subdomain=queue`
    const t0 = Date.now()
    while (true) {
        if (Date.now() - t0 > timeoutMs) throw new Error(`tiempo agotado (${Math.round(timeoutMs / 1000)} s)`)
        await sleep(4000)
        const st = await axios.get(statusUrl, { headers, timeout: 30000 })
        const status = st.data?.status
        if (status === 'COMPLETED') break
        if (status && !['IN_QUEUE', 'IN_PROGRESS'].includes(status)) throw new Error('estado ' + status)
    }
    const res = await axios.get(resultUrl, { headers, timeout: 60000 })
    const url = res.data?.video?.url || res.data?.videos?.[0]?.url
    if (!url) throw new Error('resultado sin video: ' + JSON.stringify(res.data).slice(0, 200))
    const vid = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 })
    return Buffer.from(vid.data)
}

/** Imagen local → data URL vertical 720x1280 (más liviana para enviar). */
async function toDataUrl(imagePath: string): Promise<string> {
    const buf = await sharp(imagePath).resize(720, 1280, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer()
    return `data:image/jpeg;base64,${buf.toString('base64')}`
}

const MOTION_HINT = 'Subtle realistic motion, slow cinematic camera push-in, natural movement of people and lights, documentary news footage, stable, no text, no morphing.'

/** Anima una imagen. Devuelve null si ningún modelo respondió (el llamador sigue con el zoom normal). */
export async function animateImage(imagePath: string, prompt: string, opts: { timeoutMs?: number } = {}): Promise<{ buffer: Buffer; label: string; seconds: number } | null> {
    const token = getHfToken()
    if (!token) return null
    const dataUrl = await toDataUrl(imagePath)
    const fullPrompt = `${prompt.slice(0, 600)}. ${MOTION_HINT}`
    for (const m of VIDEO_CHAIN) {
        const t0 = Date.now()
        try {
            const buffer = await runQueued(m, token, dataUrl, fullPrompt, opts.timeoutMs ?? 240000)
            const seconds = (Date.now() - t0) / 1000
            console.log(`[HFVideo] ${m.label} OK en ${seconds.toFixed(0)} s (${Math.round(buffer.length / 1024)} KB)`)
            return { buffer, label: `HF ${m.label}`, seconds }
        } catch (err: any) {
            console.warn(`[HFVideo] ${m.label} falló: ${errText(err)}`)
        }
    }
    return null
}

/** Diagnóstico: anima la misma imagen con cada modelo. */
export async function diagnoseHfVideo(imagePath: string, prompt: string) {
    const token = getHfToken()
    if (!token) return [{ label: 'HF_TOKEN', ok: false, seconds: 0, error: 'Falta HF_TOKEN' }]
    const dataUrl = await toDataUrl(imagePath)
    const out: { label: string; ok: boolean; seconds: number; error?: string; buffer?: Buffer }[] = []
    for (const m of VIDEO_CHAIN) {
        const t0 = Date.now()
        try {
            const buffer = await runQueued(m, token, dataUrl, `${prompt}. ${MOTION_HINT}`, 280000)
            out.push({ label: m.label, ok: true, seconds: (Date.now() - t0) / 1000, buffer })
        } catch (err: any) {
            out.push({ label: m.label, ok: false, seconds: (Date.now() - t0) / 1000, error: errText(err) })
        }
    }
    return out
}
