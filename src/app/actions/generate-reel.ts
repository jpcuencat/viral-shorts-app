'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { videoService } from '@/services/video-service'
import { imageService, VisualGenerationMode } from '@/services/image-service'
import { audioService } from '@/services/audio-service'
import { model, generateJson } from '@/lib/ai/gemini'
import { SceneVisualPlanListSchema, QualityAuditSchema, type QualityAudit } from '@/lib/ai/schemas'
import { subtitleService } from '@/services/subtitle-service'
import fs from 'fs'
import path from 'path'

export interface GenerateReelOptions {
    visualMode?: VisualGenerationMode
    customVideoSource?: string
    voiceId?: string
}

export interface SceneManifestEntry {
    sceneIndex: number
    text: string
    caption: string
    audioPath: string
    imagePath: string
    publicMediaUrl: string
    subtitlePath: string
    videoStartTime: number
    duration: number
    subjectKey: string
    sceneTags: string[]
    hfPrompt: string
    ytSearchQuery: string
    sourceLabel: string
    /** La escena muestra a una persona real identificable (nunca se le genera cara con IA). */
    realPerson?: boolean
    /** Prompt IA alternativo sin personas identificables para esa escena. */
    personFreePrompt?: string
}

const MAX_AUDIT_FRAMES = 8

interface AuditScene {
    text: string
    sourceLabel: string
    duration: number
}

/**
 * Auditoría visual con Gemini sobre frames reales del video final.
 * Muestrea TODAS las escenas (hasta MAX_AUDIT_FRAMES, repartidas uniformemente).
 * Devuelve null si la auditoría no pudo ejecutarse: nunca inventa una puntuación.
 */
