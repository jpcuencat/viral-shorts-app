'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { generateTrendIdeas, type TrendIdea } from '@/lib/ideas/idea-engine'
import { loadCategoryTree, resolveCategory } from '@/lib/ideas/taxonomy'

/**
 * Genera ideas en tendencia verificadas. `categoryId` = principal o subcategoría; 'OPEN_TRENDS' = todas.
 */
export async function generateIdeas(categoryId: string, count: number = 6, focus?: string): Promise<{ data?: TrendIdea[]; discarded?: { title: string; reason: string }[]; poolSize?: number; error?: string }> {
    if (!process.env.GEMINI_API_KEY) return { error: 'Falta GEMINI_API_KEY.' }
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Sesión no válida' }
    try {
        const res = await generateTrendIdeas({
            db: supabase,
            userId: user.id,
            categoryId: categoryId && categoryId !== 'OPEN_TRENDS' ? categoryId : undefined,
            count,
            focus,
        })
        if (res.ideas.length === 0) {
            return { data: [], discarded: res.discarded, poolSize: res.poolSize, error: res.poolSize === 0 ? 'No llegaron noticias ni tendencias. Revisa la conexión e intenta otra vez.' : undefined }
        }
        return { data: res.ideas, discarded: res.discarded, poolSize: res.poolSize }
    } catch (error: any) {
        console.error('[GenerateIdeas] Error:', error)
        return { error: 'No se pudieron generar ideas. Intenta otra vez.' }
    }
}

/** Guarda las ideas elegidas (pendientes de aprobación) en su subcategoría. Nunca crea categorías. */
export async function saveGeneratedIdeas(ideas: TrendIdea[]): Promise<{ saved?: number; error?: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Sesión no válida' }
    const tree = await loadCategoryTree(supabase)
    const rows = ideas.map(idea => ({
        title: idea.title,
        description: idea.description,
        category_id: resolveCategory(tree, idea.categorySlug, idea.categoryId)?.id || null,
        status: 'pending_approval',
        user_id: user.id,
        ai_metadata: {
            generated: true,
            source: 'idea_generator',
            estimated_duration: idea.estimatedDuration,
            viral_score: idea.viralScore,
            score_parts: idea.scoreParts,
            matched_trend: idea.matchedTrend,
            trend_link: idea.trendLink,
            angle: idea.angle,
            why_now: idea.whyNow,
            headlines: idea.headlines.slice(0, 3),
            search_demand: idea.demand,
            verified_at: new Date().toISOString(),
        },
    }))
    const { error } = await supabase.from('ideas').insert(rows)
    if (error) return { error: error.message }
    revalidatePath('/ideas')
    return { saved: rows.length }
}
