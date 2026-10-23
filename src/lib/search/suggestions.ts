/**
 * Búsquedas reales que la gente escribe en YouTube y Google (autocompletado público, gratuito).
 * Sirven para que el título y los hashtags de cada Short usen los términos que de verdad se buscan.
 */
const CLICKBAIT = /\b(shock|alerta|escándalo|escandalo|urgente|última hora|ultima hora|increíble|increible|impactante|lo que no|nadie te|lo que la tv|no mostró|no mostro|filtrado)\b/gi

/** Convierte un título viral en una semilla de búsqueda limpia (sin emojis, signos ni clickbait). */
export function toSearchSeed(text: string, maxWords = 5): string {
    // "¡LO QUE LA TV NO MOSTRÓ! El túnel del Maracaná..." → la parte con el tema es la que va tras el gancho
    let t = text || ''
    const parts = t.split(/[!|]\s+/).map(x => x.trim()).filter(x => x.split(/\s+/).length >= 3)
    if (parts.length > 1) t = parts[parts.length - 1]
    return t
        .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, ' ')
        .replace(/[¡!¿?"“”«»:;|#()[\]{}]/g, ' ')
        .replace(CLICKBAIT, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter((w, i) => !(i === 0 && /^(el|la|los|las|un|una|este|esta)$/i.test(w)))
        .slice(0, maxWords)
        .join(' ')
        .replace(/\s+(de|del|la|el|los|las|un|una|que|en|y|fue|es|a|con|por|para|lo)$/i, '')
        .replace(/\s+(de|del|la|el|los|las|un|una|que|en|y|fue|es|a|con|por|para|lo)$/i, '')
}

async function suggest(query: string, opts: { yt: boolean; hl: string; gl?: string }): Promise<string[]> {
    const params = new URLSearchParams({ client: 'firefox', hl: opts.hl, q: query, ie: 'utf-8', oe: 'utf-8' })
    if (opts.yt) params.set('ds', 'yt')
    if (opts.gl) params.set('gl', opts.gl)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
        const res = await fetch(`https://suggestqueries.google.com/complete/search?${params}`, { signal: controller.signal })
        if (!res.ok) return []
        const data = await res.json() as [string, string[]]
        return Array.isArray(data?.[1]) ? data[1].map(s => String(s).trim()).filter(Boolean) : []
    } catch {
        return []
    } finally {
        clearTimeout(timer)
    }
}

export interface SearchSuggestions {
    seeds: string[]
    youtube: string[]
    google: string[]
}

/** Autocompletado de YouTube y Google para varias semillas (sin duplicados, máx. 12 por fuente). */
export async function getSearchSuggestions(seedsRaw: string[], opts: { gl?: string; hl?: string } = {}): Promise<SearchSuggestions> {
    const hl = opts.hl || 'es'
    const seeds = [...new Set(seedsRaw.map(s => toSearchSeed(s)).filter(s => s.length >= 3))].slice(0, 3)
    const uniq = (lists: string[][]) => {
        const seen = new Set<string>()
        const out: string[] = []
        for (const l of lists) for (const s of l) {
            const k = s.toLowerCase()
            if (!seen.has(k)) { seen.add(k); out.push(s) }
        }
        return out.slice(0, 12)
    }
    const [yt, gg] = await Promise.all([
        Promise.all(seeds.map(q => suggest(q, { yt: true, hl, gl: opts.gl }))),
        Promise.all(seeds.map(q => suggest(q, { yt: false, hl, gl: opts.gl }))),
    ])
    return { seeds, youtube: uniq(yt), google: uniq(gg) }
}

/** País (código ISO) a partir del lugar verificado de la noticia, para afinar las búsquedas. */
export function countryFromLocation(location?: string): string | undefined {
    const l = (location || '').toLowerCase()
    const map: Record<string, string> = {
        ecuador: 'EC', colombia: 'CO', perú: 'PE', peru: 'PE', méxico: 'MX', mexico: 'MX', argentina: 'AR',
        chile: 'CL', venezuela: 'VE', bolivia: 'BO', españa: 'ES', espana: 'ES', 'estados unidos': 'US', brasil: 'BR',
    }
    for (const [k, v] of Object.entries(map)) if (l.includes(k)) return v
    return undefined
}
