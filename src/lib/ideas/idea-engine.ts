import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { generateJson } from '@/lib/ai/gemini'
import { getDailyTrends, getGlobalGoogleTrends, getXTwitterTrends, searchGoogleNews, ageHours, ageLabel, type TrendItem } from '@/lib/trends'
import { getSearchSuggestions } from '@/lib/search/suggestions'
import { insightsPromptBlock } from '@/lib/learning/insights'
import { loadCategoryTree, subtopicsFor, allowedSubcategoriesText, resolveCategory, categoryLabel, TOPIC_SEARCH, type CategoryTree } from '@/lib/ideas/taxonomy'

/**
 * MOTOR DE IDEAS EN TENDENCIA
 *  1. Junta noticias de las últimas horas (por subcategoría) + Google Trends multi-país + X, cada una con su antigüedad.
 *  2. Gemini propone ideas SOLO a partir de esa lista, sabiendo qué día es hoy (nada de "el partido es mañana"
 *     si ya se jugó) y con un ángulo original; evita repetir ideas que el canal ya tiene y aplica lo aprendido.
 *  3. VERIFICACIÓN: por cada idea se buscan los titulares más recientes del tema; la IA confirma que sigue
 *     vigente, la reescribe con el estado actual o la descarta.
 *  4. Puntaje: potencial viral + frescura + demanda real de búsqueda (autocompletado de YouTube) + cobertura.
 */

const MAX_NEWS_AGE_H = 48

const CandidateSchema = z.array(z.looseObject({
    trend_index: z.coerce.number().int().catch(-1),
    title: z.string().min(3),
    description: z.string().default(''),
    matched_trend: z.string().default(''),
    search_query: z.string().default(''),
    subcategory_slug: z.string().default(''),
    angle: z.string().default(''),
    why_now: z.string().default(''),
    potential: z.coerce.number().catch(70),
    estimated_duration: z.coerce.number().catch(45),
})).min(1)

const VerifySchema = z.array(z.looseObject({
    index: z.coerce.number().int(),
    status: z.enum(['vigente', 'actualizada', 'descartar']).catch('descartar'),
    title: z.string().default(''),
    description: z.string().default(''),
    why_now: z.string().default(''),
    reason: z.string().default(''),
}))

export interface Headline { title: string; url: string; ageHours: number; source: string }
export interface TrendIdea {
    title: string
    description: string
    matchedTrend: string
    angle: string
    whyNow: string
    estimatedDuration: number
    categoryId?: string
    categorySlug?: string
    categoryLabel: string
    trendLink?: string
    newestAgeHours: number
    headlines: Headline[]
    demand: { youtube: number; google: number; terms: string[] }
    status: 'vigente' | 'actualizada'
    verifyNote: string
    viralScore: number
    scoreParts: { potential: number; freshness: number; demand: number; coverage: number }
    markets?: string[]
}

export function todayLabel(): string {
    return new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'full', timeStyle: 'short' }).format(new Date())
}

