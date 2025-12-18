'use server'

import { createClient } from '@/lib/supabase/server'
import { getDailyTrends, TrendItem } from '@/lib/trends'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { generateScript } from './generate-script'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function processTrends() {
    const supabase = await createClient()

    // 1. Fetch User Categories
    const { data: categories } = await supabase.from('categories').select('id, name')
    if (!categories || categories.length === 0) return { message: 'No categories found' }

    const categoryNames = categories.map(c => c.name).join(', ')

    // 2. Fetch Trends
    const trends = await getDailyTrends('US') // Default to US for now

    // 3. Process each trend
    let processedCount = 0
    let ideasCreated = 0

    for (const trend of trends.slice(0, 5)) { // Limit to top 5 to avoid timeouts
        // Check if already processed
        const { data: existing } = await supabase
            .from('trends')
            .select('id')
            .eq('title', trend.title)
            .single()

        if (existing) continue

        // 4. AI Evaluation
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

        const prompt = `
        Act as a Viral Content Strategist.
        
        Trend: "${trend.title}"
        Traffic: ${trend.traffic}
        Context: ${trend.newsItemTitle || trend.title}
        
        User Categories: [${categoryNames}]
        
        Task:
        1. Analyze if this trend is HIGHLY relevant to any of the user categories.
        2. If relevant, generate a viral Short video idea.
        3. Assign a "viral_score" (0-100).
        
        Strict Conditions:
        - ONLY output if viral_score > 90.
        - If score < 90 or not relevant, return null.
        
        Output JSON Format (if >90):
        {
            "category_name": "Exact category name from list",
            "title": "Clickbaity Video Title",
            "description": "Short description of the video concept",
            "viral_score": 95,
            "estimated_duration": 45
        }
        `

        try {
            const result = await model.generateContent(prompt)
            const responseText = result.response.text()
            const cleanedText = responseText.replace(/```json|```/g, '').trim()

            if (cleanedText === 'null' || !cleanedText.startsWith('{')) {
                // Mark as processed but no idea
                await supabase.from('trends').insert({ title: trend.title, processed: true, link: trend.link })
                continue
            }

            const ideaData = JSON.parse(cleanedText)

            if (ideaData.viral_score > 90) {
                // 5. Create Trend Record
                const { data: trendRecord, error: trendError } = await supabase
                    .from('trends')
                    .insert({
                        title: trend.title,
                        link: trend.link,
                        traffic: trend.traffic,
                        processed: true
                    })
                    .select('id')
                    .single()

                if (trendError) continue

                // Match category ID
                const categoryId = categories.find(c => c.name === ideaData.category_name)?.id

                // 6. Create Idea
                const { data: ideaRecord, error: ideaError } = await supabase
                    .from('ideas')
                    .insert({
                        title: ideaData.title,
                        description: ideaData.description,
                        category_id: categoryId,
                        status: 'approved', // Auto-approve
                        ai_metadata: {
                            viral_score: ideaData.viral_score,
                            estimated_duration: ideaData.estimated_duration,
                            source: 'auto_trend'
                        },
                        source_trend_id: trendRecord.id
                    })
                    .select('id')
                    .single()

                if (ideaRecord) {
                    // 7. Auto-Generate Script
                    await generateScript(ideaRecord.id)
                    ideasCreated++
                }
            } else {
                await supabase.from('trends').insert({ title: trend.title, processed: true, link: trend.link })
            }

        } catch (e) {
            console.error('Error processing trend:', trend.title, e)
        }

        processedCount++
    }

    return { processed: processedCount, created: ideasCreated }
}
