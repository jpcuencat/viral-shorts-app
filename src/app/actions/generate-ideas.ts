'use server'

import { model } from '@/lib/ai/gemini'

export async function generateIdeas(category: string, count: number = 5) {
  if (!process.env.GEMINI_API_KEY) {
    return { error: 'Gemini API Key is not configured.' }
  }

  try {
    const prompt = `
      Actúa como un estratega de contenido viral de clase mundial.
      Genera ${count} ideas de videos cortos para la categoría: "${category}".
      
      CRITERIOS DE CALIDAD (IMPORTANTE):
      1. El "Hook" (gancho) debe ser irresistible en los primeros 3 segundos.
      2. Enfócate en formatos de alta retención (storytelling, loops, controversia ligera, life hacks).
      3. SOLO genera ideas que tengan un potencial viral predicho > 90%.

      Formato de salida (JSON Array):
      [
        {
          "title": "Título llamativo (Clickbait ético)",
          "description": "Descripción detallada del visual y la narrativa.",
          "estimated_duration": 45,
          "viral_score": 95
        }
      ]
      
      Responde SOLO con el JSON válido.
    `

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    // Clean response if it contains markdown code blocks
    const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim()

    const ideas = JSON.parse(cleanedText)
    return { data: ideas }

  } catch (error: any) {
    console.error('Error generating ideas:', error)
    return { error: 'Failed to generate ideas. Please try again.' }
  }
}
