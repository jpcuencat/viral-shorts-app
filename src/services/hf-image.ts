import axios from 'axios'

/**
 * GENERACIÓN DE IMÁGENES CON HUGGING FACE (Inference Providers)
 * Todas las llamadas van por router.huggingface.co con el HF_TOKEN: Hugging Face enruta al proveedor
 * (fal, Replicate, nscale...) y cobra de los créditos de la cuenta, sin claves extra.
 *
 * Cadena de modelos (octubre 2026), del mejor al de respaldo. Si uno falla (caído, sin créditos,
 * tiempo agotado) se prueba el siguiente. Se puede cambiar con HF_IMAGE_CHAIN="proveedor:modelo,..."
 *  1. Z-Image Turbo (Tongyi-MAI): muy fotorrealista y el que mejor respeta "sin texto" (sin letras
 *     inventadas en chalecos o carteles, clave para la credibilidad de un canal de noticias). ~6-12 s.
 *  2. Krea 2 Turbo: sigue muy bien la escena pedida, pero tiende a inventar letras en la ropa.
 *  3. Z-Image Turbo en Replicate: mismo modelo por otro proveedor.
 *  4. FLUX.1 schnell en nscale: barato y estable.
 *  5. SD3 Medium (hf-inference): el modelo anterior, último recurso dentro de HF.
 */
type Provider = 'fal-ai' | 'replicate' | 'nscale' | 'hf-inference'
interface HfImageModel { provider: Provider; id: string; label: string }

const DEFAULT_CHAIN: HfImageModel[] = [
    { provider: 'fal-ai', id: 'fal-ai/z-image/turbo', label: 'Z-Image Turbo' },
    { provider: 'fal-ai', id: 'fal-ai/krea-2/turbo', label: 'Krea 2 Turbo' },
    { provider: 'replicate', id: 'prunaai/z-image-turbo', label: 'Z-Image Turbo (Replicate)' },
    { provider: 'nscale', id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 schnell' },
    { provider: 'hf-inference', id: 'stabilityai/stable-diffusion-3-medium-diffusers', label: 'SD3 Medium' },
]

function chainFromEnv(): HfImageModel[] {
    const raw = (process.env.HF_IMAGE_CHAIN || '').trim()
    if (!raw) return DEFAULT_CHAIN
    const out: HfImageModel[] = []
    for (const part of raw.split(',').map(s => s.trim()).filter(Boolean)) {
        const i = part.indexOf(':')
        const provider = part.slice(0, i) as Provider
        const id = part.slice(i + 1)
        if (i > 0 && ['fal-ai', 'replicate', 'nscale', 'hf-inference'].includes(provider) && id) out.push({ provider, id, label: id.split('/').pop() || id })
    }
    return out.length ? out : DEFAULT_CHAIN
}

export function getHfToken(): string | undefined {
    return process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || process.env.NEXT_PUBLIC_HUGGINGFACE_API_KEY || undefined
}

const ROUTER = 'https://router.huggingface.co'
// Vertical 9:16 en múltiplos de 16 (lo que piden estos modelos)
const W = 1088, H = 1920

/** Los proveedores ya no bloquean un modelo para siempre: si uno se queda sin créditos (402) se salta toda la cadena de pago. */
let paidBlockedUntil = 0

async function download(url: string): Promise<Buffer> {
    if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
    return Buffer.from(r.data)
}

async function callModel(m: HfImageModel, token: string, prompt: string, negativePrompt: string): Promise<Buffer> {
    const auth = { Authorization: `Bearer ${token}` }
    if (m.provider === 'fal-ai') {
        const r = await axios.post(`${ROUTER}/fal-ai/${m.id}`, {
            prompt, image_size: { width: W, height: H }, num_images: 1, sync_mode: true,
            enable_safety_checker: true, output_format: 'jpeg',
        }, { headers: { ...auth, 'Content-Type': 'application/json' }, timeout: 60000 })
        const url = r.data?.images?.[0]?.url
        if (!url) throw new Error('respuesta sin imagen')
        return download(url)
    }
    if (m.provider === 'replicate') {
        const r = await axios.post(`${ROUTER}/replicate/v1/models/${m.id}/predictions`, {
            input: { prompt, width: W, height: H, output_format: 'jpg' },
        }, { headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'wait' }, timeout: 75000 })
        const out = r.data?.output
        const url = Array.isArray(out) ? out[0] : out
        if (typeof url !== 'string') throw new Error(`predicción sin imagen (estado ${r.data?.status})`)
        return download(url)
    }
    if (m.provider === 'nscale') {
        const r = await axios.post(`${ROUTER}/nscale/v1/images/generations`, {
            model: m.id, prompt, size: `${W}x${H}`, response_format: 'b64_json',
        }, { headers: { ...auth, 'Content-Type': 'application/json' }, timeout: 60000 })
        const b64 = r.data?.data?.[0]?.b64_json
        if (!b64) throw new Error('respuesta sin imagen')
        return Buffer.from(b64, 'base64')
    }
    const r = await axios.post(`${ROUTER}/hf-inference/models/${m.id}`, {
        inputs: prompt,
        parameters: { negative_prompt: negativePrompt, width: 768, height: 1344, num_inference_steps: 26, guidance_scale: 7.0 },
    }, { headers: { ...auth, 'Content-Type': 'application/json', Accept: 'image/jpeg' }, responseType: 'arraybuffer', timeout: 45000 })
    return Buffer.from(r.data)
}

