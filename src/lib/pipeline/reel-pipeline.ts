import type { SupabaseClient } from '@supabase/supabase-js'
import { videoService } from '@/services/video-service'
import { imageService, VisualGenerationMode, type VisualResult } from '@/services/image-service'
import { cardService } from '@/services/card-service'
import { audioService } from '@/services/audio-service'
import { generateJson } from '@/lib/ai/gemini'
import { StoryboardPlanSchema, QualityAuditSchema, type QualityAudit } from '@/lib/ai/schemas'
import { subtitleService } from '@/services/subtitle-service'
import { saveSceneManifest, type SceneManifestEntry } from '@/lib/scene-store'
import { FootageFinder } from '@/services/footage/footage-finder'
import { insightsPromptBlock } from '@/lib/learning/insights'
import { JobCancelledError, type ProgressReporter } from '@/lib/jobs/types'
import fs from 'fs'
import path from 'path'

export interface GenerateReelOptions {
    visualMode?: VisualGenerationMode
    customVideoSource?: string
    voiceId?: string
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
export async function auditReelQuality(
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
3. COHERENCIA VISUAL CON EL TEMA "${ideaTitle}" (35 pts): el visual corresponde a la narración de esa escena; penaliza imágenes genéricas, anatomía distorsionada, texto ilegible, elementos de otro país o protagonistas equivocados.

NOTA: las "tarjetas informativas" (fondo de marca con etiqueta, titular y dato en texto) son un recurso editorial INTENCIONAL
para noticias, como en los canales informativos profesionales: no las penalices por "no ser imagen"; evalúa su legibilidad,
jerarquía visual y coherencia con la narración. El metraje horizontal se muestra a propósito sobre su propio fondo desenfocado.

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

export interface ReelPipelineResult {
    success: boolean
    reelId?: string
    qualityScore?: number | null
    videoUrl?: string
    error?: string
}

/**
 * Genera un reel completo (voz, subtítulos, visuales, montaje, auditoría y auto-corrección).
 * Se ejecuta en el worker de trabajos, fuera de la petición HTTP, con un cliente de base de datos inyectado.
 */
export async function runReelPipeline(params: {
    db: SupabaseClient
    userId: string
    scriptId: string
    options?: GenerateReelOptions
    report?: ProgressReporter
}): Promise<ReelPipelineResult> {
    const { scriptId, userId } = params
    const options = params.options || {}
    const report: ProgressReporter = params.report || (async () => { })
    const {
        visualMode = 'ai_images',
        customVideoSource = '',
        voiceId = 'es-EC-LuisNeural'
    } = options
    const supabase = params.db

    try {
        // 1. Fetch Script with Idea & Category
        const { data: script, error: fetchError } = await supabase
            .from('scripts')
            .select('*, ideas(title, description, ai_metadata, categories(name))')
            .eq('id', scriptId)
            .single()

        if (fetchError || !script) throw new Error('Script not found')
        if (script.user_id && script.user_id !== userId) throw new Error('El guion no pertenece a este usuario')
        await report(4, 'Preparando guion')

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
                    user_id: script.user_id || userId
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

            await report(7, 'Planificando el storyboard')
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
                visual_strategy?: 'real_footage' | 'news_card' | 'ai_image'
                card_kicker?: string
                card_headline?: string
                card_detail?: string
            }
            const factCheck = (content.fact_check || null) as null | {
                verified?: boolean; domains?: string[]; location?: string; event_date?: string
            }
            let visualPlans: SceneVisualPlan[] = []
            let topicType: 'news_real_people' | 'news_event' | 'evergreen' =
                factCheck?.verified ? 'news_event' : 'evergreen'
            let locationLabel: string | undefined = factCheck?.location?.replace(/[.\s]+$/, '')
            const defaultSubjectKey = (content.protagonist_en || ideaTitle).slice(0, 35)

            try {
                const protagonistHint = content.protagonist_en || ideaTitle
                const visualLessons = await insightsPromptBlock(supabase, script.user_id || userId, 'visual')
                const plannerPrompt = `You are the visual director of a short-form NEWS & explainer channel for a Spanish-speaking audience.
TOPIC TITLE: "${ideaTitle}"
TOPIC DESCRIPTION: "${ideaDesc}"
MAIN SUBJECT: "${protagonistHint}"
CATEGORY: "${ideaCategory}"
${factCheck?.verified ? `VERIFIED FACTS AVAILABLE (sources: ${(factCheck.domains || []).join(', ')}). Card texts must only use facts stated in the narration below.` : ''}

${visualLessons}
STEP 1 — "topic_type":
- "news_real_people": a current news event centered on specific real, identifiable people (politicians, athletes, celebrities, victims, local figures).
- "news_event": a current news event about places, institutions, disasters, sports results, etc.
- "evergreen": explainers, curiosities, tech, how-to, history, fictional or generic subjects.

STEP 2 — "visual_strategy" for EACH scene:
- "real_footage": real filmed video of the actual event, place or person (news broadcasts). Use it for the most visual moments (the place, the operation, the crowd, the match).
- "news_card": a designed editorial text card (kicker + headline + one key fact). Use it for facts, accusations, legal details, numbers, context, reactions, open questions, and anything that cannot be shown truthfully with footage.
- "ai_image": AI illustration. ONLY allowed when topic_type is "evergreen" AND the scene does not show a real identifiable person. NEVER use ai_image for news topics: AI cannot depict real events, real places or real people truthfully.
For news topics aim for roughly half "real_footage" and half "news_card". The LAST scene (call to action) must be "news_card".

STEP 3 — fields for each scene:
- "yt_search_query": 3-7 words in the LANGUAGE OF THE LOCAL MEDIA COVERAGE (Spanish for Ecuador, Latin America or Spain; English for the US or UK). Describe what the CAMERA would film: real names and the real place plus the action ("operativo", "llegada", "incendio", "rueda de prensa", "imágenes"). You may add "noticia" or a local TV outlet (Ecuador: Ecuavisa, Teleamazonas, TC Televisión). Never include "en vivo", "live", "short" or "shorts".
- "card_kicker": Spanish, 1-3 words, max 18 characters (e.g. "ÚLTIMA HORA", "EL CASO", "QUÉ SE SABE", "REACCIONES", "¿Y AHORA?", "TU OPINIÓN").
- "card_headline": Spanish, max 60 characters, factual, based ONLY on the scene narration. No exaggeration.
- "card_detail": Spanish, max 110 characters, one complementary fact taken from the narration of this or other scenes. Never invent data.
- "shows_real_person": true ONLY if the visual would show the face/body of a specific real person. Places, objects, institutions, consequences or questions are false.
- "person_free_prompt": English Stable Diffusion prompt of the same moment WITHOUT identifiable people (only needed for ai_image scenes with shows_real_person=true).
- "hf_prompt": English Stable Diffusion prompt (vertical 9:16, documentary photo, natural light, no text, no tangled limbs). Only used for ai_image scenes.
- "subject_key": short consistent 1-3 word English slug for the main subject, SAME in all scenes (e.g. "luisa_gonzalez", "lionel_messi").
- "scene_tags": 4 specific English keywords for this scene.
Also return "location_label": Spanish "Ciudad o provincia, País" where the event happens, or "" if not applicable.

SCENES (${scenesData.length}):
${scenesData.map((s, idx) => `${idx + 1}. Narration: "${s.text}" | Visual hint: "${s.visual}"`).join('\n')}

Respond ONLY with JSON: {"topic_type": "...", "location_label": "...", "scenes": [exactly ${scenesData.length} objects in order]}`
                const plan = await generateJson(plannerPrompt, StoryboardPlanSchema, { label: 'StoryboardPlanner' })
                if (plan.scenes.length === scenesData.length) {
                    visualPlans = plan.scenes as SceneVisualPlan[]
                    topicType = plan.topic_type
                    if (plan.location_label && plan.location_label.trim()) locationLabel = plan.location_label.trim().replace(/[.\s]+$/, "")
                    const counts = visualPlans.reduce<Record<string, number>>((acc, p) => {
                        const k = p.visual_strategy || 'sin_estrategia'
                        acc[k] = (acc[k] || 0) + 1
                        return acc
                    }, {})
                    console.log(`[ReelGen] Plan: tema=${topicType}, lugar=${locationLabel || '-'}, estrategias=${JSON.stringify(counts)}`)
                } else {
                    console.warn(`[ReelGen] El planificador devolvió ${plan.scenes.length} escenas en vez de ${scenesData.length}; se usa el plan por defecto.`)
                }
            } catch (planErr: any) {
                console.warn(`[ReelGen] Visual planner fallback (${planErr.message})`)
            }
            const isNewsTopic = topicType !== 'evergreen'
            const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
            const now = new Date()
            const dateLabel = factCheck?.event_date?.replace(/[.\s]+$/, '') || `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`
            const sourceLabel = (factCheck?.domains || []).slice(0, 2).join(' · ') || undefined
            const goodSourceIds: string[] = []
            // SEGUIMIENTO: los clips reales que pasaron el filtro en el reel original son la mejor fuente
            // para la Parte 2 (misma historia, mismo lugar). Se ofrecen primero; igual pasan por el filtro.
            const parentIdeaId = script.ideas?.ai_metadata?.parent_idea_id as string | undefined
            if (parentIdeaId) {
                const inherited = await loadParentClipSources(supabase, parentIdeaId, script.user_id || userId)
                goodSourceIds.push(...inherited)
                if (inherited.length) console.log(`[ReelGen] Seguimiento: ${inherited.length} fuente(s) de video heredadas del reel original`)
            }
            // Motor de metraje v4: busca candidatos, mira el video completo por miniaturas y recorta la zona limpia
            const footage = new FootageFinder({
                title: ideaTitle,
                description: ideaDesc,
                location: factCheck?.location,
                eventDate: factCheck?.event_date,
                factBrief: (content.fact_check?.brief as string | undefined) || undefined,
                category: ideaCategory,
            }, { preferredIds: [...goodSourceIds] })

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
                card?: { kicker: string; headline: string; detail?: string }
            }
            const processedScenes: ProcessedScene[] = []

            for (let i = 0; i < scenesData.length; i++) {
                const scene = scenesData[i]
                const plan: SceneVisualPlan = visualPlans[i] || {
                    subject_key: defaultSubjectKey,
                    scene_tags: [ideaCategory || 'viral', `scene_${i + 1}`],
                    yt_search_query: `${ideaTitle} noticia`.slice(0, 80),
                    hf_prompt: `Vertical 9:16 photorealistic action shot of ${content.protagonist_en || ideaTitle}: ${scene.visual}, dramatic lighting, 8k, no text`,
                    visual_strategy: isNewsTopic ? (i % 2 === 0 && i < scenesData.length - 1 ? 'real_footage' : 'news_card') : undefined,
                }
                // Estrategia efectiva: en noticias NUNCA imagen IA (metraje real o tarjeta informativa)
                const strategy: 'real_footage' | 'news_card' | 'default' = isNewsTopic
                    ? (plan.visual_strategy === 'real_footage' ? 'real_footage' : 'news_card')
                    : (plan.visual_strategy === 'news_card' ? 'news_card' : 'default')

                await report(10 + Math.round((60 * i) / scenesData.length), `Escena ${i + 1} de ${scenesData.length}`, 'Voz, subtítulos y visual')
                // A. Generate Audio + WordBoundary Timestamps (with selected voiceId, e.g. es-EC-LuisNeural)
                console.log(`[ReelGen] Generating Audio (${voiceId}) & Word Cues for scene ${i + 1}/${scenesData.length}...`)
                const { audioPath, wordCues } = await audioService.generateAudioWithSubtitles(scene.text, 'es', voiceId)

                // A.1 Generate ASS Karaoke Subtitles (Dynamic active-word highlight, zero overlap)
                const duration = await videoService.getAudioDuration(audioPath)
                const subtitlePath = await subtitleService.generateSRT(scene.text, duration, wordCues)

                // B. SMART AI & VIDEO VAULT: Supports 'hybrid', 'real_video' (YouTube B-Roll / Custom Video), and 'ai_images' (Hugging Face: Z-Image Turbo y respaldos)
                if (!plan.hf_prompt || plan.hf_prompt.trim().length < 5) {
                    plan.hf_prompt = `Vertical 9:16 documentary photo about ${content.protagonist_en || ideaTitle}: ${scene.visual || scene.text}, natural light, no text`
                }
                const enhancedPrompt = `${plan.hf_prompt}, vertical 9:16 aspect ratio, ultra-detailed action photography, cinematic lighting, photorealistic 8k, high contrast, no text, no letters, no watermark`

                let vaultResult: VisualResult | null = null
                const hasCustomVideo = Boolean(customVideoSource.trim())

                if (strategy === 'real_footage' && !hasCustomVideo && visualMode !== 'ai_images') {
                    vaultResult = await footage.findClip({
                        sceneIndex: i,
                        sceneText: scene.text,
                        sceneQuery: plan.yt_search_query,
                        durationSec: duration,
                        category: ideaCategory || 'general',
                        subjectKey: plan.subject_key || defaultSubjectKey,
                        sceneTags: plan.scene_tags || [],
                        usedFiles: usedVaultFiles,
                    })
                }
                // Respaldo: motor anterior solo si YouTube no entregó miniaturas de ningún video
                if (!vaultResult && strategy === 'real_footage' && !hasCustomVideo && visualMode !== 'ai_images' && !footage.hasWorkingStoryboards) {
                    vaultResult = await imageService.fetchRealVideoClipToVault({
                        searchQuery: plan.yt_search_query,
                        sceneIndex: i,
                        durationSec: duration,
                        category: ideaCategory || 'general',
                        subjectKey: plan.subject_key || defaultSubjectKey,
                        sceneTags: plan.scene_tags || [],
                        usedFiles: usedVaultFiles,
                        preferredSourceIds: goodSourceIds,
                    })
                    if (vaultResult?.sourceVideoId && !goodSourceIds.includes(vaultResult.sourceVideoId)) {
                        goodSourceIds.push(vaultResult.sourceVideoId)
                    }
                }

                if (!vaultResult && (strategy === 'news_card' || strategy === 'real_footage') && !(hasCustomVideo && strategy === 'real_footage')) {
                    // Tarjeta informativa: se renderiza al final (para usar de fondo el metraje real del propio reel)
                    vaultResult = { imagePath: '', sourceLabel: 'Tarjeta informativa', fromVault: false, kind: 'news_card' }
                }

                if (!vaultResult) {
                    vaultResult = await imageService.generateOrGetFromVault({
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
                }
                console.log(`[ReelGen] Escena ${i + 1}: ${strategy} -> ${vaultResult.kind}${plan.shows_real_person ? ' (persona real)' : ''} · ${vaultResult.sourceLabel}`)

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
                    sourceKind: vaultResult.kind,
                    card: vaultResult.kind === 'news_card' ? {
                        kicker: plan.card_kicker || (i === scenesData.length - 1 ? 'TU OPINIÓN' : i === 0 ? 'ÚLTIMA HORA' : 'QUÉ SE SABE'),
                        headline: plan.card_headline || scene.caption || scene.text.split(' ').slice(0, 9).join(' '),
                        detail: plan.card_detail,
                    } : undefined
                })
            }

            // 4.2 TARJETAS INFORMATIVAS: fondo = metraje real limpio del propio reel (coherencia visual) o degradado de marca
            const cardScenes = processedScenes.filter(sc => sc.sourceKind === 'news_card')
            if (cardScenes.length > 0) {
                await report(70, 'Diseñando tarjetas informativas', `${cardScenes.length} tarjeta(s)`)
                const backgroundMedia = processedScenes.find(sc => sc.sourceKind === 'real_video')?.imagePath
                let variant = 0
                for (const sc of processedScenes) {
                    if (sc.sourceKind !== 'news_card' || !sc.card) continue
                    sc.imagePath = await cardService.renderNewsCard({
                        kicker: sc.card.kicker,
                        headline: sc.card.headline,
                        detail: sc.card.detail,
                        location: locationLabel,
                        dateLabel,
                        sourceLabel,
                        backgroundMedia,
                        variant: variant++,
                    })
                    const publicDirCards = path.join(process.cwd(), 'public')
                    sc.publicMediaUrl = '/' + path.relative(publicDirCards, sc.imagePath).replace(/\\/g, '/')
                    sc.imageUrl = `Tarjeta informativa: ${sc.card.headline}`
                }
            }

            await report(72, 'Montando el video', 'FFmpeg: escenas, música y sonoridad')
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

            const writeSceneManifest = async () => {
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
                try {
                    await saveSceneManifest(supabase, reelId, manifestEntries)
                } catch (manifestErr) {
                    console.warn('[ReelGen] No se pudo guardar el desglose de escenas:', manifestErr)
                }
            }
            await writeSceneManifest()

            await report(80, 'Auditoría de calidad')
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
                    await report(86, 'Mejorando la escena más débil', `Nota inicial ${qualityScore}/100; regenerando escena ${weakIdx + 1}`)
                    try {
                        // NOTICIAS: nunca se "arregla" con IA. Metraje real de una fuente ya validada u otra búsqueda;
                        // si no hay, tarjeta informativa. TEMAS ATEMPORALES: regla de personas reales como antes.
                        const healMode: VisualGenerationMode =
                            targetScene.realPerson && visualMode !== 'ai_images' ? 'real_video' : 'ai_images'
                        let healedVault: VisualResult | null = null
                        if (isNewsTopic) {
                            if (targetScene.sourceKind !== 'news_card' && visualMode !== 'ai_images') {
                                healedVault = await footage.findClip({
                                    sceneIndex: weakIdx,
                                    sceneText: targetScene.sceneData.text,
                                    sceneQuery: targetScene.ytSearchQuery,
                                    durationSec: targetScene.duration,
                                    category: targetScene.category,
                                    subjectKey: targetScene.subjectKey,
                                    sceneTags: targetScene.sceneTags,
                                    usedFiles: usedVaultFiles,
                                })
                            }
                            if (!healedVault && targetScene.sourceKind !== 'news_card' && visualMode !== 'ai_images' && !footage.hasWorkingStoryboards) {
                                healedVault = await imageService.fetchRealVideoClipToVault({
                                    searchQuery: targetScene.ytSearchQuery,
                                    sceneIndex: weakIdx + 3,
                                    durationSec: targetScene.duration,
                                    category: targetScene.category,
                                    subjectKey: targetScene.subjectKey,
                                    sceneTags: targetScene.sceneTags,
                                    usedFiles: usedVaultFiles,
                                    preferredSourceIds: goodSourceIds,
                                })
                            }
                            if (!healedVault) {
                                const bg = processedScenes.find((sc, k) => k !== weakIdx && sc.sourceKind === 'real_video')?.imagePath
                                const card = targetScene.card || {
                                    kicker: 'QUÉ SE SABE',
                                    headline: targetScene.sceneData.caption || targetScene.sceneData.text.split(' ').slice(0, 9).join(' '),
                                }
                                const cardPath = await cardService.renderNewsCard({
                                    ...card, location: locationLabel, dateLabel, sourceLabel, backgroundMedia: bg, variant: weakIdx + 1,
                                })
                                healedVault = { imagePath: cardPath, sourceLabel: `Tarjeta informativa: ${card.headline}`, fromVault: false, kind: 'news_card' }
                                targetScene.card = card
                            }
                        }
                        if (!healedVault) healedVault = await imageService.generateOrGetFromVault({
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
                        await writeSceneManifest()

                        const reAudit = await auditReelQuality(videoUrl, toAuditScenes(), ideaTitle)
                        if (reAudit && reAudit.score < qualityScore) {
                            // La corrección empeoró el reel: se restaura la escena original y su render
                            console.log(`[ReelGen] La corrección bajó la nota (${qualityScore} → ${reAudit.score}); se conserva la escena original.`)
                            processedScenes[weakIdx] = targetScene
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
                            await writeSceneManifest()
                            qualityFeedback = `${qualityFeedback} (Se probó regenerar la escena ${weakIdx + 1}, pero obtuvo ${reAudit.score}/100; se conservó la versión original.)`
                        } else if (reAudit) {
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

            await report(96, 'Guardando resultados')
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

            return { success: true, reelId, qualityScore, videoUrl }

        } catch (genError: any) {
            console.error('Generation Pipeline Failed:', genError)
            throw genError
        }

    } catch (error: any) {
        console.error('Error generating reel:', error)
        const { data: existingReel } = await supabase
            .from('reels')
            .select('id')
            .eq('script_id', scriptId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        if (existingReel) {
            await supabase.from('reels').update({ status: 'failed' }).eq('id', existingReel.id)
        }
        if (error instanceof JobCancelledError) throw error
        return { success: false, error: error.message }
    }
}

/** IDs de video de origen (YouTube) de los clips aprobados que usó el reel de la idea original. */
async function loadParentClipSources(db: SupabaseClient, parentIdeaId: string, ownerId: string): Promise<string[]> {
    try {
        const { data: scripts } = await db.from('scripts').select('id, user_id').eq('idea_id', parentIdeaId)
        const scriptIds = (scripts || []).filter((x: { id: string; user_id: string | null }) => !x.user_id || x.user_id === ownerId).map((x: { id: string; user_id: string | null }) => x.id)
        if (!scriptIds.length) return []
        const { data: reels } = await db.from('reels').select('id').in('script_id', scriptIds)
        const reelIds = (reels || []).map((r: { id: string }) => r.id)
        if (!reelIds.length) return []
        const { data: scenes } = await db.from('reel_scene_assets').select('image_path').in('reel_id', reelIds)
        const fileNames = [...new Set((scenes || [])
            .map((sc: { image_path: string | null }) => String(sc.image_path || '').split(/[\\/]/).pop())
            .filter((f: string | undefined) => f && f.endsWith('.mp4')))] as string[]
        if (!fileNames.length) return []
        const { data: assets } = await db.from('vault_assets')
            .select('source_video_id, clip_check')
            .in('file_name', fileNames)
            .not('source_video_id', 'is', null)
        const ids = (assets || [])
            .filter((a: { source_video_id: string | null; clip_check: string | null }) => !String(a.clip_check || '').endsWith('-rejected'))
            .map((a: { source_video_id: string | null; clip_check: string | null }) => String(a.source_video_id))
        return [...new Set<string>(ids)].slice(0, 4)
    } catch (err) {
        console.warn(`[ReelGen] No se pudieron heredar clips del reel original: ${err instanceof Error ? err.message : String(err)}`)
        return []
    }
}
