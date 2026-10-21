'use server'

import { createClient } from '@/lib/supabase/server'
import { getDailyTrends, getTodayTrendCategoryName } from '@/lib/trends'
import { generateJson } from '@/lib/ai/gemini'
import { TrendSelectionSchema } from '@/lib/ai/schemas'
import { generateScript } from './generate-script'
import { revalidatePath } from 'next/cache'

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

export async function processTrends() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const todayTrendCategory = getTodayTrendCategoryName() // e.g. "Tendencias 16 Oct"

    // 1. Fetch Existing Categories (and ensure today's trend category exists as an option)
    const { data: dbCategories } = await supabase.from('categories').select('id, name')
    const categoriesCache: { id: string; name: string }[] = dbCategories ? [...dbCategories] : []

    // Ensure today's daily trend category exists in DB
    await resolveOrCreateCategory(supabase, categoriesCache, todayTrendCategory)

    const categoryNames = categoriesCache.map(c => c.name)

    // 2. Fetch Unrestricted Open & Social Trends focused on ECUADOR (X/Twitter EC, Google Trends EC, Ecuador News 24h, TikTok/IG, Global)
    const allTrends = await getDailyTrends('EC', categoryNames)
    if (allTrends.length === 0) {
        return { processed: 0, created: 0, message: 'No live trends available' }
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

    let freshTrends = allTrends.filter(t => !existingTitles.has(t.title.toLowerCase().trim())).slice(0, 15)
    // If all 15 were already seen recently, still take top 10 so Refresh Trends can generate fresh angles
    if (freshTrends.length === 0) {
        freshTrends = allTrends.slice(0, 10)
    }

    // 4. Hybrid Open Evaluation using gemini-3-flash-preview
    const prompt = `
Actúa como un Director de Contenido Viral en ECUADOR y Latinoamérica para YouTube Shorts, TikTok e Instagram Reels.

CATEGORÍAS ACTUALES EN BASE DE DATOS:
${JSON.stringify(categoryNames)}

CATEGORÍA DE TENDENCIAS DEL DÍA:
"${todayTrendCategory}"

TENDENCIAS ABIERTAS EN TIEMPO REAL EN ECUADOR Y EL MUNDO (X/Twitter Ecuador, Google Trends EC, Noticias Ecuador 24h, TikTok/IG, Reddit):
${freshTrends.map((t, idx) => `[${idx}] (${t.traffic}) "${t.title}" ${t.newsItemTitle && t.newsItemTitle !== t.title ? `- Contexto: ${t.newsItemTitle}` : ''}`).join('\n')}

REGLAS DE SELECCIÓN Y CATEGORIZACIÓN HÍBRIDA (IMPORTANTE):
1. NO te limites a las categorías existentes. Selecciona las 4 tendencias con MAYOR potencial viral (dando prioridad a lo que es tendencia hoy en ECUADOR —deportes, LigaPro, La Tri, sucesos nacionales, virales en redes de Ecuador— combinado con los fenómenos mundiales más fuertes).
2. Regla Híbrida para "category_name":
   - Si la tendencia encaja claramente en una de las CATEGORÍAS ACTUALES, usa ese nombre exacto.
   - Si es de una temática nueva bien definida (ej. "Ecuador", "Deportes", "Cine y Series", "Cultura Pop", "Mundo", "Finanzas"), escribe ese nuevo nombre de categoría corto (1 o 2 palabras) para que el sistema la cree automáticamente, O usa directamente "${todayTrendCategory}" si es una tendencia general/viral del día.
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
        const selectedIdeas = await generateJson(prompt, TrendSelectionSchema, { label: 'ProcessTrends' })

        if (Array.isArray(selectedIdeas)) {
            for (const item of selectedIdeas.slice(0, 4)) {
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
                        processed: true
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
                if (user?.id) {
                    ideaPayload.user_id = user.id
                }

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
                    await generateScript(ideaRecord.id)
                    ideasCreated++
                }
            }
        }
    } catch (e) {
        console.error('[ProcessTrends] Error evaluating trends batch:', e)
    }

    revalidatePath('/dashboard')
    revalidatePath('/ideas')
    revalidatePath('/categories')

    return { processed: freshTrends.length, created: ideasCreated, trendCategory: todayTrendCategory }
}
