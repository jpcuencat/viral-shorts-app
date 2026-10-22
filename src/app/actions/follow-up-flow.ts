'use server'

import { createClient } from '@/lib/supabase/server'
import { generateJson } from '@/lib/ai/gemini'
import { FollowUpListSchema } from '@/lib/ai/schemas'
import { generateScript } from './generate-script'
import { revalidatePath } from 'next/cache'

export interface FollowUpIdeaSuggestion {
    title: string
    description: string
    angle_tag: string
    estimated_duration: number
    viral_score: number
}

/**
 * Generates 4 viral follow-up / sequel ideas ("Parte 2", deeper angle, practical consequences, myth/mistake)
 * starting from an existing Idea (and its Script if available).
 */
export async function generateFollowUpIdeas(
    sourceIdeaId: string,
    customAngle?: string
): Promise<{ data?: FollowUpIdeaSuggestion[]; sourceTitle?: string; error?: string }> {
    const supabase = await createClient()

    const { data: sourceIdea, error: ideaError } = await supabase
        .from('ideas')
        .select('*, categories(name), scripts(content, seo_title, created_at)')
        .eq('id', sourceIdeaId)
        .order('created_at', { referencedTable: 'scripts', ascending: false })
        .single()

    if (ideaError || !sourceIdea) {
        return { error: 'No se encontró la idea base para crear el seguimiento.' }
    }

    let previousScriptSummary = ''
    let verifiedSection = ''
    const firstScript = Array.isArray(sourceIdea.scripts) ? sourceIdea.scripts[0] : null
    if (firstScript?.content) {
        try {
            const parsed = typeof firstScript.content === 'string'
                ? JSON.parse(firstScript.content)
                : firstScript.content
            const paragraphs = Array.isArray(parsed?.body_paragraphs)
                ? parsed.body_paragraphs.join(' ')
                : ''
            previousScriptSummary = `
GUION DEL VIDEO ANTERIOR (Lo que el espectador YA vio):
- Hook: "${parsed?.hook_audio || ''}"
- Desarrollo: "${paragraphs}"
`
            const fc = parsed?.fact_check
            if (fc?.verified) {
                verifiedSection = `
HECHOS VERIFICADOS DE LA NOTICIA ORIGINAL (fuentes: ${(fc.domains || []).join(', ')}${fc.location ? `; lugar: ${fc.location}` : ''}):
${fc.brief || '(ver guion anterior: solo lo dicho allí está confirmado)'}

REGLAS DE VERACIDAD PARA LAS IDEAS:
- Cada idea debe poder sostenerse con estos hechos o con información pública verificable; no prometas revelaciones, multas, sanciones, reacciones ni consecuencias que no consten.
- Si un ángulo (p. ej. consecuencias o impacto futuro) no tiene base confirmada, plantéalo como explicación del proceso o pregunta abierta ("qué puede pasar ahora según la ley"), nunca como hecho.
- Mantén la MISMA historia, lugar y protagonistas; no mezcles otros casos.
`
            }
        } catch {
            // ignore parse error
        }
    }

    const prompt = `
Actúa como un Director de Contenido Viral GLOBAL para YouTube Shorts, TikTok e Instagram Reels, que produce en ESPAÑOL para una audiencia hispanohablante internacional.

Estamos viendo un Short que acabamos de producir y queremos crear **IDEAS DE SEGUIMIENTO (Parte 2 / Continuación / Derivados)** que enganchen a la misma audiencia sin repetir exactamente el mismo guion.

IDEA BASE ACTUAL:
- Título: "${sourceIdea.title}"
- Descripción: "${sourceIdea.description || ''}"
- Categoría: "${sourceIdea.categories?.name || 'General'}"
- Tendencia original: "${sourceIdea.ai_metadata?.matched_trend || sourceIdea.title}"
${previousScriptSummary}
${verifiedSection}

${customAngle?.trim() ? `ENFOQUE ESPECÍFICO SOLICITADO POR EL CREADOR:\n"${customAngle.trim()}"\n(Prioriza este enfoque en las propuestas).` : ''}

INSTRUCCIONES:
Genera 4 ideas de seguimiento altamente virales en ESPAÑOL que continúen o expandan este tema desde ángulos complementarios:
1. "Parte 2 / Lo que nadie te contó": Dato clave CONFIRMADO que quedó fuera del primer video.
2. "Consecuencias / Multas / Errores": Qué pasa si te equivocas, multas, sanciones o errores comunes que comete la gente en este tema.
3. "Guía Rápida / Caso Práctico": Cómo actuar paso a paso o qué hacer exactamente ante esta situación.
4. "Debate / Impacto Futuro": El giro polémico o qué va a pasar en los próximos días con este tema.

Responde SOLO con un JSON Array válido con este formato exacto:
[
  {
    "angle_tag": "Parte 2: Lo que ocultaron",
    "title": "Título viral en español con gancho directo para el Short de seguimiento",
    "description": "Explicación clara de qué tratará este nuevo video de seguimiento, qué escenas mostrará y cómo conecta con el video anterior.",
    "estimated_duration": 45,
    "viral_score": 96
  }
]
`

    try {
        const suggestions: FollowUpIdeaSuggestion[] = await generateJson(prompt, FollowUpListSchema, { label: 'FollowUpFlow' })

        return {
            data: Array.isArray(suggestions) ? suggestions : [],
            sourceTitle: sourceIdea.title
        }
    } catch (error: any) {
        console.error('[FollowUpFlow] Error generating follow-up ideas:', error)
        return { error: 'No se pudieron generar las ideas de seguimiento. Intenta nuevamente.' }
    }
}

