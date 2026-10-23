import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { generateJson } from '@/lib/ai/gemini'

/**
 * APRENDIZAJE DEL CANAL
 * Junta lo que pasó con cada reel (vistas e interacción reales por red, nota y comentario del crítico IA,
 * correcciones del creador al regenerar guiones) y le pide a Gemini lecciones concretas: qué temas, ganchos,
 * títulos y visuales funcionan y cuáles no. Las lecciones se guardan en channel_insights y se inyectan en
 * tendencias, guiones y plan visual, así cada reel nuevo aprovecha lo aprendido.
 */
export const InsightsSchema = z.looseObject({
    summary: z.string().default(''),
    topics_that_work: z.array(z.string()).default([]),
    topics_to_avoid: z.array(z.string()).default([]),
    hook_patterns: z.array(z.string()).default([]),
    title_patterns: z.array(z.string()).default([]),
    visual_lessons: z.array(z.string()).default([]),
    platform_notes: z.array(z.string()).default([]),
    confidence: z.enum(['baja', 'media', 'alta']).catch('baja'),
})
export type ChannelInsights = z.infer<typeof InsightsSchema> & {
    stats?: {
        categories: { name: string; videos: number; avgViews: number; avgViewsPerDay: number }[]
        top: { title: string; views: number; viewsPerDay: number; category: string }[]
        bottom: { title: string; views: number; viewsPerDay: number; category: string }[]
        withMetrics: number
    }
    generatedAt?: string
}

export interface ScriptPerformance {
    scriptId: string
    title: string
    category: string
    source: string
    hook: string
    hashtags: string[]
    criticScore: number | null
    criticFeedback: string
    regenFeedback: string
    views: number
    likes: number
    comments: number
    shares: number
    byPlatform: Record<string, number>
    publishedAt: string | null
    ageDays: number
    viewsPerDay: number
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)

/** Rendimiento por guion: métricas sumadas de todas las redes + datos del crítico y del creador. */
export async function collectPerformance(db: SupabaseClient, userId: string): Promise<ScriptPerformance[]> {
    const [{ data: metrics }, { data: scripts }, { data: reels }] = await Promise.all([
        db.from('post_metrics').select('*').eq('user_id', userId),
        db.from('scripts').select('id, seo_title, hashtags, content, created_at, ideas(title, ai_metadata, categories(name))')
            .eq('user_id', userId).order('created_at', { ascending: false }).limit(150),
        db.from('reels').select('script_id, quality_score, quality_feedback, created_at').eq('user_id', userId),
    ])
    const reelByScript = new Map<string, { quality_score: number | null; quality_feedback: string | null }>()
    for (const r of reels || []) if (r.script_id) reelByScript.set(r.script_id, r)
    const metricsByScript = new Map<string, any[]>()
    for (const m of metrics || []) {
        if (!m.script_id) continue
        const arr = metricsByScript.get(m.script_id) || []
        arr.push(m)
        metricsByScript.set(m.script_id, arr)
    }

    const now = Date.now()
    const out: ScriptPerformance[] = []
    for (const s of scripts || []) {
        const reel = reelByScript.get(s.id)
        const ms = metricsByScript.get(s.id) || []
        if (!reel && ms.length === 0) continue
        let content: any = s.content
        if (typeof content === 'string') { try { content = JSON.parse(content) } catch { content = {} } }
        const idea: any = Array.isArray(s.ideas) ? s.ideas[0] : s.ideas
        const byPlatform: Record<string, number> = {}
        let views = 0, likes = 0, comments = 0, shares = 0
        let published: number | null = null
        for (const m of ms) {
            byPlatform[m.platform] = (byPlatform[m.platform] || 0) + num(m.views)
            views += num(m.views); likes += num(m.likes); comments += num(m.comments); shares += num(m.shares)
            const t = m.published_at ? Date.parse(m.published_at) : NaN
            if (Number.isFinite(t) && (published === null || t < published)) published = t
        }
        const ageDays = published ? Math.max(0.5, (now - published) / 86400000) : 0
        out.push({
            scriptId: s.id,
            title: s.seo_title || idea?.title || '',
            category: idea?.categories?.name || 'Sin categoría',
            source: idea?.ai_metadata?.source || 'manual',
            hook: String(content?.hook_audio || '').slice(0, 160),
            hashtags: s.hashtags || [],
            criticScore: reel?.quality_score ?? null,
            criticFeedback: String(reel?.quality_feedback || '').slice(0, 300),
            regenFeedback: String(content?.regen_feedback || '').slice(0, 300),
            views, likes, comments, shares, byPlatform,
            publishedAt: published ? new Date(published).toISOString() : null,
            ageDays: Number(ageDays.toFixed(1)),
            viewsPerDay: ageDays ? Math.round(views / ageDays) : 0,
        })
    }
    return out
}

