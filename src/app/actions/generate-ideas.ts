'use server'

import { generateJson } from '@/lib/ai/gemini'
import { IdeaSuggestionListSchema } from '@/lib/ai/schemas'
import { trendsService } from '@/services/trends-service'
import { getTodayTrendCategoryName } from '@/lib/trends'

export async function generateIdeas(category: string, count: number = 6) {
    if (!process.env.GEMINI_API_KEY) {
        return { error: 'Gemini API Key is not configured.' }
    }

    try {
        const isOpenTrends = category === 'OPEN_TRENDS' || category.toLowerCase().startsWith('tendencias')
        const todayBucket = getTodayTrendCategoryName()

        // 1. Tendencias en vivo a nivel mundial (Ecuador incluido como un mercado más)
        const trendsContext = await trendsService.getTrendsContext(24, isOpenTrends ? 'OPEN_TRENDS' : category)

        // 2. Build Prompt
        const prompt = isOpenTrends
            ? `
      Actúa como un estratega de contenido viral GLOBAL para YouTube Shorts, TikTok, Instagram Reels y X, que produce en ESPAÑOL para una audiencia hispanohablante internacional.
      
      ${trendsContext}
      
      MODO ABIERTO DE TENDENCIAS (MUNDIAL):
      Genera ${count} ideas de videos cortos en ESPAÑOL basadas en las tendencias reales listadas arriba, SIN LIMITARTE a ninguna categoría fija.
      - Elige por POTENCIAL VIRAL REAL, sin favorecer a ningún país. Ecuador es un mercado más: inclúyelo solo cuando su tema compita en interés.
      - Un tema que es tendencia en varios países a la vez es señal fuerte de viralidad mundial.
      - Busca variedad: no concentres todas las ideas en un mismo país o tema.
      
      REGLA DE CATEGORIZACIÓN HÍBRIDA:
      En el campo "suggested_category" de cada idea:
      - Asigna o bien la categoría general del día "${todayBucket}"
      - O bien una categoría temática clara de 1-2 palabras (ej. "Mundo", "Deportes", "Cultura Pop", "Tecnología", "Finanzas", "IA", o un país concreto si el tema es local).

      Formato de salida (JSON Array estricto):
      [
        {
          "title": "Título llamativo en español (Hook de alta retención)",
          "description": "Explicación de qué trata la tendencia en redes/noticias y cómo desarrollarla en el Short.",
          "estimated_duration": 45,
          "viral_score": 96,
          "matched_trend": "Nombre de la tendencia real usada (ej. X Trend / Google Trend)",
          "suggested_category": "${todayBucket}"
        }
      ]
      Responde SOLO con el JSON válido.
    `
            : `
      Actúa como un estratega de contenido viral de clase mundial para YouTube Shorts y TikTok.
      ${trendsContext ? `\n${trendsContext}\n` : ''}
      
      Genera ${count} ideas de videos cortos en ESPAÑOL para la categoría: "${category}".
      
      CRITERIOS DE CALIDAD:
      1. Al menos el 70% de las ideas DEBEN conectarse con las NOTICIAS Y TENDENCIAS EN TIEMPO REAL listadas arriba (Trend Jacking).
      2. El "Hook" en el título y descripción debe atrapar en los primeros 3 segundos.
      3. Incluye en "matched_trend" el titular o tendencia real que inspiró la idea.

      Formato de salida (JSON Array estricto):
      [
        {
          "title": "Título llamativo en español (Clickbait ético de alta retención)",
          "description": "Descripción clara del ángulo narrativo, qué pasó en la noticia/tendencia y por qué impacta al espectador.",
          "estimated_duration": 45,
          "viral_score": 95,
          "matched_trend": "Nombre corto de la noticia o tendencia real usada",
          "suggested_category": "${category}"
        }
      ]
      
      Responde SOLO con el JSON válido.
    `

        const ideas = await generateJson(prompt, IdeaSuggestionListSchema, { label: 'GenerateIdeas' })
        return { data: ideas, todayBucket }

    } catch (error: any) {
        console.error('Error generating ideas:', error)
        return { error: 'Failed to generate ideas. Please try again.' }
    }
}
