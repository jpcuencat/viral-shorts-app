import type { SupabaseClient } from '@supabase/supabase-js'
import { generateJson } from '@/lib/ai/gemini'
import { ScriptResponseSchema } from '@/lib/ai/schemas'
import { researchFacts } from '@/lib/ai/fact-check'

/**
 * Genera y guarda el guion de una idea. Recibe el cliente de base de datos para poder ejecutarse
 * tanto desde una acción del servidor (sesión del usuario) como desde el worker (clave de servicio).
 */
export async function generateScriptForIdea(
    supabase: SupabaseClient,
    ideaId: string,
    expectedUserId?: string
): Promise<{ success?: boolean; scriptId?: string; error?: string }> {

    // 1. Fetch the Idea Context
    const { data: idea, error: fetchError } = await supabase
        .from('ideas')
        .select('*, categories(name)')
        .eq('id', ideaId)
        .single()

    if (fetchError || !idea) {
        return { error: 'Idea not found' }
    }
    if (expectedUserId && idea.user_id && idea.user_id !== expectedUserId) {
        return { error: 'La idea no pertenece a este usuario' }
    }

    try {
        // 1.B VERIFICACIÓN DE HECHOS con Google: el guion solo puede afirmar lo confirmado por fuentes
        const facts = await researchFacts({
            title: idea.title,
            description: idea.description || undefined,
            trendTitle: idea.ai_metadata?.matched_trend,
            trendLink: idea.ai_metadata?.trend_link,
        })
        const factSection = facts.verified
            ? `
      INFORMACIÓN VERIFICADA (investigación en Google; ÚNICA base factual permitida):
      ${facts.brief.split('\n').join('\n      ')}
      Fuentes: ${facts.domains.join(', ') || 'medios citados arriba'}

      REGLAS DE VERACIDAD (OBLIGATORIAS, por encima de cualquier otra instrucción):
      1. Todo dato concreto (nombres, cargos, cifras, lugares, fechas, acusaciones, reacciones) debe estar en INFORMACIÓN VERIFICADA. Si no está, NO lo digas.
      2. Atribuye acusaciones y cargos ("según la Fiscalía", "según medios como Primicias") y usa "presunto/presunta". Nunca presentes una acusación como hecho probado.
      3. No inventes reacciones, protestas, movilizaciones, cifras ni consecuencias. Lo que aún no se sabe, dilo así ("aún no se conoce…") o no lo menciones.
      4. Gancho llamativo pero fiel a los hechos: nada de "shock", "escándalo" o exageraciones que los hechos no respalden.
      5. Si algo está en "NO CONFIRMADO", solo puedes mencionarlo diciendo explícitamente que no está confirmado.
`
            : `
      AVISO DE VERACIDAD: no se encontró información verificable sobre este tema en fuentes fiables.
      Escribe un guion explicativo o de contexto general. NO afirmes hechos concretos de actualidad
      (detenciones, acusaciones, cifras, declaraciones) sobre personas reales ni instituciones.
`

        // 2. Construct the Prompt (Visual Storyboard & Direct Protagonist Focus)
        const prompt = `
      Actúa como un Director y Guionista Experto en YouTube Shorts y TikTok.
      Tu tarea es escribir un guion dinámico y altamente visual basado en esta idea:
      
      CONTEXTO PRINCIPAL:
      - Título: "${idea.title}"
      - Descripción: "${idea.description}"
      - Categoría: "${idea.categories?.name || 'General'}"
      ${factSection}
      ${idea.ai_metadata?.parent_idea_title ? `- VIDEO DE SEGUIMIENTO / CONTINUACIÓN DE: "${idea.ai_metadata.parent_idea_title}" (Ángulo: ${idea.ai_metadata?.follow_up_angle || 'Parte 2'}). Profundiza en este nuevo ángulo sin repetir lo obvio.` : ''}
      
      INSTRUCCIONES CRÍTICAS DE NARRACIÓN Y RITMO (MUY IMPORTANTE):
      1. PROHIBIDO usar marcadores de posición o direcciones escénicas como "[Sonido]" o "(Gritando)".
      2. 'hook_audio' y 'body_paragraphs' deben contener SOLO las palabras exactas que dirá el narrador.
      3. FRASES CORTAS Y VISUALES: En 'body_paragraphs', escribe entre 4 y 6 oraciones cortas (máximo 15-18 palabras por oración). Cada oración será una escena visual distinta de 3 a 5 segundos.
      4. CERO METÁFORAS ABSTRACTAS DESCONECTADAS: Si hablas de Messi y el fútbol, cada oración debe evocar una escena concreta de fútbol, estadio, vestuario, cancha o el protagonista en acción.

      INSTRUCCIONES DE DIRECCIÓN VISUAL ('hook_visual', 'scene_visuals', 'cta_visual'):
      1. Mantén SIEMPRE al PROTAGONISTA y TEMA CENTRAL en pantalla. Si el video es sobre Lionel Messi y el fútbol, TODAS las escenas deben mostrar explícitamente a Lionel Messi, jugadores de fútbol en el campo, jugadas, goles, vestuario o el directivo en el estadio.
      2. PROHIBIDO usar objetos genéricos sin relación (nunca pongas un micrófono de podcast, ni una pluma escribiendo en un libro, ni pantallas abstractas).

      FORMATO JSON REQUERIDO:
      {
        "seo_title": "Título optimizado para SEO (max 60 chars)",
        "seo_description": "Descripción para el algoritmo (max 150 chars)",
        "hashtags": ["#tag1", "#tag2", "#tag3"],
        "content": {
           "protagonist_en": "Explicit English description of the main visual subject/character and setting to keep consistent across all scenes (e.g., 'Lionel Messi in Argentina #10 soccer jersey on a floodlit football pitch')",
           "hook_visual": "Detailed English visual prompt showing the protagonist in action for the hook",
           "hook_audio": "Frase inicial impactante de máximo 15 palabras",
           "hook_caption": "Gancho Corto",
           "body_paragraphs": [
              "Primera oración corta de acción directa (máximo 16 palabras).",
              "Segunda oración corta que avanza la historia (máximo 16 palabras).",
              "Tercera oración corta con el giro o revelación (máximo 16 palabras).",
              "Cuarta oración corta con el desenlace del caso (máximo 16 palabras)."
           ],
           "scene_visuals": [
              "Detailed English visual prompt for sentence 1 keeping the main protagonist/subject in frame",
              "Detailed English visual prompt for sentence 2 keeping the main protagonist/subject in frame",
              "Detailed English visual prompt for sentence 3 keeping the main protagonist/subject in frame",
              "Detailed English visual prompt for sentence 4 keeping the main protagonist/subject in frame"
           ],
           "body_captions": [
              "Subtítulo 1",
              "Subtítulo 2",
              "Subtítulo 3",
              "Subtítulo 4"
           ],
           "cta": "Frase final de cierre conectada al tema invitando a comentar y suscribirse",
           "cta_visual": "Detailed English visual prompt of the main protagonist in an epic final pose",
           "cta_caption": "Suscríbete"
        },
        "estimated_duration": 45
      }

      Responde SOLO con el JSON válido.
    `

        // 3. Call Gemini
        const scriptData = await generateJson(prompt, ScriptResponseSchema, { label: 'GenerateScript' })

        // Guardar la verificación junto al guion (la usan las tarjetas informativas y la descripción)
        ;(scriptData.content as Record<string, unknown>).fact_check = {
            verified: facts.verified,
            domains: facts.domains,
            sources: facts.sources,
            location: facts.location,
            event_date: facts.eventDate,
            checked_at: facts.checkedAt,
        }
        const sourcesLine = facts.verified && facts.domains.length > 0 ? `\n\nFuentes: ${facts.domains.join(', ')}` : ''

        // 4. Save to Database
        const { data: script, error: insertError } = await supabase
            .from('scripts')
            .insert({
                idea_id: ideaId,
                content: JSON.stringify(scriptData.content),
                seo_title: scriptData.seo_title,
                seo_description: `${scriptData.seo_description}${sourcesLine}`,
                hashtags: scriptData.hashtags,
                estimated_duration: scriptData.estimated_duration,
                status: 'draft',
                user_id: idea.user_id
            })
            .select()
            .single()

        if (insertError) throw insertError

        return { success: true, scriptId: script.id }

    } catch (error: any) {
        console.error('Error generating script:', error)
        return { error: 'Failed to generate script. Please try again.' }
    }
}