/**
 * Creates the Follow-Up Idea in Supabase AND immediately generates its full Visual Storyboard Script
 * so the caller can either open the new Script Editor or immediately trigger Reel video rendering.
 */
export async function createFollowUpIdeaAndScript(
    sourceIdeaId: string,
    followUp: {
        title: string
        description: string
        angle_tag?: string
        estimated_duration?: number
        viral_score?: number
    }
): Promise<{
    success?: boolean
    ideaId?: string
    scriptId?: string
    title?: string
    error?: string
}> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: sourceIdea, error: sourceError } = await supabase
        .from('ideas')
        .select('*')
        .eq('id', sourceIdeaId)
        .single()

    if (sourceError || !sourceIdea) {
        return { error: 'No se encontró la idea origen.' }
    }

    const newIdeaPayload: Record<string, any> = {
        title: followUp.title,
        description: followUp.description,
        category_id: sourceIdea.category_id,
        status: 'approved',
        ai_metadata: {
            ...(sourceIdea.ai_metadata || {}),
            viral_score: followUp.viral_score || 95,
            estimated_duration: followUp.estimated_duration || 45,
            source: 'follow_up',
            parent_idea_id: sourceIdea.id,
            parent_idea_title: sourceIdea.title,
            follow_up_angle: followUp.angle_tag || 'Seguimiento'
        }
    }

    if (user?.id) {
        newIdeaPayload.user_id = user.id
    } else if (sourceIdea.user_id) {
        newIdeaPayload.user_id = sourceIdea.user_id
    }

    const { data: createdIdea, error: insertIdeaError } = await supabase
        .from('ideas')
        .insert(newIdeaPayload)
        .select('id, title')
        .single()

    if (insertIdeaError || !createdIdea) {
        console.error('[FollowUpFlow] Error inserting follow-up idea:', insertIdeaError)
        return { error: 'No se pudo guardar la idea de seguimiento.' }
    }

    // Auto-generate the script for the new follow-up idea
    const scriptResult = await generateScript(createdIdea.id)

    revalidatePath('/dashboard')
    revalidatePath('/ideas')
    revalidatePath(`/ideas/${sourceIdeaId}`)

    if (scriptResult.error || !scriptResult.scriptId) {
        return {
            success: true,
            ideaId: createdIdea.id,
            title: createdIdea.title,
            error: 'La idea se creó, pero hubo un problema generando el guion automático.'
        }
    }

    revalidatePath(`/scripts/${scriptResult.scriptId}`)

    return {
        success: true,
        ideaId: createdIdea.id,
        scriptId: scriptResult.scriptId,
        title: createdIdea.title
    }
}