/** Pool de tendencias: lo de la categoría (noticias de las últimas horas) + lo que es tendencia en el mundo ahora. */
async function gatherPool(tree: CategoryTree, categoryId?: string, focus?: string): Promise<TrendItem[]> {
    let items: TrendItem[] = []
    // Enfoque escrito por el creador: sus noticias van primero (las últimas 48 h, español e inglés)
    let focusItems: TrendItem[] = []
    if (focus) {
        const gl = categoryId ? subtopicsFor(tree, categoryId).map(s => TOPIC_SEARCH[s.slug]?.gl).find(Boolean) : undefined
        const [es, esUs, en] = await Promise.all([
            gl ? searchGoogleNews(focus, { gl, limit: 12, when: '2d', label: 'Enfoque pedido' }) : Promise.resolve([] as TrendItem[]),
            searchGoogleNews(focus, { limit: 12, when: '2d', label: 'Enfoque pedido' }),
            searchGoogleNews(focus, { lang: 'en', limit: 8, when: '2d', label: 'Enfoque pedido (EN)' }),
        ])
        focusItems = [...es, ...esUs, ...en]
    }
    if (categoryId) {
        const subs = subtopicsFor(tree, categoryId)
        const perSub = subs.length > 1 ? 4 : 10
        const lists = await Promise.all(subs.flatMap(s => {
            const t = TOPIC_SEARCH[s.slug]
            if (!t) return [searchGoogleNews(s.name, { limit: perSub, categoryHint: s.slug })]
            return [
                searchGoogleNews(t.es, { gl: t.gl, limit: perSub, categoryHint: s.slug, label: `Noticias · ${s.name}` }),
                ...(t.en ? [searchGoogleNews(t.en, { lang: 'en', limit: Math.ceil(perSub / 2), categoryHint: s.slug, label: `News EN · ${s.name}` })] : []),
            ]
        }))
        const [google, x] = await Promise.all([getGlobalGoogleTrends(4), getXTwitterTrends('', 10)])
        items = [...lists.flat(), ...google, ...x]
    } else {
        items = await getDailyTrends()
    }
    items = [...focusItems, ...items]
    // Fuera lo viejo: noticias de más de 48 h (las tendencias de Google/X son "ahora")
    const fresh = items.filter(t => t.source === 'google_trends' || t.source === 'x_twitter' || ageHours(t.pubDate) <= MAX_NEWS_AGE_H)
    const seen = new Set<string>()
    return fresh.filter(t => {
        const k = t.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').slice(0, 45)
        if (!k || seen.has(k)) return false
        seen.add(k)
        return true
    }).slice(0, 70)
}

function poolText(pool: TrendItem[]): string {
    return pool.map((t, i) => {
        const age = t.source === 'google_trends' ? 'tendencia AHORA' : t.source === 'x_twitter' ? 'tendencia AHORA en X' : ageLabel(ageHours(t.pubDate))
        const markets = t.markets && t.markets.length > 1 ? ` · tendencia en ${t.markets.join(', ')}` : ''
        const ctx = t.newsItemTitle && t.newsItemTitle !== t.title ? ` — ${t.newsItemTitle}` : ''
        return `[${i}] (${age} · ${t.traffic}${markets}) ${t.title}${ctx}`
    }).join('\n')
}

const freshnessScore = (h: number) => (h <= 6 ? 100 : h <= 12 ? 90 : h <= 24 ? 75 : h <= 48 ? 50 : 15)

