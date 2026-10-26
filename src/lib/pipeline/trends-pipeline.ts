import type { SupabaseClient } from '@supabase/supabase-js'
import { getTodayTrendCategoryName } from '@/lib/trends'
import { JobCancelledError, type ProgressReporter } from '@/lib/jobs/types'
import { refreshInsightsIfStale } from '@/lib/learning/insights'
import { generateTrendIdeas } from '@/lib/ideas/idea-engine'

export interface TrendsPipelineResult {
    processed: number
    created: number
    trendCategory: string
    scriptIds: string[]
}

/**
 * Tendencias automáticas: usa el mismo motor que el generador (noticias de las últimas 48 h, fecha de hoy,
 * verificación con titulares recientes, demanda de búsqueda) en modo abierto y crea las mejores 4 ideas
 * PENDIENTES de aprobación, cada una en su subcategoría (o en "Tendencias" si no encaja). Nunca crea categorías.
 */
export async function runTrendsPipeline(params: {
    db: SupabaseClient
    userId: string
    report?: ProgressReporter
}): Promise<TrendsPipelineResult> {
    const supabase = params.db
    const userId = params.userId
    const report: ProgressReporter = params.report || (async () => { })
    const todayTrendCategory = getTodayTrendCategoryName()

    await report(5, 'Actualizando lo aprendido del canal')
    await refreshInsightsIfStale(supabase, userId, 24)

    let pct = 10
    const res = await generateTrendIdeas({
        db: supabase,
        userId,
        count: 4,
        onProgress: async msg => { pct = Math.min(80, pct + 20); await report(pct, msg) },
    })

    let created = 0
    for (let k = 0; k < res.ideas.length; k++) {
        const idea = res.ideas[k]
        await report(85 + Math.round((10 * k) / Math.max(1, res.ideas.length)), `Guardando idea ${k + 1} de ${res.ideas.length}`, idea.title)
        try {
            const { data: trendRecord } = await supabase.from('trends').insert({
                title: idea.matchedTrend || idea.title,
                link: idea.trendLink || null,
                traffic: `${idea.headlines.length} titulares · ${Math.round(idea.newestAgeHours)} h`,
                source: 'idea_engine',
                processed: true,
                user_id: userId,
            }).select('id').maybeSingle()

            const { error } = await supabase.from('ideas').insert({
                title: idea.title,
                description: idea.description,
                category_id: idea.categoryId || null,
                status: 'pending_approval',
                user_id: userId,
                ...(trendRecord?.id ? { source_trend_id: trendRecord.id } : {}),
                ai_metadata: {
                    source: 'auto_trend',
                    viral_score: idea.viralScore,
                    score_parts: idea.scoreParts,
                    estimated_duration: idea.estimatedDuration,
                    trend_bucket: todayTrendCategory,
                    matched_trend: idea.matchedTrend,
                    trend_link: idea.trendLink,
                    angle: idea.angle,
                    why_now: idea.whyNow,
                    headlines: idea.headlines.slice(0, 3),
                    search_demand: idea.demand,
                    verified_at: new Date().toISOString(),
                },
            })
            if (error) console.error('[ProcessTrends] No se pudo guardar la idea:', error.message)
            else created++
        } catch (e) {
            if (e instanceof JobCancelledError) throw e
            console.error('[ProcessTrends] Error guardando idea:', e)
        }
    }
    return { processed: res.poolSize, created, trendCategory: todayTrendCategory, scriptIds: [] }
}
