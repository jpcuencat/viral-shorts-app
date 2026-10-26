import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * TAXONOMÍA FIJA: 6 categorías principales con subcategorías + "Tendencias" (lo que es tendencia pero no
 * encaja en ninguna). La IA solo elige entre estas; nunca crea categorías nuevas.
 * Cada subcategoría tiene sus búsquedas de Google News (español e inglés) para traer noticias de las últimas horas.
 */
export interface SubTopic { es: string; en?: string; gl?: string; hint: string }

export const TOPIC_SEARCH: Record<string, SubTopic> = {
    'ecuador-politica': { es: 'Ecuador (Noboa OR Asamblea OR CNE OR gobierno OR elecciones OR ministro)', gl: 'EC', hint: 'política, gobierno, elecciones y Asamblea de Ecuador' },
    'ecuador-sucesos': { es: 'Ecuador (Guayaquil OR Quito OR Cuenca OR policía OR operativo OR accidente OR crimen OR tragedia)', gl: 'EC', hint: 'sucesos, seguridad, crímenes, accidentes y tragedias en Ecuador' },
    'ecuador-economia': { es: 'Ecuador (economía OR precios OR IESS OR empleo OR petróleo OR impuestos OR SRI OR apagones)', gl: 'EC', hint: 'economía, precios, empleo, impuestos y servicios en Ecuador' },
    'ecuador-sociedad': { es: 'Ecuador (educación OR clima OR viral OR ciudadanos OR cultura OR feriado)', gl: 'EC', hint: 'sociedad, educación, clima, cultura y temas virales de Ecuador' },
    'mundo-politica': { es: '(presidente OR gobierno OR elecciones OR cumbre OR Trump OR ONU) internacional', en: 'world politics president election', hint: 'política internacional, elecciones y líderes mundiales' },
    'mundo-conflictos': { es: 'guerra OR conflicto OR ataque OR "alto el fuego" OR misiles', en: 'war OR conflict OR ceasefire OR strike', hint: 'guerras, conflictos armados y crisis internacionales' },
    'mundo-latinoamerica': { es: '(México OR Colombia OR Argentina OR Perú OR Chile OR Brasil OR Venezuela OR Bolivia) noticias', hint: 'noticias de países latinoamericanos (fuera de Ecuador)' },
    'futbol': { es: 'fútbol (gol OR partido OR fichaje OR resultado)', en: 'soccer football match', hint: 'fútbol en general, fichajes, resultados y polémicas' },
    'seleccion-ligapro': { es: '(Selección de Ecuador OR LigaPro OR "Barcelona SC" OR "Liga de Quito" OR Emelec OR "Independiente del Valle" OR "Moisés Caicedo" OR "Piero Hincapié" OR "Willian Pacho")', gl: 'EC', hint: 'Selección de Ecuador, LigaPro y futbolistas ecuatorianos' },
    'champions-europa': { es: '(Champions League OR LaLiga OR Premier League OR "Real Madrid" OR "FC Barcelona" OR Mbappé OR Yamal OR Haaland)', en: 'Champions League OR Premier League OR LaLiga', hint: 'Champions, ligas europeas y sus estrellas' },
    'otros-deportes': { es: '(NBA OR "Fórmula 1" OR tenis OR ciclismo OR boxeo OR UFC OR MLB)', en: 'NBA OR F1 OR tennis OR UFC', hint: 'NBA, F1, tenis, ciclismo, boxeo, UFC y otros deportes' },
    'ia': { es: '(inteligencia artificial OR OpenAI OR ChatGPT OR Gemini OR Claude OR robot)', en: 'AI OR OpenAI OR ChatGPT OR Gemini OR Anthropic', hint: 'inteligencia artificial, chatbots, robots y empresas de IA' },
    'software': { es: '(app OR aplicación OR actualización OR WhatsApp OR Android OR iOS OR Windows)', en: 'app update OR WhatsApp OR Android OR iOS', hint: 'apps, actualizaciones, redes sociales y sistemas operativos' },
    'hardware': { es: '(iPhone OR Samsung OR celular OR Nvidia OR consola OR PlayStation OR gadget)', en: 'iPhone OR Samsung OR Nvidia OR gadget', hint: 'celulares, gadgets, consolas y chips' },
    'ciberseguridad': { es: '(hackeo OR ciberataque OR estafa digital OR filtración de datos OR phishing)', en: 'hack OR cyberattack OR data breach OR scam', hint: 'hackeos, estafas digitales y filtraciones' },
    'musica': { es: '(canción OR concierto OR álbum OR Bad Bunny OR Shakira OR "Karol G" OR "Taylor Swift" OR Grammy)', en: 'music OR concert OR album OR Grammy', hint: 'música, artistas, conciertos y lanzamientos' },
    'cine-series': { es: '(película OR serie OR Netflix OR estreno OR Marvel OR taquilla OR Oscar)', en: 'movie OR series OR Netflix OR box office', hint: 'películas, series, estrenos y streaming' },
    'virales-internet': { es: 'viral (TikTok OR redes sociales OR video OR influencer)', en: 'viral TikTok video', hint: 'virales de redes, memes, retos e internet' },
    'famosos': { es: '(famoso OR celebridad OR influencer OR actriz OR cantante) polémica', en: 'celebrity', hint: 'famosos, celebridades, influencers y polémicas' },
    'ciencia': { es: '(científicos OR descubrimiento OR estudio OR investigación) ciencia', en: 'scientists discovery study', hint: 'descubrimientos científicos y estudios' },
    'salud': { es: '(salud OR médicos OR enfermedad OR vacuna OR estudio médico)', en: 'health study OR doctors', hint: 'salud, medicina, enfermedades y estudios médicos' },
    'nutricion': { es: '(nutrición OR dieta OR alimentos OR azúcar OR proteína)', en: 'nutrition OR diet', hint: 'nutrición, alimentos y dietas' },
    'espacio': { es: '(NASA OR espacio OR cohete OR SpaceX OR astronomía OR asteroide OR eclipse)', en: 'NASA OR SpaceX OR space OR asteroid', hint: 'espacio, astronomía, NASA y SpaceX' },
}