/** Titulares más recientes del tema (para verificar el estado real hoy). */
async function latestHeadlines(query: string): Promise<Headline[]> {
    const q = query.replace(/["#]/g, '').trim()
    if (q.length < 3) return []
    let items = await searchGoogleNews(q, { limit: 6, when: '2d' })
    if (items.length < 2) items = items.concat(await searchGoogleNews(q, { lang: 'en', limit: 4, when: '2d' }))
    return items.map(t => ({ title: t.newsItemTitle || t.title, url: t.link, ageHours: ageHours(t.pubDate), source: t.traffic }))
        .sort((a, b) => a.ageHours - b.ageHours).slice(0, 5)
}

export async function generateTrendIdeas(params: {
    db: SupabaseClient
    userId?: string
    categoryId?: string          // principal o subcategoría; vacío = modo abierto (todas)
    focus?: string               // tema o enfoque escrito por el creador (opcional)
    count?: number
    onProgress?: (msg: string) => void | Promise<void>
}): Promise<{ ideas: TrendIdea[]; poolSize: number; discarded: { title: string; reason: string }[] }> {
    const { db, userId, categoryId } = params
    const focus = (params.focus || '').trim().slice(0, 300)
    const count = params.count ?? 6
    const progress = params.onProgress || (() => { })
    const tree = await loadCategoryTree(db)
    const scopeSubs = categoryId ? subtopicsFor(tree, categoryId) : []
    const scopeLabel = categoryId ? categoryLabel(tree, categoryId) : 'Todas (modo abierto)'

    await progress('Leyendo noticias y tendencias de las últimas horas')
    const pool = await gatherPool(tree, categoryId, focus)
    if (pool.length === 0) return { ideas: [], poolSize: 0, discarded: [] }

    // Ideas que el canal ya tiene (últimos 30 días) para no repetir
    let existing: string[] = []
    if (userId) {
        const since = new Date(Date.now() - 30 * 86400000).toISOString()
        const { data } = await db.from('ideas').select('title').eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(60)
        existing = (data || []).map((r: any) => r.title).filter(Boolean)
    }
    const lessons = userId ? await insightsPromptBlock(db, userId, 'trends') : ''
    const today = todayLabel()
    const want = count + 4

    await progress('Proponiendo ideas con la IA')
    const prompt = `Eres el director de contenido de RADAR 593, un canal de Shorts/Reels/TikTok de NOTICIAS y tendencias en ESPAÑOL (Ecuador y el mundo).
HOY ES: ${today} (hora de Ecuador).
ÁMBITO PEDIDO: ${scopeLabel}
${focus ? `ENFOQUE PEDIDO POR EL CREADOR: "${focus}"\nTODAS las ideas deben tratar de este enfoque (son las noticias marcadas "Enfoque pedido"), cada una con un ángulo o novedad distinta; no repitas la misma idea con otras palabras.\n` : ''}
LISTA DE TENDENCIAS Y NOTICIAS (cada una con su antigüedad; usa SOLO estas, tu memoria puede estar desactualizada):
${poolText(pool)}

${lessons ? lessons + '\n' : ''}${existing.length ? `IDEAS QUE EL CANAL YA TIENE (no repitas el mismo tema ni ángulo):\n${existing.slice(0, 40).map(t => `- ${t}`).join('\n')}\n` : ''}
SUBCATEGORÍAS PERMITIDAS (en "subcategory_slug" usa EXACTAMENTE uno de estos slugs):
${allowedSubcategoriesText(tree, scopeSubs)}

REGLAS:
1. ACTUALIDAD: trabaja respecto a HOY. Si una noticia de hace 30 h dice "mañana" o "este fin de semana", calcula si ya ocurrió; si ya ocurrió y la lista no trae el resultado, NO la uses. Nunca escribas "mañana", "hoy" o "esta noche" salvo que sea verdad respecto a HOY. Prioriza lo de menos de 24 h y lo que aparece en varias fuentes o países.
2. ${categoryId ? `ÁMBITO: todas las ideas deben ser del ámbito "${scopeLabel}". Las tendencias generales de Google/X solo sirven si tocan ese ámbito.` : 'MODO ABIERTO: elige por potencial viral real, con variedad de temas y países (Ecuador es un mercado más).'}
3. ORIGINALIDAD: no repitas el titular. Cada idea necesita un ÁNGULO que la haga compartible: "lo que nadie te contó", "qué significa para ti", "explicado en 40 segundos", "el dato que sorprende", "antes vs. ahora", "las reacciones", "qué viene ahora". Nada de tutoriales genéricos, temas atemporales disfrazados de noticia ni guías de "a qué hora / dónde ver" (caducan en horas y no tienen imágenes que mostrar). Prefiere historias con protagonistas y momentos que se puedan ver en video.
4. VERACIDAD: gancho fuerte pero fiel a la noticia; "presunto" para acusaciones; nada de SHOCK/ESCÁNDALO si los hechos no lo justifican.
5. "matched_trend": el tema exacto de la lista. "search_query": 3-6 palabras para buscar la noticia en Google News (nombres propios). "trend_index": el número [i] usado.
6. "why_now": por qué esto se va a compartir HOY (1 frase). "potential": 0-100 según potencial viral real.

Devuelve ${want} ideas distintas. Responde SOLO con JSON:
[{"trend_index":0,"title":"","description":"","matched_trend":"","search_query":"","subcategory_slug":"","angle":"","why_now":"","potential":80,"estimated_duration":40}]`

    const candidates = await generateJson(prompt, CandidateSchema, { label: 'TrendIdeas' })

    // Verificación con titulares recientes + demanda real de búsqueda
    await progress('Verificando que cada idea siga vigente')
    const checks = await Promise.all(candidates.slice(0, want).map(async c => {
        const q = c.search_query || c.matched_trend || c.title
        const [heads, demand] = await Promise.all([
            latestHeadlines(q),
            getSearchSuggestions([c.matched_trend || q], {}).catch(() => ({ seeds: [], youtube: [], google: [] })),
        ])
        return { c, heads, demand }
    }))

    const verifyPrompt = `HOY ES: ${today} (hora de Ecuador).
Para cada idea tienes los titulares MÁS RECIENTES del tema (con su antigüedad). Decide su estado:
- "vigente": la idea es correcta y actual tal como está.
- "actualizada": el tema sigue vivo pero la idea quedó vieja o imprecisa (p. ej. dice que algo va a pasar y ya pasó, o hay un dato nuevo): reescribe "title" y "description" con el estado ACTUAL según los titulares, manteniendo el gancho.
- "descartar": no hay titulares de las últimas 48 h, los titulares no hablan realmente del mismo tema, el evento ya pasó y no hay nada nuevo que contar, o no se puede confirmar qué pasó.
Revisa también "Por qué hoy" y devuélvelo corregido en "why_now" (fechas y días de la semana exactos respecto a HOY).
Nunca uses "mañana", "hoy" o "esta noche" si no es verdad respecto a HOY. No inventes nada que no esté en los titulares.

${checks.map((x, i) => `IDEA ${i}: "${x.c.title}" — ${x.c.description}
Por qué hoy: ${x.c.why_now}
Tema: ${x.c.matched_trend}
Titulares recientes:
${x.heads.length ? x.heads.map(h => `  · (${ageLabel(h.ageHours)}) ${h.title}`).join('\n') : '  (ninguno en las últimas 48 h)'}`).join('\n\n')}

Responde SOLO con JSON: [{"index":0,"status":"vigente|actualizada|descartar","title":"","description":"","why_now":"","reason":"1 frase"}]`

    let verdicts: z.infer<typeof VerifySchema> = []
    try {
        verdicts = await generateJson(verifyPrompt, VerifySchema, { label: 'TrendIdeasVerify' })
    } catch (e: any) {
        console.warn('[IdeaEngine] Verificación no disponible:', e?.message || e)
    }

    const ideas: TrendIdea[] = []
    const discarded: { title: string; reason: string }[] = []
    checks.forEach((x, i) => {
        const v = verdicts.find(d => d.index === i)
        const newest = x.heads[0]?.ageHours ?? Infinity
        if (!v || v.status === 'descartar' || newest > MAX_NEWS_AGE_H) {
            discarded.push({ title: x.c.title, reason: v?.reason || (newest > MAX_NEWS_AGE_H ? 'Sin noticias de las últimas 48 h' : 'No se pudo verificar') })
            return
        }
        const cat = resolveCategory(tree, x.c.subcategory_slug, scopeSubs.length === 1 ? scopeSubs[0].id : undefined)
        const potential = Math.max(0, Math.min(100, x.c.potential))
        const freshness = freshnessScore(newest)
        const yt = x.demand.youtube.length
        const demandScore = Math.min(100, 20 + yt * 10)
        const coverage = Math.min(100, x.heads.length * 22)
        const viralScore = Math.round(potential * 0.5 + freshness * 0.25 + demandScore * 0.15 + coverage * 0.1)
        const poolItem = pool[x.c.trend_index]
        ideas.push({
            title: v.status === 'actualizada' && v.title ? v.title : x.c.title,
            description: v.status === 'actualizada' && v.description ? v.description : x.c.description,
            matchedTrend: x.c.matched_trend,
            angle: x.c.angle,
            whyNow: v.why_now || x.c.why_now,
            estimatedDuration: Math.max(20, Math.min(60, Math.round(x.c.estimated_duration || 45))),
            categoryId: cat?.id,
            categorySlug: cat?.slug,
            categoryLabel: cat ? categoryLabel(tree, cat.id) : 'Tendencias',
            trendLink: x.heads[0]?.url || poolItem?.link,
            newestAgeHours: newest,
            headlines: x.heads,
            demand: { youtube: yt, google: x.demand.google.length, terms: x.demand.youtube.slice(0, 5) },
            status: v.status,
            verifyNote: v.reason,
            viralScore,
            scoreParts: { potential, freshness, demand: demandScore, coverage },
            markets: poolItem?.markets,
        })
    })
    ideas.sort((a, b) => b.viralScore - a.viralScore)
    console.log(`[IdeaEngine] ${scopeLabel}${focus ? ` · enfoque "${focus}"` : ''}: ${pool.length} tendencias → ${candidates.length} propuestas → ${ideas.length} verificadas (${discarded.length} descartadas)`)
    return { ideas: ideas.slice(0, count), poolSize: pool.length, discarded }
}
