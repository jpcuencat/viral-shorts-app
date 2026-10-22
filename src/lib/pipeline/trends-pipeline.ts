import type { SupabaseClient } from '@supabase/supabase-js'
import { getDailyTrends, getTodayTrendCategoryName } from '@/lib/trends'
import { generateJson } from '@/lib/ai/gemini'
import { TrendSelectionSchema } from '@/lib/ai/schemas'
import { generateScriptForIdea } from './script-pipeline'
import { JobCancelledError, type ProgressReporter } from '@/lib/jobs/types'

/**
 * Helper: Finds an existing category by name (case-insensitive) or auto-creates it in Supabase
 */
async function resolveOrCreateCategory(
    supabase: any,
    categoriesCache: { id: string; name: string }[],
    rawName: string
): Promise<{ id: string; name: string }> {
    const cleanName = (rawName || getTodayTrendCategoryName()).trim()
    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

    const existing = categoriesCache.find(c => normalize(c.name) === normalize(cleanName))
    if (existing) return existing

    const slug = cleanName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '')

    // Check by slug in DB first in case it already exists
    const { data: bySlug } = await supabase
        .from('categories')
        .select('id, name')
        .eq('slug', slug)
        .maybeSingle()

    if (bySlug) {
        categoriesCache.push(bySlug)
        return bySlug
    }

    // Create the new category automatically
    const { data: created, error } = await supabase
        .from('categories')
        .insert({ name: cleanName, slug })
        .select('id, name')
        .single()

    if (!error && created) {
        console.log(`[ProcessTrends] Auto-created new category: "${created.name}" (${slug})`)
        categoriesCache.push(created)
        return created
    }

    return categoriesCache[0]
}

export interface TrendsPipelineResult {
    processed: number
    created: number
    trendCategory: string
    scriptIds: string[]
}

/**
 * Analiza las tendencias mundiales, elige las más virales con Gemini y crea idea + guion para cada una.
 * Se ejecuta en el worker de trabajos con un cliente de base de datos inyectado.
 */
