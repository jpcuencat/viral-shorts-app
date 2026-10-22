import { groundedModel } from '@/lib/ai/gemini'

/**
 * VERIFICACIÓN DE HECHOS antes de escribir un guion.
 * Gemini investiga el tema con Google Search y devuelve solo lo confirmado por fuentes, más las fuentes
 * reales que usó (metadatos de grounding, no URLs inventadas por el modelo).
 */
export interface FactCheck {
    verified: boolean
    brief: string
    sources: { title: string; uri: string }[]
    /** Dominios de las fuentes (para mostrar: "primicias.ec · extra.ec"). */
    domains: string[]
    location?: string
    eventDate?: string
    checkedAt: string
}

function hostnameOf(uri: string): string | null {
    try {
        const h = new URL(uri).hostname.replace(/^www\./, '')
        return h.includes('vertexaisearch') ? null : h
    } catch {
        return null
    }
}

export async function researchFacts(input: {
    title: string
    description?: string
    trendTitle?: string
    trendLink?: string
}): Promise<FactCheck> {
    const today = new Date().toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' })
    const prompt = `Eres un verificador de datos para un canal de noticias en video. Hoy es ${today}.
Investiga con Google Search el siguiente tema y resume SOLO lo que confirman fuentes periodísticas o institucionales fiables.

TEMA: "${input.title}"
${input.description ? `DESCRIPCIÓN DE LA IDEA: "${input.description}"` : ''}
${input.trendTitle ? `TENDENCIA ORIGINAL: "${input.trendTitle}"` : ''}
${input.trendLink ? `ENLACE DE ORIGEN: ${input.trendLink}` : ''}

Responde EXACTAMENTE con este formato (en español):
HECHOS CONFIRMADOS:
- (un hecho por línea, indicando quién lo afirma: "según la Fiscalía", "según Primicias", etc.)
NO CONFIRMADO O EN DISPUTA:
- (lo que circula pero no está confirmado; escribe "ninguno" si no hay)
LUGAR: (ciudad/provincia y país del hecho principal, o "no aplica")
FECHA: (fecha del hecho principal, o "no aplica")

Si no encuentras información fiable sobre el tema, responde solo: SIN_INFORMACION_VERIFICABLE
No inventes nada. No incluyas opiniones.`

    const checkedAt = new Date().toISOString()
    try {
        const result = await groundedModel.generateContent(prompt)
        const text = result.response.text().trim()
        const chunks = (result.response.candidates?.[0]?.groundingMetadata?.groundingChunks || []) as any[]
        const sources = chunks
            .map(c => ({ title: String(c?.web?.title || ''), uri: String(c?.web?.uri || '') }))
            .filter(s => s.title || s.uri)

        const domains = new Set<string>()
        for (const s of sources) {
            const fromTitle = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.title) ? s.title.replace(/^www\./, '') : null
            const d = fromTitle || hostnameOf(s.uri)
            if (d) domains.add(d.toLowerCase())
        }
        const originHost = input.trendLink ? hostnameOf(input.trendLink) : null
        if (originHost && !originHost.includes('news.google') && !originHost.includes('x.com')) domains.add(originHost)

        const noInfo = /SIN_INFORMACION_VERIFICABLE/i.test(text)
        const confirmedBlock = text.split(/NO CONFIRMADO/i)[0]
        const confirmedBullets = (confirmedBlock.match(/^\s*-\s+\S.+$/gm) || []).length
        const location = text.match(/^LUGAR:\s*(.+)$/im)?.[1]?.trim()
        const eventDate = text.match(/^FECHA:\s*(.+)$/im)?.[1]?.trim()

        const verified = !noInfo && confirmedBullets > 0 && sources.length > 0
        console.log(`[FactCheck] "${input.title}": ${verified ? `${confirmedBullets} hechos confirmados` : 'sin información verificable'} · fuentes: ${[...domains].join(', ') || 'ninguna'}`)

        return {
            verified,
            brief: noInfo ? '' : text,
            sources: sources.slice(0, 8),
            domains: [...domains].slice(0, 4),
            location: location && !/no aplica/i.test(location) ? location : undefined,
            eventDate: eventDate && !/no aplica/i.test(eventDate) ? eventDate : undefined,
            checkedAt,
        }
    } catch (err: any) {
        console.warn(`[FactCheck] No se pudo verificar "${input.title}": ${err?.message || err}`)
        return { verified: false, brief: '', sources: [], domains: [], checkedAt }
    }
}
