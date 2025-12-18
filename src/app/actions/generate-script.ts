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
      
      INSTRUCCIONES CRÍTICAS DE CONTENIDO:
      1. PROHIBIDO usar marcadores de posición o corchetes como "[INSERTAR FECHA]", "[NOMBRE]", "[DATOS AQUÍ]".
      2. DEBES completar todos los datos. Si la idea se refiere a una persona real (ej: "Messi", "Cristiano"), USA DATOS REALES Y VERÍDICOS.
      3. Si la idea es genérica o ficticia, INVENTA nombres y situaciones realistas y coherentes para completar la historia. NUNCA dejes espacios en blanco.
      4. El guion debe estar listo para leerse/grabarse tal cual.
      5. Estructura de Loop (el final conecta con el inicio).
      6. Todo el contenido debe ser en ESPAÑOL NEUTRO/LATINO.

      FORMATO JSON REQUERIDO:
      {
        "seo_title": "Título optimizado para SEO (max 60 chars)",
        "seo_description": "Descripción para el algoritmo (max 150 chars)",
        "hashtags": ["#tag1", "#tag2", "#tag3"],
        "content": {
           "hook_visual": "Descripción visual de los primeros 3s",
           "hook_audio": "La primera frase que debes decir (Gritando/Susurrando/Normal)",
           "hook_caption": "Texto corto para el video (max 5 palabras)",
           "body_paragraphs": [
              "Párrafo 1 del desarrollo...",
              "Párrafo 2 del desarrollo..."
           ],
           "body_captions": [
              "Caption corto para el párrafo 1",
              "Caption corto para el párrafo 2"
           ],
           "cta": "Llamada a la acción final",
           "cta_caption": "Texto final en pantalla"
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
