import { GoogleGenerativeAI, type Part } from '@google/generative-ai'
import type { ZodType } from 'zod'

const apiKey = process.env.GEMINI_API_KEY

if (!apiKey) {
    console.warn('GEMINI_API_KEY is not set in environment variables.')
}

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview'

const genAI = new GoogleGenerativeAI(apiKey || '')

/** Modelo de texto libre (traducciones, prompts sueltos). */
export const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })

/** Modelo forzado a responder JSON válido (sin ```json, sin texto extra). */
export const jsonModel = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: 'application/json' }
})

/**
 * Modelo con búsqueda en Google (grounding) para verificar hechos de actualidad.
 * El SDK 0.24 solo tipa la herramienta antigua (googleSearchRetrieval); los modelos 2.x/3.x usan
 * `googleSearch`, que el SDK reenvía tal cual a la API.
 */
export const groundedModel = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    tools: [{ googleSearch: {} } as any],
})

/** Extrae JSON aunque el modelo lo envuelva en ```json ... ``` o agregue texto alrededor. */
export function extractJson(raw: string): unknown {
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
    try {
        return JSON.parse(cleaned)
    } catch {
        const match = cleaned.match(/[\[{][\s\S]*[\]}]/)
        if (match) return JSON.parse(match[0])
        throw new Error('La respuesta de Gemini no contiene JSON válido')
    }
}

/**
 * Llama a Gemini en modo JSON y valida la respuesta con un esquema zod.
 * Si la respuesta no cumple el esquema, reintenta indicando al modelo el error concreto.
 */
export async function generateJson<T>(
    prompt: string | (string | Part)[],
    schema: ZodType<T>,
    options: { retries?: number; label?: string } = {}
): Promise<T> {
    const { retries = 1, label = 'Gemini' } = options
    const baseParts: (string | Part)[] = Array.isArray(prompt) ? prompt : [prompt]
    let lastError = ''

    for (let attempt = 0; attempt <= retries; attempt++) {
        const parts = lastError
            ? [...baseParts, `\n\nTu respuesta anterior fue inválida (${lastError}). Responde SOLO con JSON que cumpla exactamente el formato pedido.`]
            : baseParts
        try {
            const result = await jsonModel.generateContent(parts)
            const parsed = extractJson(result.response.text())
            const validated = schema.safeParse(parsed)
            if (validated.success) return validated.data
            lastError = validated.error.issues
                .slice(0, 3)
                .map(i => `${i.path.join('.') || 'raíz'}: ${i.message}`)
                .join('; ')
        } catch (err: any) {
            lastError = err?.message || String(err)
        }
        console.warn(`[${label}] Intento ${attempt + 1} inválido: ${lastError}`)
    }
    throw new Error(`[${label}] Respuesta JSON inválida tras ${retries + 1} intentos: ${lastError}`)
}