async function auditReelQuality(
    videoUrl: string,
    scenes: AuditScene[],
    ideaTitle: string
): Promise<QualityAudit | null> {
    if (scenes.length === 0) return null
    const finalVideoDiskPath = path.join(process.cwd(), 'public', videoUrl.replace(/^\//, ''))

    // Inicio de cada escena en la línea de tiempo del video final
    const starts: number[] = []
    let acc = 0
    for (const sc of scenes) {
        starts.push(acc)
        acc += sc.duration || 4
    }

    const step = Math.max(1, Math.ceil(scenes.length / MAX_AUDIT_FRAMES))
    const sampled = scenes.map((_, i) => i).filter(i => i % step === 0)

    const promptParts: any[] = [
        `Actúa como un Director de Arte y Crítico Experto en YouTube Shorts / TikTok (Canal: Radar 593).
Se adjuntan frames extraídos del video final vertical 9:16 (1080x1920), con subtítulos tipo karaoke incrustados.
El video tiene ${scenes.length} escenas; se muestran ${sampled.length}.

CRITERIOS (0 a 100 puntos, sé estricto y honesto; NO infles la nota):
1. FORMATO Y COMPOSICIÓN (30 pts): nitidez, encuadre vertical, sin bandas negras ni deformaciones.
2. SUBTÍTULOS Y LEGIBILIDAD (35 pts): legibles, bien contrastados, sin tapar el sujeto.
3. COHERENCIA VISUAL CON EL TEMA "${ideaTitle}" (35 pts): el visual corresponde a la narración de esa escena; penaliza imágenes genéricas, anatomía distorsionada, texto ilegible o protagonistas equivocados.

En "weakestSceneIndex" pon el ÍNDICE ORIGINAL de escena (el número indicado en cada frame) peor evaluado, y en "improvedVisualPrompt" un prompt en inglés para regenerarla.`
    ]

    for (const idx of sampled) {
        const scene = scenes[idx]
        const t = starts[idx] + Math.min(1.5, (scene.duration || 3) * 0.45)
        promptParts.push(`\n--- ESCENA índice ${idx} (t=${t.toFixed(1)}s) ---\nNarración: "${scene.text}"\nFuente visual: "${scene.sourceLabel}"\nFrame:`)
        const framePath = await videoService.extractFrame(finalVideoDiskPath, t)
        if (framePath && fs.existsSync(framePath)) {
            promptParts.push({ inlineData: { data: fs.readFileSync(framePath).toString('base64'), mimeType: 'image/jpeg' } })
            try { fs.unlinkSync(framePath) } catch { }
        } else {
            promptParts.push('[No se pudo extraer el frame de esta escena]')
        }
    }

    promptParts.push(`\nResponde SOLO con JSON: {"score": <0-100>, "weakestSceneIndex": <int>, "improvedVisualPrompt": "<english prompt>", "feedback": "<2-3 frases en español>"}`)

    try {
        const audit = await generateJson(promptParts, QualityAuditSchema, { label: 'QualityAudit' })
        audit.weakestSceneIndex = Math.min(Math.max(0, audit.weakestSceneIndex), scenes.length - 1)
        audit.score = Math.round(audit.score)
        return audit
    } catch (err) {
        console.error('[QualityAudit] No se pudo auditar el reel:', err)
        return null
    }
}

const QUALITY_HEAL_THRESHOLD = 80

export async function generateReel(scriptId: string, options: GenerateReelOptions = {}) {
    const {
        visualMode = 'ai_images',
        customVideoSource = '',
        voiceId = 'es-EC-LuisNeural'
    } = options
    const supabase = await createClient()

    try {
        // 1. Fetch Script with Idea & Category
        const { data: script, error: fetchError } = await supabase
            .from('scripts')
            .select('*, ideas(title, description, categories(name))')
            .eq('id', scriptId)
            .single()

        if (fetchError || !script) throw new Error('Script not found')

        // 2. Parse Content
        let content: any = script.content
        if (typeof content === 'string') content = JSON.parse(content)

        // 3. Create/Reset Reel Record (handle duplicates safely so UI always updates the active reel)
        const { data: existingReels } = await supabase
            .from('reels')
            .select('id, created_at')
            .eq('script_id', scriptId)
            .order('created_at', { ascending: false })

        let reelId = existingReels?.[0]?.id

        // If duplicate reel rows existed from previous runs, clean up older ones
        if (existingReels && existingReels.length > 1) {
            const duplicateIds = existingReels.slice(1).map(r => r.id)
            await supabase.from('reel_scenes').delete().in('reel_id', duplicateIds)
            await supabase.from('reels').delete().in('id', duplicateIds)
        }

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

            const ideaTitle = script.ideas?.title || ''
            const ideaDesc = script.ideas?.description || ''
            const ideaCategory = (script.ideas?.categories?.name || '').toLowerCase()
            const ideaContext = `${ideaTitle}, ${ideaDesc}`.slice(0, 120)

            // Helper: Split overly long sentences (> 18 words) at natural clause boundaries so visuals change every 3.5-5 seconds
            const splitIntoVisualBeats = (rawText: string): string[] => {
                const words = rawText.trim().split(/\s+/)
                if (words.length <= 18) return [rawText.trim()]

                const clauses = rawText.split(/(?<=[,;:])\s+|\s+(?=mientras\b|pero\b|aunque\b|olvidando\b|donde\b|porque\b)/i)
                const beats: string[] = []
                let current = ''

                for (const clause of clauses) {
                    const candidate = current ? `${current} ${clause.trim()}` : clause.trim()
                    if (candidate.split(/\s+/).length > 16 && current.split(/\s+/).length >= 6) {
                        beats.push(current.trim())
                        current = clause.trim()
                    } else {
                        current = candidate
                    }
                }
                if (current.trim()) {
                    if (beats.length > 0 && current.trim().split(/\s+/).length < 5) {
                        beats[beats.length - 1] += ` ${current.trim()}`
                    } else {
                        beats.push(current.trim())
                    }
                }
                return beats.length > 0 ? beats : [rawText.trim()]
            }

            // Define Scenes to generate
            const scenesData: { text: string; visual: string; caption: string }[] = []

            // 1. HOOK
            const hookBeats = splitIntoVisualBeats(content.hook_audio || content.hook || `${ideaTitle}`)
            hookBeats.forEach((beat, idx) => {
                scenesData.push({
                    text: beat,
                    visual: idx === 0 && content.hook_visual ? content.hook_visual : `Action shot of ${ideaTitle}: ${beat}`,
                    caption: content.hook_caption || beat.split(' ').slice(0, 3).join(' ')
                })
            })

            // 2. BODY (Iterate all paragraphs and split long sentences into 4s visual beats)
            const scriptSceneVisuals: string[] = Array.isArray(content.scene_visuals) ? content.scene_visuals : []
            let bodyVisualIdx = 0

            if (content.body_paragraphs && Array.isArray(content.body_paragraphs)) {
                content.body_paragraphs.forEach((para: string) => {
                    const sentences = para.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [para]

                    sentences.forEach((sentence) => {
                        const cleanSentence = sentence.trim()
                        if (cleanSentence.length > 5) {
                            const beats = splitIntoVisualBeats(cleanSentence)
                            beats.forEach((beat) => {
                                const preplannedVisual = scriptSceneVisuals[bodyVisualIdx] || ''
                                bodyVisualIdx++
                                scenesData.push({
                                    text: beat,
                                    visual: preplannedVisual || `Action scene for "${beat}" featuring ${ideaTitle}`,
                                    caption: beat.split(' ').slice(0, 3).join(' ')
                                })
                            })
                        }
                    })
                })
            } else {
                scenesData.push({
                    text: ideaDesc || ideaTitle,
                    visual: `Action visual about ${ideaTitle}`,
                    caption: ideaTitle
                })
            }

            // 3. CTA
            scenesData.push({
                text: content.cta || 'Sígueme para más contenido',
                visual: content.cta_visual || `Epic final shot of ${ideaTitle}`,
                caption: content.cta_caption || 'Sígueme para más'
            })

            // Helper for Retry Logic
            const retryOperation = async (fn: () => Promise<string>, retries = 2, delay = 2000): Promise<string> => {
                try {
                    return await fn()
                } catch (error) {
                    if (retries <= 0) throw error
                    console.log(`[ReelGen] Retrying operation... attempts left: ${retries}`)
                    await new Promise(resolve => setTimeout(resolve, delay))
                    return retryOperation(fn, retries - 1, delay)
                }
            }

            // 4.1 100% AI STORYBOARD DIRECTOR + SMART AI VAULT (public/ai-vault)
            // Generic local background videos (public/backgrounds) are completely disabled so they never distort the story.
            // Every generated image is indexed and saved in public/ai-vault/ to be reused automatically when a future video shares the same subject & scene tags!
            interface SceneVisualPlan {
                subject_key: string
                scene_tags: string[]
                yt_search_query: string
                hf_prompt: string
                shows_real_person?: boolean
                person_free_prompt?: string
            }
            let visualPlans: SceneVisualPlan[] = []
            const defaultSubjectKey = (content.protagonist_en || ideaTitle).slice(0, 35)

            try {
                const protagonistHint = content.protagonist_en || ideaTitle
                const plannerPrompt = `You are a Master Storyboard Director for a viral Short.
TOPIC TITLE: "${ideaTitle}"
TOPIC DESCRIPTION: "${ideaDesc}"
PROTAGONIST / MAIN SUBJECT: "${protagonistHint}"
CATEGORY: "${ideaCategory}"

CRITICAL STORYBOARD RULES (READ CAREFULLY):
1. PROTAGONIST & SUBJECT CONTINUITY: Every single "hf_prompt" and "yt_search_query" MUST explicitly name and show the MAIN SUBJECT / PROTAGONIST in action!
   - STRICTLY FORBIDDEN: NEVER generate symbolic/metaphorical objects that break the story!
2. ANATOMICALLY-SAFE FRAMING FOR ALL TOPICS (NO DISTORTED BODIES OR HANDS):
   - Every "hf_prompt" MUST use clean waist-up medium portraits, over-the-shoulder broadcast angles, clear environmental/architectural views, or composed single-subject editorial shots.
   - NEVER ask for tangled multi-body collisions, mid-air acrobatics, macro close-ups of hands/fingers/feet, or readable text on screens (as diffusion models distort those).
3. SMART VAULT INDEXING:
   - "subject_key": A short, consistent 1-3 word English identifier for the main subject of this video (e.g. "cne_ecuador", "lionel_messi", "openai_chatgpt", "quito_ecuador"). Use the SAME "subject_key" across all scenes of this video so our AI Vault groups them under this topic.
   - "scene_tags": Array of 4 specific English keywords describing the exact pose/action/setting of THIS scene.
   - "yt_search_query": A specific 4-6 word English YouTube search query to find real motion footage of this exact scene. Prefer queries that return news/broadcast footage of the real event or place.
4. REAL PEOPLE RULE (MANDATORY, overrides rule 1 for those scenes):
   - "shows_real_person": true when the scene's visual would show a specific REAL, identifiable person (a public figure, athlete, politician, a local priest, a victim, any named real individual). false for generic/anonymous people, places, objects or fictional subjects.
   - Image generators cannot reproduce real people: they invent a different face. So for EVERY scene with shows_real_person=true, also write "person_free_prompt": an English Stable Diffusion prompt for the SAME moment WITHOUT any identifiable person — the real location (exterior/interior of the actual place), objects tied to the story (altar, candles, microphone, ballot box, stadium, jersey on a hanger), or people only from behind / far away / out of focus. Documentary photo style, natural light, no faces, no text.
   - Never use abstract metaphors in person_free_prompt; it must be concretely tied to the narration.

For each of the ${scenesData.length} scenes below, output a JSON array of ${scenesData.length} objects:
- "subject_key": string (consistent main subject slug).
- "scene_tags": array of 4 specific English action/setting tags.
- "yt_search_query": specific English YouTube search query for real motion video.
- "hf_prompt": Clean, anatomically-safe English prompt for Stable Diffusion 3 (vertical 9:16, waist-up medium shot or editorial angle, photorealistic, cinematic lighting, no text, no tangled limbs) showing the MAIN PROTAGONIST or subject of that line.
- "shows_real_person": boolean (see rule 4).
- "person_free_prompt": string, required when shows_real_person is true (see rule 4).

SCENES:
${scenesData.map((s, idx) => `${idx + 1}. Narration: "${s.text}" | Visual hint: "${s.visual}"`).join('\n')}

Respond ONLY with a valid JSON array.`
                const parsedPlans = await generateJson(plannerPrompt, SceneVisualPlanListSchema, { label: 'StoryboardPlanner' })
                if (parsedPlans.length === scenesData.length) {
                    visualPlans = parsedPlans
                    console.log(`[ReelGen] AI Storyboard Director planned ${visualPlans.length} scenes (mode: ${visualMode}).`)
                }
            } catch (planErr: any) {
                console.warn(`[ReelGen] Visual planner fallback (${planErr.message})`)
            }

            const usedVaultFiles = new Set<string>()
            interface ProcessedScene {
                audioPath: string
                imagePath: string
                publicMediaUrl: string
                subtitlePath: string
                videoStartTime: number
                duration: number
                sceneData: { text: string; visual: string; caption: string }
                imageUrl: string
                subjectKey: string
                sceneTags: string[]
                hfPrompt: string
                ytSearchQuery: string
                category: string
                realPerson: boolean
                personFreePrompt?: string
                sourceKind: string
            }
            const processedScenes: ProcessedScene[] = []

            for (let i = 0; i < scenesData.length; i++) {
                const scene = scenesData[i]
                const plan = visualPlans[i] || {
                    subject_key: defaultSubjectKey,
                    scene_tags: [ideaCategory || 'viral', `scene_${i + 1}`],
                    yt_search_query: `${content.protagonist_en || ideaTitle} ${scene.visual}`.slice(0, 60),
                    hf_prompt: `Vertical 9:16 photorealistic action shot of ${content.protagonist_en || ideaTitle}: ${scene.visual}, dramatic lighting, 8k, no text`
                }

                // A. Generate Audio + WordBoundary Timestamps (with selected voiceId, e.g. es-EC-LuisNeural)
                console.log(`[ReelGen] Generating Audio (${voiceId}) & Word Cues for scene ${i + 1}/${scenesData.length}...`)
                const { audioPath, wordCues } = await audioService.generateAudioWithSubtitles(scene.text, 'es', voiceId)

                // A.1 Generate ASS Karaoke Subtitles (Dynamic active-word highlight, zero overlap)
                const duration = await videoService.getAudioDuration(audioPath)
                const subtitlePath = await subtitleService.generateSRT(scene.text, duration, wordCues)

                // B. SMART AI & VIDEO VAULT: Supports 'hybrid', 'real_video' (YouTube B-Roll / Custom Video), and 'ai_images' (HuggingFace SD3)
                const enhancedPrompt = `${plan.hf_prompt}, vertical 9:16 aspect ratio, ultra-detailed action photography, cinematic lighting, photorealistic 8k, high contrast, no text, no letters, no watermark`

                const vaultResult = await imageService.generateOrGetFromVault({
                    prompt: enhancedPrompt,
                    videoSearchQuery: plan.yt_search_query,
                    visualMode,
                    customVideoSource: customVideoSource.trim() || undefined,
                    sceneIndex: i,
                    durationSec: duration,
                    category: ideaCategory || 'general',
                    subjectKey: plan.subject_key || defaultSubjectKey,
                    sceneTags: plan.scene_tags || [],
                    usedFiles: usedVaultFiles,
                    realPerson: Boolean(plan.shows_real_person),
                    personFreePrompt: plan.person_free_prompt
                })
                console.log(`[ReelGen] Escena ${i + 1}: ${vaultResult.kind}${plan.shows_real_person ? ' (persona real)' : ''} -> ${vaultResult.sourceLabel}`)

                const imagePath = vaultResult.imagePath
                const imageUrl = vaultResult.sourceLabel
                const sceneVideoStartTime = vaultResult.videoStartTime || 0

                const publicDir = path.join(process.cwd(), 'public')
                const relMedia = imagePath.startsWith(publicDir)
                    ? '/' + path.relative(publicDir, imagePath).replace(/\\/g, '/')
                    : imageUrl

                processedScenes.push({
                    audioPath,
                    imagePath,
                    publicMediaUrl: relMedia,
                    subtitlePath,
                    videoStartTime: sceneVideoStartTime,
                    duration,
                    sceneData: scene,
                    imageUrl: imageUrl,
                    subjectKey: plan.subject_key || defaultSubjectKey,
                    sceneTags: plan.scene_tags || [],
                    hfPrompt: plan.hf_prompt,
                    ytSearchQuery: plan.yt_search_query,
                    category: ideaCategory || 'general',
                    realPerson: Boolean(plan.shows_real_person),
                    personFreePrompt: plan.person_free_prompt,
                    sourceKind: vaultResult.kind
                })
            }

            // 5. VIDEO ASSEMBLY (FFmpeg)
            console.log('[ReelGen] Stitching Video...')
            let videoUrl = await videoService.generateVideo(
                processedScenes.map(s => ({
                    imagePath: s.imagePath,
                    audioPath: s.audioPath,
                    text: s.sceneData.caption || s.sceneData.text.slice(0, 30),
                    subtitlePath: s.subtitlePath,
                    videoStartTime: s.videoStartTime,
                    duration: s.duration
                })),
                { reelId }
            )

            console.log('[ReelGen] Video Created:', videoUrl)

            const writeSceneManifest = () => {
                try {
                    const outputDir = path.join(process.cwd(), 'public', 'output')
                    fs.mkdirSync(outputDir, { recursive: true })
                    const manifestPath = path.join(process.cwd(), 'public', 'output', `manifest_${reelId}.json`)
                    const manifestEntries: SceneManifestEntry[] = processedScenes.map((s, idx) => ({
                        sceneIndex: idx,
                        text: s.sceneData.text,
                        caption: s.sceneData.caption,
                        audioPath: s.audioPath,
                        imagePath: s.imagePath,
                        publicMediaUrl: s.publicMediaUrl,
                        subtitlePath: s.subtitlePath,
                        videoStartTime: s.videoStartTime,
                        duration: s.duration,
                        subjectKey: s.subjectKey,
                        sceneTags: s.sceneTags,
                        hfPrompt: s.hfPrompt,
                        ytSearchQuery: s.ytSearchQuery,
                        sourceLabel: s.imageUrl,
                        realPerson: s.realPerson,
                        personFreePrompt: s.personFreePrompt
                    }))
                    fs.writeFileSync(manifestPath, JSON.stringify(manifestEntries, null, 2), 'utf-8')
                } catch (manifestErr) {
                    console.warn('[ReelGen] Could not write scene manifest:', manifestErr)
                }
            }
            writeSceneManifest()

            // 6. AUDITORÍA DE CALIDAD (honesta) + AUTO-CORRECCIÓN DE LA ESCENA MÁS DÉBIL
            const toAuditScenes = (): AuditScene[] => processedScenes.map(s => ({
                text: s.sceneData.text,
                sourceLabel: s.imageUrl,
                duration: s.duration
            }))

            let qualityScore: number | null = null
            let qualityFeedback: string | null = null

            const firstAudit = await auditReelQuality(videoUrl, toAuditScenes(), ideaTitle)
            if (firstAudit) {
                qualityScore = firstAudit.score
                qualityFeedback = firstAudit.feedback
                console.log(`[ReelGen] Auditoría inicial: ${qualityScore}/100`)

                if (qualityScore < QUALITY_HEAL_THRESHOLD && processedScenes.length > 0) {
                    const weakIdx = firstAudit.weakestSceneIndex
                    const targetScene = processedScenes[weakIdx]
                    const healedPrompt =
                        firstAudit.improvedVisualPrompt ||
                        `Vertical 9:16 photorealistic editorial shot of ${content.protagonist_en || ideaTitle}: ${targetScene.sceneData.text}, dramatic studio lighting, no text`

                    console.log(`[ReelGen] ${qualityScore} < ${QUALITY_HEAL_THRESHOLD}: regenerando escena ${weakIdx + 1}...`)
                    try {
                        // Regla de personas reales: si la escena muestra a una persona real, se busca otro clip real
                        // (o, si no hay, una imagen IA sin personas); nunca una cara inventada.
                        const healMode: VisualGenerationMode =
                            targetScene.realPerson && visualMode !== 'ai_images' ? 'real_video' : 'ai_images'
                        const healedVault = await imageService.generateOrGetFromVault({
                            prompt: `${healedPrompt}, vertical 9:16 aspect ratio, ultra-detailed editorial photography, cinematic lighting, photorealistic, high contrast, no text`,
                            videoSearchQuery: targetScene.ytSearchQuery,
                            visualMode: healMode,
                            sceneIndex: weakIdx + 10,
                            durationSec: targetScene.duration,
                            category: targetScene.category,
                            subjectKey: targetScene.subjectKey,
                            sceneTags: targetScene.realPerson
                                ? targetScene.sceneTags
                                : [`healed_${Date.now().toString().slice(-4)}`],
                            usedFiles: usedVaultFiles,
                            realPerson: targetScene.realPerson,
                            personFreePrompt: targetScene.personFreePrompt
                        })

                        const publicDir = path.join(process.cwd(), 'public')
                        processedScenes[weakIdx] = {
                            ...targetScene,
                            imagePath: healedVault.imagePath,
                            publicMediaUrl: healedVault.imagePath.startsWith(publicDir)
                                ? '/' + path.relative(publicDir, healedVault.imagePath).replace(/\\/g, '/')
                                : healedVault.sourceLabel,
                            imageUrl: healedVault.sourceLabel,
                            hfPrompt: healedPrompt,
                            videoStartTime: healedVault.videoStartTime || 0,
                            sourceKind: healedVault.kind
                        }

                        videoUrl = await videoService.generateVideo(
                            processedScenes.map(s => ({
                                imagePath: s.imagePath,
                                audioPath: s.audioPath,
                                text: s.sceneData.caption || s.sceneData.text.slice(0, 30),
                                subtitlePath: s.subtitlePath,
                                videoStartTime: s.videoStartTime,
                                duration: s.duration
                            })),
                            { reelId, onlySceneIndex: weakIdx }
                        )
                        writeSceneManifest()

                        const reAudit = await auditReelQuality(videoUrl, toAuditScenes(), ideaTitle)
                        if (reAudit) {
                            qualityFeedback = `${reAudit.feedback} (Escena ${weakIdx + 1} regenerada automáticamente; nota previa ${qualityScore}/100.)`
                            qualityScore = reAudit.score
                        } else {
                            qualityFeedback = `${qualityFeedback} (Escena ${weakIdx + 1} regenerada; la re-auditoría falló, se conserva la nota previa.)`
                        }
                    } catch (healErr) {
                        console.warn('[ReelGen] No se pudo auto-corregir la escena:', healErr)
                    }
                }
                console.log(`[ReelGen] Nota final de auditoría: ${qualityScore}/100`)
            } else {
                qualityFeedback = 'Auditoría IA no disponible para este reel (sin puntuación).'
            }

            // 7. SAVE METADATA & AUDIT RESULTS (Publishing is now explicitly controlled via the Social Publisher Modal / Auto-Publish settings)
            await supabase.from('reels').update({
                status: 'completed',
                export_url: videoUrl,
                quality_score: qualityScore,
                quality_feedback: qualityFeedback
            }).eq('id', reelId)

            await supabase.from('reel_scenes').insert({
                reel_id: reelId,
                scene_order: 1,
                content_text: 'Full Generated Reel',
                image_url: videoUrl,
                duration: Number(processedScenes.reduce((sum, sc) => sum + (sc.duration || 0), 0).toFixed(2))
            })

            revalidatePath(`/scripts/${scriptId}`)
            return { success: true, reelId, qualityScore, videoUrl }

        } catch (genError: any) {
            console.error('Generation Pipeline Failed:', genError)
            throw genError
        }

    } catch (error: any) {
        console.error('Error generating reel:', error)
        const { data: existingReel } = await supabase.from('reels').select('id').eq('script_id', scriptId).single()
        if (existingReel) {
            await supabase.from('reels').update({ status: 'failed' }).eq('id', existingReel.id)
        }
        return { success: false, error: error.message }
    }
}

/**
 * Returns the saved scene breakdown manifest for a generated Reel so the user can inspect or replace individual scenes.
 */
export async function getReelSceneManifest(reelId: string): Promise<SceneManifestEntry[]> {
    try {
        const manifestPath = path.join(process.cwd(), 'public', 'output', `manifest_${reelId}.json`)
        if (!fs.existsSync(manifestPath)) return []
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch {
        return []
    }
}

/**
 * Replaces a SINGLE scene's visual (with either a new AI image or a real motion clip) and re-stitches the Reel in seconds!
 */
export async function replaceSingleReelScene(
    reelId: string,
    scriptId: string,
    sceneIndex: number,
    options: {
        visualMode: 'ai_images' | 'real_video'
        customPromptOrQuery?: string
        /** URL opcional de un video limpio (YouTube u otra web) para usar directamente en esta escena. */
        customVideoUrl?: string
        /** Segundo del video desde el que se toma el tramo (opcional, por defecto 0). */
        customStartSec?: number
    }
): Promise<{ success: boolean; videoUrl?: string; error?: string }> {
    const supabase = await createClient()
    const manifestPath = path.join(process.cwd(), 'public', 'output', `manifest_${reelId}.json`)

    if (!fs.existsSync(manifestPath)) {
        return {
            success: false,
            error: 'Este Reel fue creado antes de activar el editor de escenas. Regenera el Reel una vez para habilitar la edición por escena.'
        }
    }

    try {
        const manifest: SceneManifestEntry[] = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
        const target = manifest[sceneIndex]
        if (!target) {
            return { success: false, error: 'Escena no encontrada.' }
        }

        const cleanSubjectName = (target.subjectKey || 'protagonist').replace(/_/g, ' ')
        const customText = options.customPromptOrQuery?.trim()
        const customVideoUrl = options.customVideoUrl?.trim()

        // Never reuse the old distorted prompt when replacing a scene:
        // build a clean, anatomically-safe editorial/broadcast shot matching any topic or protagonist!
        let freshEnglishPrompt = customText
            ? `${customText}, featuring ${cleanSubjectName}, waist-up medium editorial shot or clean wide establishing frame, natural anatomy, vertical 9:16 aspect ratio, ultra-detailed editorial photography, dramatic broadcast lighting, photorealistic 8k, no text`
            : `Waist-up medium editorial broadcast shot of ${cleanSubjectName}, expressive posture and authentic setting matching "${target.text}", vertical 9:16 aspect ratio, ultra-detailed photography, dramatic cinematic lighting, photorealistic 8k, no text, no deformed limbs`

        // Con URL de video no hace falta generar prompt de imagen
        if (!customVideoUrl) try {
            const instructionContext = customText
                ? `User instruction: "${customText}". Scene narration: "${target.text}".`
                : `Scene narration: "${target.text}".`
            const translateRes = await model.generateContent(
                `Create a clean, anatomically-safe English photography prompt (waist-up medium shot, close-up portrait, or clean wide architectural/scenic shot — NEVER tangled limbs, extra legs, or chaotic multi-person collisions) for a vertical 9:16 video scene featuring subject "${cleanSubjectName}". ${instructionContext} Respond ONLY with the single English prompt sentence.`
            )
            const translated = translateRes.response.text().trim().replace(/^"|"$/g, '')
            if (translated.length > 10) {
                freshEnglishPrompt = `${translated}, vertical 9:16 aspect ratio, photorealistic 8k editorial photography, natural anatomy, no text`
            }
        } catch {}

        const prompt = freshEnglishPrompt
        const videoQuery = customText || target.ytSearchQuery

        // Exclude all currently used files in the manifest so it forces a brand new visual!
        const usedFiles = new Set<string>(manifest.map(m => path.basename(m.imagePath)))

        const vaultResult = customVideoUrl
            ? await imageService.fetchUserVideoClip({
                url: customVideoUrl,
                startSec: options.customStartSec,
                durationSec: target.duration,
                category: 'general',
                subjectKey: target.subjectKey,
                sceneTags: target.sceneTags || []
            })
            : await imageService.generateOrGetFromVault({
                prompt,
                videoSearchQuery: videoQuery,
                visualMode: options.visualMode,
                sceneIndex: sceneIndex + Math.floor(Math.random() * 5) + 1,
                durationSec: target.duration,
                category: 'general',
                subjectKey: target.subjectKey,
                sceneTags: [`replaced_${Date.now()}_${Math.floor(Math.random() * 999)}`],
                usedFiles,
                realPerson: target.realPerson,
                personFreePrompt: customText || target.personFreePrompt
            })

        const publicDir = path.join(process.cwd(), 'public')
        const relMedia = vaultResult.imagePath.startsWith(publicDir)
            ? '/' + path.relative(publicDir, vaultResult.imagePath).replace(/\\/g, '/')
            : vaultResult.sourceLabel

        manifest[sceneIndex] = {
            ...target,
            imagePath: vaultResult.imagePath,
            publicMediaUrl: relMedia,
            videoStartTime: vaultResult.videoStartTime || 0,
            sourceLabel: vaultResult.sourceLabel,
            hfPrompt: customVideoUrl ? target.hfPrompt : freshEnglishPrompt,
            ytSearchQuery: customVideoUrl || videoQuery
        }

        // Re-stitch the video with FFmpeg: ONLY re-renders `sceneIndex` and keeps all other scenes untouched!
        const newVideoUrl = await videoService.generateVideo(
            manifest.map(s => ({
                imagePath: s.imagePath,
                audioPath: s.audioPath,
                text: s.caption || s.text.slice(0, 30),
                subtitlePath: s.subtitlePath,
                videoStartTime: s.videoStartTime,
                duration: s.duration
            })),
            { reelId, onlySceneIndex: sceneIndex }
        )

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')

        const { data: scriptRow } = await supabase
            .from('scripts')
            .select('ideas(title)')
            .eq('id', scriptId)
            .maybeSingle()
        const auditTitle = (scriptRow as any)?.ideas?.title || cleanSubjectName
        const audit = await auditReelQuality(
            newVideoUrl,
            manifest.map(m => ({ text: m.text, sourceLabel: m.sourceLabel, duration: m.duration })),
            auditTitle
        )

        await supabase
            .from('reels')
            .update({
                export_url: newVideoUrl,
                status: 'completed',
                quality_score: audit ? audit.score : null,
                quality_feedback: audit
                    ? `${audit.feedback} (Tras reemplazar la escena ${sceneIndex + 1}.)`
                    : `Escena ${sceneIndex + 1} reemplazada; auditoría IA no disponible (sin puntuación).`
            })
            .eq('id', reelId)

        await supabase
            .from('reel_scenes')
            .update({ image_url: newVideoUrl })
            .eq('reel_id', reelId)

        revalidatePath(`/scripts/${scriptId}`)
        return { success: true, videoUrl: newVideoUrl }
    } catch (err: any) {
        console.error('[ReplaceScene] Error:', err)
        return { success: false, error: err.message || 'No se pudo reemplazar la escena.' }
    }
}