function computeStats(perf: ScriptPerformance[]): NonNullable<ChannelInsights['stats']> {
    const withM = perf.filter(p => p.publishedAt)
    const cats = new Map<string, { n: number; v: number; vpd: number }>()
    for (const p of withM) {
        const c = cats.get(p.category) || { n: 0, v: 0, vpd: 0 }
        c.n++; c.v += p.views; c.vpd += p.viewsPerDay
        cats.set(p.category, c)
    }
    const sorted = [...withM].sort((a, b) => b.viewsPerDay - a.viewsPerDay)
    const brief = (p: ScriptPerformance) => ({ title: p.title, views: p.views, viewsPerDay: p.viewsPerDay, category: p.category })
    return {
        categories: [...cats.entries()].map(([name, c]) => ({ name, videos: c.n, avgViews: Math.round(c.v / c.n), avgViewsPerDay: Math.round(c.vpd / c.n) }))
            .sort((a, b) => b.avgViewsPerDay - a.avgViewsPerDay),
        top: sorted.slice(0, 5).map(brief),
        bottom: sorted.slice(-5).reverse().map(brief),
        withMetrics: withM.length,
    }
}

/** Genera y guarda lecciones nuevas. Devuelve las lecciones (o null si no hay datos suficientes). */
export async function generateChannelInsights(db: SupabaseClient, userId: string): Promise<ChannelInsights | null> {
    const perf = await collectPerformance(db, userId)
    if (perf.length < 3) return null
    const stats = computeStats(perf)
    const rows = perf.slice(0, 60).map(p => [
        `• "${p.title}" [${p.category}, ${p.source}]`,
        p.publishedAt ? `vistas ${p.views} (${p.viewsPerDay}/día; ${Object.entries(p.byPlatform).map(([k, v]) => `${k} ${v}`).join(', ')}), likes ${p.likes}, coment. ${p.comments}, compartidos ${p.shares}` : 'aún sin métricas',
        `gancho: "${p.hook}"`,
        p.hashtags.length ? `hashtags: ${p.hashtags.slice(0, 6).join(' ')}` : '',
        p.criticScore !== null ? `crítico IA ${p.criticScore}/100: ${p.criticFeedback}` : '',
        p.regenFeedback ? `el creador corrigió: ${p.regenFeedback}` : '',
    ].filter(Boolean).join(' | ')).join('\n')

    const prompt = `Eres el analista de rendimiento de un canal de Shorts de noticias en español (marca RADAR 593, Ecuador y el mundo).
Publica en YouTube Shorts, Instagram Reels, Facebook Reels y TikTok. Abajo tienes cada video con sus métricas reales,
la nota del crítico IA y las correcciones del creador. Compara principalmente por VISTAS POR DÍA (los videos tienen distinta antigüedad).

ESTADÍSTICAS POR CATEGORÍA: ${JSON.stringify(stats.categories)}

VIDEOS:
${rows}

Escribe lecciones CONCRETAS y accionables (no genéricas) que mejoren los próximos videos. Basa cada una en los datos; si hay pocos datos, dilo y baja la confianza.
- topics_that_work / topics_to_avoid: tipos de tema y ángulos (con ejemplos de este canal).
- hook_patterns: cómo empezar los primeros 3 segundos según lo que retuvo más.
- title_patterns: cómo titular (palabras, longitud, nombres propios, signos). Nunca recomiendes clickbait falso.
- visual_lessons: qué visuales funcionaron o fallaron (según el crítico y los resultados).
- platform_notes: diferencias entre redes, si las hay.
Responde SOLO con JSON: {"summary":"2 frases","topics_that_work":[],"topics_to_avoid":[],"hook_patterns":[],"title_patterns":[],"visual_lessons":[],"platform_notes":[],"confidence":"baja|media|alta"}`

    const ai = await generateJson(prompt, InsightsSchema, { label: 'ChannelInsights' })
    const insights: ChannelInsights = { ...ai, stats, generatedAt: new Date().toISOString() }
    const { error } = await db.from('channel_insights').insert({ user_id: userId, insights, sample_size: stats.withMetrics })
    if (error) console.warn('[Learning] No se pudieron guardar las lecciones:', error.message)
    console.log(`[Learning] Lecciones actualizadas (${stats.withMetrics} videos con métricas, confianza ${ai.confidence})`)
    return insights
}

