import { z } from 'zod'

// Esquemas tolerantes: coercionan números y aceptan campos extra,
// pero garantizan que lo imprescindible exista antes de guardar o renderizar.

const score = z.coerce.number().min(0).max(100)
const duration = z.coerce.number().positive().max(600)

export const IdeaSuggestionSchema = z.looseObject({
    title: z.string().min(3),
    description: z.string().default(''),
    estimated_duration: duration.catch(45),
    viral_score: score.catch(80),
    matched_trend: z.string().optional(),
    suggested_category: z.string().optional()
})
export const IdeaSuggestionListSchema = z.array(IdeaSuggestionSchema).min(1)

export const TrendSelectionSchema = z.array(
    z.looseObject({
        trend_index: z.coerce.number().int().min(0),
        category_name: z.string().optional(),
        title: z.string().min(3),
        description: z.string().default(''),
        viral_score: score.catch(80),
        estimated_duration: duration.catch(45)
    })
).min(1)

export const ScriptContentSchema = z.looseObject({
    protagonist_en: z.string().optional(),
    hook_visual: z.string().optional(),
    hook_audio: z.string().min(3),
    hook_caption: z.string().optional(),
    body_paragraphs: z.array(z.string().min(1)).min(1),
    scene_visuals: z.array(z.string()).default([]),
    body_captions: z.array(z.string()).default([]),
    cta: z.string().min(3),
    cta_visual: z.string().optional(),
    cta_caption: z.string().optional()
})

export const ScriptResponseSchema = z.looseObject({
    seo_title: z.string().min(3),
    seo_description: z.string().default(''),
    hashtags: z.array(z.string()).default([]),
    content: ScriptContentSchema,
    estimated_duration: duration.catch(45)
})
export type ScriptResponse = z.infer<typeof ScriptResponseSchema>

export const SceneVisualPlanSchema = z.looseObject({
    subject_key: z.string().min(1),
    scene_tags: z.array(z.string()).default([]),
    yt_search_query: z.string().min(1),
    hf_prompt: z.string().min(5),
    shows_real_person: z.boolean().catch(false),
    person_free_prompt: z.string().optional()
})
export const SceneVisualPlanListSchema = z.array(SceneVisualPlanSchema)

export const QualityAuditSchema = z.looseObject({
    score: score,
    weakestSceneIndex: z.coerce.number().int().min(0).catch(0),
    improvedVisualPrompt: z.string().optional(),
    feedback: z.string().default('')
})
export type QualityAudit = z.infer<typeof QualityAuditSchema>

export const FollowUpListSchema = z.array(
    z.looseObject({
        angle_tag: z.string().default('Seguimiento'),
        title: z.string().min(3),
        description: z.string().default(''),
        estimated_duration: duration.catch(45),
        viral_score: score.catch(80)
    })
).min(1)

export const ClipRelevanceSchema = z.looseObject({
    valid: z.boolean(),
    has_overlay_text: z.boolean().optional(),
    has_logo_or_watermark: z.boolean().optional(),
    is_relevant: z.boolean().optional(),
    reason: z.string().optional()
})