/**
 * Genera una imagen vertical probando la cadena de modelos. Devuelve null si ninguno respondió
 * (el llamador usa entonces su respaldo gratuito).
 */
export async function generateHfImage(prompt: string, negativePrompt: string): Promise<{ buffer: Buffer; label: string } | null> {
    const token = getHfToken()
    if (!token) return null
    // Los modelos "turbo" no usan prompt negativo: lo esencial se añade como instrucción positiva
    const positive = `${prompt}. Photorealistic documentary photo, natural light, sharp focus. Absolutely no text, letters, signs, captions, watermark or logo anywhere; clothing, vests and banners are plain without any lettering.`
    for (const m of chainFromEnv()) {
        if (m.provider !== 'hf-inference' && Date.now() < paidBlockedUntil) continue
        const t0 = Date.now()
        try {
            const buffer = await callModel(m, token, m.provider === 'hf-inference' ? prompt : positive, negativePrompt)
            if (buffer.length < 10000) throw new Error(`imagen demasiado pequeña (${buffer.length} bytes)`)
            console.log(`[HFImage] ${m.label} (${m.provider}) OK en ${((Date.now() - t0) / 1000).toFixed(1)}s`)
            return { buffer, label: `HF ${m.label}` }
        } catch (err: any) {
            const status = err?.response?.status
            let detail = err?.message || String(err)
            try {
                const body = err?.response?.data
                const txt = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body)
                if (txt) detail = `${status}: ${txt.slice(0, 200)}`
            } catch { /* sin cuerpo */ }
            console.warn(`[HFImage] ${m.label} (${m.provider}) falló: ${detail}`)
            if (status === 402) {
                // Sin créditos de Inference Providers: no insistir con los de pago durante 1 hora
                paidBlockedUntil = Date.now() + 3600000
                console.warn('[HFImage] Sin créditos de Hugging Face: se usan solo opciones gratuitas durante 1 h')
            }
        }
    }
    return null
}

/** Diagnóstico: prueba cada modelo de la cadena con el mismo prompt (para comparar calidad, tiempo y disponibilidad). */
export async function diagnoseHfChain(prompt: string): Promise<{ label: string; provider: string; ok: boolean; seconds: number; bytes?: number; error?: string; buffer?: Buffer }[]> {
    const token = getHfToken()
    if (!token) return [{ label: 'HF_TOKEN', provider: '-', ok: false, seconds: 0, error: 'Falta HF_TOKEN en .env.local' }]
    const positive = `${prompt}. Photorealistic documentary photo, natural light, sharp focus. Absolutely no text, letters, signs, captions, watermark or logo anywhere; clothing, vests and banners are plain without any lettering.`
    const results = []
    for (const m of chainFromEnv()) {
        const t0 = Date.now()
        try {
            const buffer = await callModel(m, token, m.provider === 'hf-inference' ? prompt : positive, 'text, watermark, logo, deformed, blurry')
            results.push({ label: m.label, provider: m.provider, ok: true, seconds: (Date.now() - t0) / 1000, bytes: buffer.length, buffer })
        } catch (err: any) {
            const body = err?.response?.data
            let txt = ''
            try { txt = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body) } catch { /* nada */ }
            results.push({ label: m.label, provider: m.provider, ok: false, seconds: (Date.now() - t0) / 1000, error: `${err?.response?.status || ''} ${txt || err?.message}`.trim().slice(0, 300) })
        }
    }
    return results
}
