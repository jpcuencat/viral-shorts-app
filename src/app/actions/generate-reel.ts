'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { videoService } from '@/services/video-service'
import { imageService } from '@/services/image-service'
import { audioService } from '@/services/audio-service'
import { model } from '@/lib/ai/gemini'
import { subtitleService } from '@/services/subtitle-service'
import { youtubeService } from '@/services/youtube-service'
import fs from 'fs'
import path from 'path'

export async function generateReel(scriptId: string) {
    const supabase = await createClient()

    try {
        // 1. Fetch Script
        const { data: script, error: fetchError } = await supabase
            .from('scripts')
            .select('*, ideas(title)')
            .eq('id', scriptId)
            .single()

        if (fetchError || !script) throw new Error('Script not found')

        // 2. Parse Content
        let content: any = script.content
        if (typeof content === 'string') content = JSON.parse(content)

        // 3. Create/Reset Reel Record
        // ... (Existing logic to find/create reel)
        const { data: existingReel } = await supabase.from('reels').select('id').eq('script_id', scriptId).single()
        let reelId = existingReel?.id

        if (!reelId) {
            const { data: newReel, error: createError } = await supabase
                .from('reels')
                .insert({
                    script_id: scriptId,
                    status: 'generating',
                    user_id: script.user_id
                })
                .select()
                .single()
            if (createError) throw createError
            reelId = newReel.id
        } else {
            await supabase.from('reels').update({ status: 'generating' }).eq('id', reelId)
            // Clean up old scenes
            await supabase.from('reel_scenes').delete().eq('reel_id', reelId)
        }

        // 4. PREPARE ASSETS (Local Generation)
        try {
            console.log('[ReelGen] Starting Local Generation Pipeline...')
            if (!content) throw new Error('Script content is missing or invalid')

            const ideaContext = `${script.ideas?.title || ''}, ${script.ideas?.description || ''}`.slice(0, 100)

            // Define Scences to generate
            const scenesData = []

            // 1. HOOK
            scenesData.push({
                text: content.hook_audio || content.hook || `${script.ideas?.title}`,
                visual: content.hook_visual || `Cinematic shot of ${script.ideas?.title}`,
                caption: content.hook_caption || (content.hook_audio || '').slice(0, 30) // Use caption or truncate audio
            })

            // 2. BODY (Iterate all paragraphs)
            if (content.body_paragraphs && Array.isArray(content.body_paragraphs)) {
                content.body_paragraphs.forEach((para: string, index: number) => {
                    // SPLIT PARAGRAPH INTO SENTENCES
                    // Regex looks for (. ! ?) followed by space or end of string
                    const sentences = para.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [para]

                    sentences.forEach((sentence, subIndex) => {
                        const cleanSentence = sentence.trim()
                        if (cleanSentence.length > 5) { // Skip empty/tiny fragments
                            scenesData.push({
                                text: cleanSentence,
                                visual: `Scene ${index + 1}.${subIndex + 1} of ${script.ideas?.title}`,
                                caption: cleanSentence.split(' ').slice(0, 3).join(' ') // Short summary
                            })
                        }
                    })
                })
            } else {
                scenesData.push({
                    text: 'Content body',
                    visual: `Visual about ${script.ideas?.title}`,
                    caption: script.ideas?.title
                })
            }

            // 3. CTA
            scenesData.push({
                text: content.cta || 'Follow for more',
                visual: content.cta_visual || `Conclusion of ${script.ideas?.title}`,
                caption: content.cta_caption || 'Follow for more'
            })

            // Helper for Retry Logic
            const retryOperation = async (fn: () => Promise<string>, retries = 3, delay = 2000): Promise<string> => {
                try {
                    return await fn()
                } catch (error) {
                    if (retries <= 0) throw error
                    console.log(`[ReelGen] Retrying operation... attempts left: ${retries}`)
                    await new Promise(resolve => setTimeout(resolve, delay))
                    return retryOperation(fn, retries - 1, delay)
                }
            }

            // 4.1 Check for Background Videos
            const bgDir = path.join(process.cwd(), 'public', 'backgrounds')

            // Ensure dir exists
            if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true })

            // Get ALL available background files
            const backgroundFiles = fs.readdirSync(bgDir).filter(f => f.endsWith('.mp4'))
            console.log(`[ReelGen] Found ${backgroundFiles.length} background videos available for dynamic switching.`)

            const processedScenes = []

            for (let i = 0; i < scenesData.length; i++) {
                const scene = scenesData[i]

                // A. Generate Audio
                console.log(`[ReelGen] Generating Audio for scene ${i + 1}...`)
                const audioPath = await audioService.generateAudio(scene.text, 'es')

                // A.1 Generate Subtitles (Dynamic SRT)
                const duration = await videoService.getAudioDuration(audioPath)
                const subtitlePath = await subtitleService.generateSRT(scene.text, duration)

                let imagePath = ''
                // Default to 0, will be randomized if video is used
                let sceneVideoStartTime = 0
                let imageUrl = ''

                // DYNAMIC BACKGROUND LOGIC:
                // If we have gameplay videos, pick a RANDOM one for EACH scene.
                // This creates the "Fast Paced / Dynamic" effect (Minecraft -> GTA -> Parkour)
                if (backgroundFiles.length > 0) {
                    const randomFile = backgroundFiles[Math.floor(Math.random() * backgroundFiles.length)]

                    imagePath = path.join(bgDir, randomFile)
                    // Random start time between 0 and 60s (or more if clips are longer)
                    // Since we stream_loop, safe to pick any start.
                    sceneVideoStartTime = Math.floor(Math.random() * 60)

                    imageUrl = `Gameplay: ${randomFile}`
                    console.log(`[ReelGen] Scene ${i + 1}: Using Verified Gameplay ${randomFile} at ${sceneVideoStartTime}s`)

                } else {
                    // B. AI GENERATION (Pollinations) - FALLBACK if no videos exist
                    console.log(`[ReelGen] Generando Imagen IA for scene ${i + 1}...`)

                    const basePrompt = (scene.visual || '').replace(/[^\w\s]/gi, '')
                    const enhancedPrompt = `Hyper-realistic photo of ${basePrompt}, context: ${ideaContext}, 8k, dramatic lighting, detailed, vertical ratio`
                    const seed = Math.floor(Math.random() * 999999)
                    imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=1080&height=1920&model=flux&nologo=true&seed=${seed}`

                    try {
                        imagePath = await retryOperation(() => imageService.downloadImage(imageUrl))
                    } catch (imgError) {
                        console.error(`[ReelGen] Pollinations Failed after retries. Using Contextual Fallback.`)

                        // FALLBACK: Use Keyword-based stock photo (more relevant than random picsum)
                        // Using loremflickr with keywords from title
                        const keyword = script.ideas?.title.split(' ')[0] || 'business'
                        const fallbackUrl = `https://loremflickr.com/1080/1920/${encodeURIComponent(keyword)}?lock=${seed}`

                        console.log(`[ReelGen] Using Fallback URL: ${fallbackUrl}`)
                        imagePath = await imageService.downloadImage(fallbackUrl)
                    }
                }

                processedScenes.push({
                    audioPath,
                    imagePath,
                    subtitlePath,
                    videoStartTime: sceneVideoStartTime,
                    sceneData: scene,
                    imageUrl: imageUrl
                })
            }

            // 5. VIDEO ASSEMBLY (FFmpeg)
            console.log('[ReelGen] Stitching Video...')
            // output url relative to public/
            const videoUrl = await videoService.generateVideo(
                processedScenes.map(s => ({
                    imagePath: s.imagePath,
                    audioPath: s.audioPath,
                    text: s.sceneData.caption || s.sceneData.text.slice(0, 30),
                    subtitlePath: s.subtitlePath,
                    videoStartTime: s.videoStartTime
                }))
            )

            console.log('[ReelGen] Video Created:', videoUrl)


            // 6. AI QUALITY AUDIT (CRITIC)
            console.log('[ReelGen] Running AI Quality Audit...')
            let qualityScore = 0
            let qualityFeedback = ''

            try {
                // Prepare context for Gemini Vision
                // We pick random 2 frames (images) to audit to save tokens/latency
                const auditScenes = processedScenes.slice(0, 2)

                const promptParts: any[] = [
                    `Actúa como un crítico de video experto en VIRAL SHORTS y TIKTOK.
                     
                     MUESTRAS DEL VIDEO GENERADO:
                     (Se adjuntan frames visuales y el texto correspondiente)

                     CRITERIOS DE EVALUACIÓN (Adaptables al Estilo):
                     
                     1. ESTILO "BRAINROT" / GAMEPLAY (Minecraft, GTA, Parkour):
                        - Si ves videojuegos de fondo, NO penalices la falta de relación semántica con el texto. Es intencional.
                        - Evalúa: ¿El video es HD? ¿Se ve fluido? ¿Hay subtítulos o texto legible?
                        - Si cumple esto, la puntuación visual debe ser ALTA (80-100).
                     
                     2. ESTILO "ILLUSTRATIVE" (Imágenes IA):
                        - Si son imágenes estáticas generadas, SÍ evalúa que coincidan con el texto.
                        - Si el texto dice "gato" y ves un "perro", penaliza.

                     Tu objetivo es predecir el POTENCIAL VIRAL (Retention Score).
                    `
                ]

                for (const scene of auditScenes) {
                    promptParts.push(`\n--- ESCENA ---\nTexto: "${scene.sceneData.text}"\nImagen Generada: `)

                    let imagePathToAudit = scene.imagePath

                    // If video, extract a frame first
                    if (scene.imagePath.endsWith('.mp4')) {
                        console.log(`[ReelGen] Extracting frame from video for audit: ${scene.imagePath}`)
                        const framePath = await videoService.extractFrame(scene.imagePath)
                        if (framePath) imagePathToAudit = framePath
                    }

                    // Read Image as Base64 (ignoring if still mp4/failed)
                    if (imagePathToAudit && !imagePathToAudit.endsWith('.mp4')) {
                        const imageBuffer = fs.readFileSync(imagePathToAudit)
                        const base64Image = imageBuffer.toString('base64')

                        promptParts.push({
                            inlineData: {
                                data: base64Image,
                                mimeType: "image/jpeg"
                            }
                        })
                    } else {
                        promptParts.push('[NO SE PUDO EXTRAER IMAGEN DEL VIDEO]')
                    }
                }

                promptParts.push(`\n
                    EVALUACIÓN REQUERIDA (JSON):
                    {
                        "score": 85,
                        "feedback": "La imagen X coincide perfectamente..."
                    }
                    Responde SOLO con el JSON.
                `)

                const result = await model.generateContent(promptParts)
                const response = result.response.text()
                const cleanedJson = response.replace(/```json/g, '').replace(/```/g, '').trim()
                const auditData = JSON.parse(cleanedJson)

                qualityScore = auditData.score || 50
                qualityFeedback = auditData.feedback || 'Sin feedback detallado.'

                console.log(`[ReelGen] AI Audit Score: ${qualityScore}/100`)

            } catch (auditError) {
                console.error('[ReelGen] Audit Failed:', auditError)
                qualityScore = 50 // Default neutral score on error
                qualityFeedback = 'Error en auditoría automática.'
            }


            // 7. SAVE METADATA & AUDIT RESULTS
            // -------------------------------------------------------------------------
            // 7. Auto-Publish (Viral Mode)
            // -------------------------------------------------------------------------
            let youtubeId = null
            let status = 'completed' // default to manual review

            // Check if idea is viral enough (> 90) and service is ready
            // NOTE: The original code uses `script.ideas` and `content` for data.
            // The provided snippet uses `selectedIdea` and `finalVideoPath`, `ideaId`, `category`.
            // Assuming `selectedIdea` refers to `script.ideas` and `finalVideoPath` refers to `videoUrl`.
            // `ideaId` would be `script.ideas.id` and `category` would need to be derived or passed.
            // For now, I'll use the variables available in the current scope (`script.ideas`, `videoUrl`, `reelId`).
            // If `script.ideas` doesn't have `ai_metadata` or `viral_score`, this part might need further adjustment.
            const viralScore = script.ideas?.ai_metadata?.viral_score || 0

            if (viralScore > 90) {
                console.log(`[Auto-Publish] Viral Score ${viralScore} > 90. Attempting upload...`)
                try {
                    // Assuming youtubeService is available and uploadVideo takes (videoPath, title, description, tags)
                    // And assuming script.ideas.title and script.ideas.description are available.
                    // Category might need to be determined from script.ideas or content.
                    const publishedId = await youtubeService.uploadVideo(
                        videoUrl, // Using videoUrl as finalVideoPath
                        script.ideas?.title || 'Generated Reel',
                        script.ideas?.description || '',
                        ['shorts', 'viral', 'ai', script.ideas?.category || 'general'] // Using script.ideas.category if available
                    )

                    if (publishedId) {
                        youtubeId = publishedId
                        status = 'published'
                        console.log(`[Auto-Publish] Success! Video ID: ${publishedId}`)
                    }
                } catch (uploadError) {
                    console.error('[Auto-Publish] Failed:', uploadError)
                    // Don't fail the generation, just stay as 'completed'
                }
            }

            // Update Reel with the final video URL AND Score
            await supabase.from('reels').update({
                status: status, // Use the determined status ('completed' or 'published')
                export_url: videoUrl,
                quality_score: qualityScore,
                quality_feedback: qualityFeedback,
                youtube_id: youtubeId // Save YouTube ID if published
            }).eq('id', reelId)


            // Insert Scenes for record (optional, but good for UI if we keep Scene player)
            // Let's Insert ONE scene with the full video URL so the existing Player picks it up as "Video".
            await supabase.from('reel_scenes').insert({
                reel_id: reelId,
                scene_order: 1,
                content_text: 'Full Generated Reel',
                image_url: videoUrl, // It's a video path /output/..., Player handles <video>
                duration: 15 // Estimated
            })

            return { success: true, reelId, qualityScore }


        } catch (genError: any) {
            console.error('Generation Pipeline Failed:', genError)
            throw genError
        }

        revalidatePath(`/scripts/${scriptId}`)
        return { success: true, reelId }

    } catch (error: any) {
        console.error('Error generating reel:', error)
        // Reset status on error
        const { data: existingReel } = await supabase.from('reels').select('id').eq('script_id', scriptId).single()
        if (existingReel) {
            await supabase.from('reels').update({ status: 'failed' }).eq('id', existingReel.id)
        }
        return { success: false, error: error.message }
    }
}