export const TRENDS_SLUG = 'tendencias'

export interface CategoryNode { id: string; name: string; slug: string; parentId: string | null; sortOrder: number }
export interface CategoryTree {
    parents: (CategoryNode & { children: CategoryNode[] })[]
    bySlug: Map<string, CategoryNode>
    byId: Map<string, CategoryNode>
}

export async function loadCategoryTree(db: SupabaseClient): Promise<CategoryTree> {
    const { data } = await db.from('categories').select('id, name, slug, parent_id, sort_order')
    const nodes: CategoryNode[] = (data || []).map((r: any) => ({ id: r.id, name: r.name, slug: r.slug, parentId: r.parent_id, sortOrder: r.sort_order ?? 0 }))
    const parents = nodes.filter(n => !n.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
        .map(p => ({ ...p, children: nodes.filter(c => c.parentId === p.id).sort((a, b) => a.sortOrder - b.sortOrder) }))
    return { parents, bySlug: new Map(nodes.map(n => [n.slug, n])), byId: new Map(nodes.map(n => [n.id, n])) }
}

/** "Deportes › Fútbol" */
export function categoryLabel(tree: CategoryTree, id?: string | null): string {
    const n = id ? tree.byId.get(id) : undefined
    if (!n) return ''
    const p = n.parentId ? tree.byId.get(n.parentId) : undefined
    return p ? `${p.name} › ${n.name}` : n.name
}

/** Subcategorías que cubre una selección (principal → todas sus hijas; subcategoría → ella misma). */
export function subtopicsFor(tree: CategoryTree, categoryId: string): CategoryNode[] {
    const n = tree.byId.get(categoryId)
    if (!n) return []
    if (n.parentId) return [n]
    return tree.parents.find(p => p.id === n.id)?.children || []
}

/** Lista para el prompt: "slug: Principal › Sub (de qué trata)". */
export function allowedSubcategoriesText(tree: CategoryTree, limitTo?: CategoryNode[]): string {
    const list = limitTo?.length ? limitTo : tree.parents.flatMap(p => p.children)
    const lines = list.map(c => `- ${c.slug}: ${categoryLabel(tree, c.id)} (${TOPIC_SEARCH[c.slug]?.hint || c.name})`)
    if (!limitTo?.length) lines.push(`- ${TRENDS_SLUG}: Tendencias (lo que es tendencia pero no encaja en ninguna de las anteriores)`)
    return lines.join('\n')
}

/** Resuelve el slug que eligió la IA; si no existe, la idea va a "Tendencias" (nunca se crea una categoría). */
export function resolveCategory(tree: CategoryTree, slug?: string, fallbackId?: string): CategoryNode | undefined {
    const s = (slug || '').trim().toLowerCase()
    return tree.bySlug.get(s) || (fallbackId ? tree.byId.get(fallbackId) : undefined) || tree.bySlug.get(TRENDS_SLUG)
}
