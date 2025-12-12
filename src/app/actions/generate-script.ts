'use server'

import { model } from '@/lib/ai/gemini'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function generateScript(ideaId: string) {
    const supabase = await createClient()

    // 1. Fetch the Idea Context
    const { data: idea, error: fetchError } = await supabase
        .from('ideas')
        .select('*, categories(name)')
        .eq('id', ideaId)
        .single()

    if (fetchError || !idea) {
        return { error: 'Idea not found' }
    }

    try {
        // 2. Construct the Prompt (Anti-Hallucination Focused)
        const prompt = `
      Actúa como un guionista experto en Shorts/Reels/TikTok.
      Tu tarea es escribir un guion de 60 segundos basado en esta idea aprobada.
      
      CONTEXTO:
      - Título: "${idea.title}"
      - Descripción: "${idea.description}"
      - Categoría: "${idea.categories?.name || 'General'}"
      
      INSTRUCCIONES CRÍTICAS PARA EVITAR ALUCINACIONES:
      1. NO inventes estadísticas o datos falsos. Si necesitas un dato, usa marcadores como "[INSERTAR FECHA]" o "[DATOS AQUÍ]".
      2. Cíñete estrictamente a la premisa de la descripción.
      3. Estructura el guion para máxima retención (Loop structure).

      FORMATO JSON REQUERIDO:
      {
        "seo_title": "Título optimizado para SEO (max 60 chars)",
        "seo_description": "Descripción para el algoritmo (max 150 chars)",
        "hashtags": ["#tag1", "#tag2", "#tag3"],
        "content": {
           "hook_visual": "Descripción visual de los primeros 3s",
           "hook_audio": "La primera frase que debes decir (Gritando/Susurrando/Normal)",
           "body_paragraphs": [
              "Párrafo 1 del desarrollo...",
              "Párrafo 2 del desarrollo..."
           ],
           "cta": "Llamada a la acción final"
        },
        "estimated_duration": 55
      }

      Responde SOLO con el JSON válido.
    `

        // 3. Call Gemini
        const result = await model.generateContent(prompt)
        const response = await result.response
        const text = response.text()
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim()

        const scriptData = JSON.parse(cleanedText)

        // 4. Save to Database
        const { data: script, error: insertError } = await supabase
            .from('scripts')
            .insert({
                idea_id: ideaId,
                content: JSON.stringify(scriptData.content), // Storing unstructured JSON inside text column for now if needed, or mapping fields
                seo_title: scriptData.seo_title,
                seo_description: scriptData.seo_description,
                hashtags: scriptData.hashtags,
                estimated_duration: scriptData.estimated_duration,
                status: 'draft',
                user_id: idea.user_id
            })
            .select()
            .single()

        if (insertError) throw insertError

        revalidatePath(`/ideas/${ideaId}`)
        return { success: true, scriptId: script.id }

    } catch (error: any) {
        console.error('Error generating script:', error)
        return { error: 'Failed to generate script. Please try again.' }
    }
}
