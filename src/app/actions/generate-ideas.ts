'use server'

import { model } from '@/lib/ai/gemini'

import { trendsService } from '@/services/trends-service'

export async function generateIdeas(category: string, count: number = 5) {
  if (!process.env.GEMINI_API_KEY) {
    return { error: 'Gemini API Key is not configured.' }
  }

  try {
    // 1. Fetch Trends (Trend Jacking)
    const trendsContext = await trendsService.getTrendsContext('ES', 5) // Spain/Global trends

    // 2. Build Prompt
    const prompt = `
      Actúa como un estratega de contenido viral de clase mundial.
      ${trendsContext ? `\nCONTEXTO DE TENDENCIAS ACTUALES (ÚSALAS SI SON RELEVANTES):\n${trendsContext}\n` : ''}
      
      Genera ${count} ideas de videos cortos para la categoría: "${category}".
      
      CRITERIOS DE CALIDAD (IMPORTANTE):
      1. El "Hook" (gancho) debe ser irresistible en los primeros 3 segundos.
      2. Enfócate en formatos de alta retención (storytelling, loops, controversia ligera, life hacks).
      3. SOLO genera ideas que tengan un potencial viral predicho > 90%.
      4. Si hay tendencias arriba, intenta relacionar al menos una idea con ellas (Trend Jacking).

      Formato de salida (JSON Array):
      [
        {
          "title": "Título llamativo (Clickbait ético)",
          "description": "Descripción detallada del visual y la narrativa.",
          "estimated_duration": 45,
          "viral_score": 95,
          "matched_trend": "Nombre de la tendencia o null"
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
