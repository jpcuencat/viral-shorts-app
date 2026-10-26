'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { videoService } from '@/services/video-service'
import { imageService } from '@/services/image-service'
import { model } from '@/lib/ai/gemini'
import { getSceneManifest, saveSceneManifest, type SceneManifestEntry } from '@/lib/scene-store'
import { auditReelQuality, type GenerateReelOptions } from '@/lib/pipeline/reel-pipeline'
import { enqueueJob } from '@/lib/jobs/queue'
import path from 'path'

export type { GenerateReelOptions, SceneManifestEntry }

/**
 * Encola la generación de un reel. El trabajo lo ejecuta el worker en segundo plano;
 * la interfaz sigue el progreso en vivo con el id devuelto.
 */
export async function generateReel(
    scriptId: string,
    options: GenerateReelOptions = {}
): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
        const supabase = await createClient()
        const { data: script } = await supabase
            .from('scripts')
            .select('id, ideas(title)')
            .eq('id', scriptId)
            .maybeSingle()
        if (!script) return { success: false, error: 'Guion no encontrado.' }

        const title = (script as any).ideas?.title || 'Reel'
        const jobId = await enqueueJob(supabase, {
            type: 'generate_reel',
            title,
            payload: { scriptId, options },
        })
        return { success: true, jobId }
    } catch (error: any) {
        return { success: false, error: error.message || 'No se pudo encolar la generación.' }
    }
}

/**
 * Devuelve el desglose de escenas de un reel para el editor de escenas.
 */
export async function getReelSceneManifest(reelId: string): Promise<SceneManifestEntry[]> {
    try {
        const supabase = await createClient()
        return await getSceneManifest(supabase, reelId)
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
        /** Ruta pública (/custom-videos/...) de un video subido por el usuario para esta escena. */
        customVideoFile?: string
        /** Segundo del video desde el que se toma el tramo (opcional, por defecto 0). */
        customStartSec?: number
        /** Ruta pública (/custom-photos/...) de una foto limpia subida por el usuario para esta escena. */
        customPhotoFile?: string
    }
): Promise<{ success: boolean; videoUrl?: string; error?: string }> {
    const supabase = await createClient()

    // El reel debe pertenecer al usuario (RLS devuelve vacío si no)
    const { data: ownReel } = await supabase.from('reels').select('id').eq('id', reelId).maybeSingle()
    if (!ownReel) {
        return { success: false, error: 'Reel no encontrado.' }
    }

    const manifest = await getSceneManifest(supabase, reelId)
    if (manifest.length === 0) {
        return {
            success: false,
            error: 'Este Reel fue creado antes de activar el editor de escenas. Regenera el Reel una vez para habilitar la edición por escena.'
        }
    }

    try {
        const target = manifest[sceneIndex]
        if (!target) {
            return { success: false, error: 'Escena no encontrada.' }
        }

        const cleanSubjectName = (target.subjectKey || 'protagonist').replace(/_/g, ' ')
        const customText = options.customPromptOrQuery?.trim()
        const customPhotoFile = options.customPhotoFile?.trim()
        const customVideoFile = customPhotoFile ? undefined : options.customVideoFile?.trim()
        const customVideoUrl = customPhotoFile || customVideoFile ? undefined : options.customVideoUrl?.trim()
        const usesOwnVideo = Boolean(customPhotoFile || customVideoFile || customVideoUrl)

        // Never reuse the old distorted prompt when replacing a scene:
        // build a clean, anatomically-safe editorial/broadcast shot matching any topic or protagonist!
        let freshEnglishPrompt = customText
            ? `${customText}, featuring ${cleanSubjectName}, waist-up medium editorial shot or clean wide establishing frame, natural anatomy, vertical 9:16 aspect ratio, ultra-detailed editorial photography, dramatic broadcast lighting, photorealistic 8k, no text`
            : `Waist-up medium editorial broadcast shot of ${cleanSubjectName}, expressive posture and authentic setting matching "${target.text}", vertical 9:16 aspect ratio, ultra-detailed photography, dramatic cinematic lighting, photorealistic 8k, no text, no deformed limbs`

        // Con URL de video no hace falta generar prompt de imagen
        if (!usesOwnVideo) try {
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

        const vaultResult = customPhotoFile
            ? await imageService.useUploadedPhoto({ publicPath: customPhotoFile })
            : customVideoFile
            ? await imageService.useUploadedVideo({
                publicPath: customVideoFile,
                startSec: options.customStartSec,
                durationSec: target.duration
            })
            : customVideoUrl
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

        // La revisión visual rechazó todas las imágenes IA (persona falsa o letras inventadas)
        if (!vaultResult.imagePath) {
            return { success: false, error: 'No se pudo generar una imagen limpia para esta escena (sin personas falsas ni letras inventadas). Prueba con otra indicación, sube una foto propia o usa un video.' }
        }

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
            hfPrompt: usesOwnVideo ? target.hfPrompt : freshEnglishPrompt,
            ytSearchQuery: customPhotoFile || customVideoFile || customVideoUrl || videoQuery
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

        await saveSceneManifest(supabase, reelId, manifest)

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