export async function getLatestInsights(db: SupabaseClient, userId: string): Promise<(ChannelInsights & { createdAt: string }) | null> {
    const { data } = await db.from('channel_insights').select('insights, created_at')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    return data ? { ...(data.insights as ChannelInsights), createdAt: data.created_at } : null
}

/** Regenera las lecciones si las últimas tienen más de `maxAgeHours`. Nunca lanza errores. */
export async function refreshInsightsIfStale(db: SupabaseClient, userId: string, maxAgeHours = 12) {
    try {
        const last = await getLatestInsights(db, userId)
        if (last && Date.now() - Date.parse(last.createdAt) < maxAgeHours * 3600000) return last
        return await generateChannelInsights(db, userId)
    } catch (err: any) {
        console.warn('[Learning] No se pudieron actualizar las lecciones:', err?.message || err)
        return null
    }
}

/** Bloque de texto para inyectar en los prompts. Vacío si aún no hay lecciones. */
export async function insightsPromptBlock(db: SupabaseClient, userId: string | undefined, kind: 'trends' | 'script' | 'visual'): Promise<string> {
    if (!userId) return ''
    try {
        const ins = await getLatestInsights(db, userId)
        if (!ins) return ''
        const list = (title: string, items?: string[]) => (items && items.length ? `${title}:\n${items.slice(0, 6).map(i => `- ${i}`).join('\n')}` : '')
        const conf = `(confianza ${ins.confidence}, basada en ${ins.stats?.withMetrics ?? 0} videos con métricas)`
        if (kind === 'trends') {
            const cats = (ins.stats?.categories || []).slice(0, 6).map(c => `${c.name}: ${c.avgViewsPerDay} vistas/día (${c.videos} videos)`).join('; ')
            return [`LO APRENDIDO DE ESTE CANAL ${conf} — úsalo para priorizar, sin dejar de lado tendencias fuertes nuevas:`,
                ins.summary, cats ? `Rendimiento por categoría: ${cats}` : '',
                list('Temas que funcionan', ins.topics_that_work), list('Temas que rinden poco', ins.topics_to_avoid)].filter(Boolean).join('\n')
        }
        if (kind === 'script') {
            return [`LO APRENDIDO DE ESTE CANAL ${conf} — aplícalo al gancho, título y hashtags (sin romper las reglas de veracidad):`,
                list('Ganchos que retienen', ins.hook_patterns), list('Títulos que funcionan', ins.title_patterns),
                list('Evitar', ins.topics_to_avoid)].filter(Boolean).join('\n')
        }
        return [`LESSONS LEARNED FROM THIS CHANNEL ${conf} (in Spanish) — apply them to the visual plan:`, list('Visual', ins.visual_lessons)].filter(Boolean).join('\n')
    } catch {
        return ''
    }
}