export async function runTrendsPipeline(params: {
    db: SupabaseClient
    userId: string
    report?: ProgressReporter
}): Promise<TrendsPipelineResult> {
    const supabase = params.db
    const userId = params.userId
    const report: ProgressReporter = params.report || (async () => { })
    const scriptIds: string[] = []
    await report(3, 'Preparando categorías')

    const todayTrendCategory = getTodayTrendCategoryName() // e.g. "Tendencias 16 Oct"

    // 1. Fetch Existing Categories (and ensure today's trend category exists as an option)
    const { data: dbCategories } = await supabase.from('categories').select('id, name')
    const categoriesCache: { id: string; name: string }[] = dbCategories ? [...dbCategories] : []

    // Ensure today's daily trend category exists in DB
    await resolveOrCreateCategory(supabase, categoriesCache, todayTrendCategory)

    const categoryNames = categoriesCache.map(c => c.name)

    // 2. Tendencias en vivo a nivel MUNDIAL (Google Trends multi-país, X mundial, noticias internacionales, redes; Ecuador incluido)
    await report(8, 'Leyendo tendencias mundiales', 'Google Trends de varios países, X, noticias y redes')
    const allTrends = await getDailyTrends()
    if (allTrends.length === 0) {
        return { processed: 0, created: 0, trendCategory: todayTrendCategory, scriptIds }
    }

    // 3. Filter out already processed trend titles (from both `trends` and `ideas.ai_metadata`)
    const { data: existingTrends } = await supabase
        .from('trends')
        .select('title')
        .order('created_at', { ascending: false })
        .limit(120)

    const { data: existingIdeaTrends } = await supabase
        .from('ideas')
        .select('title, ai_metadata')
        .order('created_at', { ascending: false })
        .limit(120)

    const existingTitles = new Set<string>([
        ...(existingTrends || []).map(t => (t.title || '').toLowerCase().trim()),
        ...(existingIdeaTrends || [])
            .map((i: any) => (i.ai_metadata?.matched_trend || '').toLowerCase().trim())
            .filter(Boolean)
    ])

    let freshTrends = allTrends.filter(t => !existingTitles.has(t.title.toLowerCase().trim())).slice(0, 30)
    // Si todas se vieron recientemente, igual se toman las 15 primeras para generar ángulos nuevos
    if (freshTrends.length === 0) {
        freshTrends = allTrends.slice(0, 15)
    }

    // 4. Hybrid Open Evaluation using gemini-3-flash-preview
    const prompt = `
Actúa como un Director de Contenido Viral GLOBAL para YouTube Shorts, TikTok e Instagram Reels, que produce en ESPAÑOL para una audiencia hispanohablante internacional.

CATEGORÍAS ACTUALES EN BASE DE DATOS:
${JSON.stringify(categoryNames)}

CATEGORÍA DE TENDENCIAS DEL DÍA:
"${todayTrendCategory}"

TENDENCIAS EN TIEMPO REAL A NIVEL MUNDIAL (Google Trends de varios países, X/Twitter mundial y Ecuador, noticias internacionales y de Ecuador, virales en redes, Reddit):
${freshTrends.map((t, idx) => `[${idx}] (${t.traffic}) "${t.title}" ${t.newsItemTitle && t.newsItemTitle !== t.title ? `- Contexto: ${t.newsItemTitle}` : ''}`).join('\n')}

REGLAS DE SELECCIÓN Y CATEGORIZACIÓN HÍBRIDA (IMPORTANTE):
1. NO te limites a las categorías existentes. Selecciona las 4 tendencias con MAYOR potencial viral a nivel MUNDIAL, sin favorecer a ningún país (Ecuador es un mercado más y compite en igualdad). Los temas que son tendencia en varios países a la vez son señal fuerte. Busca variedad: no elijas las 4 del mismo país o tema.
2. Regla Híbrida para "category_name":
   - Si la tendencia encaja claramente en una de las CATEGORÍAS ACTUALES, usa ese nombre exacto.
   - Si es de una temática nueva bien definida (ej. "Mundo", "Deportes", "Cine y Series", "Cultura Pop", "Tecnología", "Finanzas", o un país concreto si el tema es local), escribe ese nuevo nombre de categoría corto (1 o 2 palabras) para que el sistema la cree automáticamente, O usa directamente "${todayTrendCategory}" si es una tendencia general/viral del día.
   - Asegúrate de que al menos 1 o 2 tendencias generales usen "${todayTrendCategory}" o una categoría temática nueva si no son de tecnología.

Responde SOLO con un JSON Array válido con este formato exacto:
[
  {
    "trend_index": 0,
    "category_name": "${todayTrendCategory}",
    "title": "Título viral en español con gancho irresistible para Short",
    "description": "Explicación clara de qué está pasando en esta tendencia/red social y el ángulo narrativo del video",
    "viral_score": 96,
    "estimated_duration": 45
  }
]
`

    let ideasCreated = 0

    try {
        await report(25, 'Eligiendo las tendencias más virales', `${freshTrends.length} tendencias candidatas`)
        const selectedIdeas = await generateJson(prompt, TrendSelectionSchema, { label: 'ProcessTrends' })

        if (Array.isArray(selectedIdeas)) {
            const chosen = selectedIdeas.slice(0, 4)
            for (let k = 0; k < chosen.length; k++) {
                const item = chosen[k]
                await report(35 + Math.round((60 * k) / chosen.length), `Creando idea y guion ${k + 1} de ${chosen.length}`, item.title)
                const trend = freshTrends[item.trend_index] || freshTrends[0]
                if (!trend) continue

                // 5. Try creating Trend Record in Supabase (non-blocking if RLS restricts `trends` table)
                let trendRecordId: string | null = null
                const { data: trendRecord, error: trendError } = await supabase
                    .from('trends')
                    .insert({
                        title: trend.title,
                        link: trend.link,
                        traffic: trend.traffic,
                        source: trend.source || null,
                        processed: true,
                        user_id: userId
                    })
                    .select('id')
                    .maybeSingle()

                if (!trendError && trendRecord?.id) {
                    trendRecordId = trendRecord.id
                } else if (trendError) {
                    console.warn('[ProcessTrends] Note: trends table RLS skipped direct insert, storing trend in ideas.ai_metadata instead:', trendError.message)
                }

                // 6. Hybrid Category Resolution: Match existing OR auto-create new thematic / daily trend category!
                const resolvedCategory = await resolveOrCreateCategory(
                    supabase,
                    categoriesCache,
                    item.category_name || todayTrendCategory
                )

                // 7. Create Idea in Supabase (including user_id and rich trend metadata)
                const ideaPayload: Record<string, any> = {
                    title: item.title,
                    description: item.description,
                    category_id: resolvedCategory?.id,
                    status: 'approved',
                    ai_metadata: {
                        viral_score: item.viral_score || 95,
                        estimated_duration: item.estimated_duration || 45,
                        source: 'auto_trend',
                        trend_network: trend.source || 'global',
                        trend_bucket: todayTrendCategory,
                        matched_trend: trend.title,
                        trend_link: trend.link,
                        trend_traffic: trend.traffic
                    }
                }
                if (trendRecordId) {
                    ideaPayload.source_trend_id = trendRecordId
                }
                ideaPayload.user_id = userId

                const { data: ideaRecord, error: ideaError } = await supabase
                    .from('ideas')
                    .insert(ideaPayload)
                    .select('id')
                    .single()

                if (ideaError) {
                    console.error('[ProcessTrends] Error inserting idea:', ideaError)
                    continue
                }

                if (ideaRecord) {
                    // 8. Auto-Generate Script for the new trend idea
                    const scriptResult = await generateScriptForIdea(supabase, ideaRecord.id, userId)
                    if (scriptResult.scriptId) scriptIds.push(scriptResult.scriptId)
                    ideasCreated++
                }
            }
        }
    } catch (e) {
        if (e instanceof JobCancelledError) throw e
        console.error('[ProcessTrends] Error evaluating trends batch:', e)
        if (ideasCreated === 0) throw e
    }

    return { processed: freshTrends.length, created: ideasCreated, trendCategory: todayTrendCategory, scriptIds }
}
