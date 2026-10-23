'use server'

import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
    socialPublishService,
    SocialConfig,
    SocialPlatform,
    PublicationRecord,
} from '@/services/social-publish-service'

export async function getSocialDashboardData(): Promise<{
    config: SocialConfig
    publications: PublicationRecord[]
}> {
    const supabase = await createClient()
    const [config, publications] = await Promise.all([
        socialPublishService.getConfig(supabase),
        socialPublishService.getPublications(supabase),
    ])
    return { config, publications }
}

export async function saveSocialConfigAction(newConfig: Partial<SocialConfig>) {
    try {
        const supabase = await createClient()
        const saved = await socialPublishService.saveConfig(supabase, newConfig)
        revalidatePath('/social')
        return { success: true, config: saved }
    } catch (error: any) {
        return { success: false, error: error.message || 'No se pudo guardar la configuración' }
    }
}

export async function publishReelToSocialsAction(params: {
    reelId: string
    scriptId: string
    videoUrl: string
    title: string
    description: string
    hashtags: string[]
    platforms?: SocialPlatform[]
    privacyStatus?: 'public' | 'unlisted' | 'private'
    scheduledAt?: string
}) {
    const supabase = await createClient()

    const res = await socialPublishService.publishReel(supabase, params)

    if (res.success) {
        await supabase
            .from('reels')
            .update({ status: params.scheduledAt ? 'scheduled' : 'published' })
            .eq('id', params.reelId)
    }

    revalidatePath(`/scripts/${params.scriptId}`)
    revalidatePath('/social')
    revalidatePath('/dashboard')

    return res
}

export async function testWebhookAction(webhookUrl?: string, webhookSecret?: string) {
    const supabase = await createClient()
    const config = await socialPublishService.getConfig(supabase)
    const targetUrl = (webhookUrl || config.webhookUrl || '').trim()
    const secret = (webhookSecret ?? config.webhookSecret ?? '').trim()

    if (!targetUrl) {
        return { success: false, error: 'Ingresa primero la URL del Webhook de n8n.' }
    }

    try {
        const baseUrl = (config.publicBaseUrl || 'http://localhost:3000').replace(/\/$/, '')
        const headers: Record<string, string> = {}
        if (secret) headers['X-Webhook-Secret'] = secret

        const formData = new FormData()
        formData.append('event', 'reel.publish.test')
        formData.append('reelId', 'test_reel_001')
        formData.append('scriptId', 'test_script_001')
        formData.append('title', '🔥 Prueba de Conexión desde RealsAI Ecuador')
        formData.append('description', 'Este es un envío de prueba con video MP4 binario adjunto.')
        formData.append(
            'captionWithHashtags',
            '🔥 Prueba de Conexión desde RealsAI Ecuador\n\nEste es un envío de prueba.\n\n#Shorts #Ecuador #Viral'
        )
        formData.append('hashtags', JSON.stringify(['#Shorts', '#Ecuador', '#Viral']))
        formData.append('hashtagsText', '#Shorts,#Ecuador,#Viral')
        formData.append('videoRelativeUrl', '/output/sample.mp4')
        formData.append('videoPublicUrl', `${baseUrl}/output/sample.mp4`)
        formData.append('privacyStatus', 'public')
        formData.append('scheduledAt', '')
        formData.append('timestamp', new Date().toISOString())

        // Attach the latest rendered .mp4 from public/output (if available) so n8n receives Binary -> data!
        const outputDir = path.join(process.cwd(), 'public', 'output')
        if (fs.existsSync(outputDir)) {
            const mp4Files = fs
                .readdirSync(outputDir)
                .filter((f) => f.endsWith('.mp4'))
                .map((f) => ({
                    name: f,
                    full: path.join(outputDir, f),
                    mtime: fs.statSync(path.join(outputDir, f)).mtimeMs,
                }))
                .sort((a, b) => b.mtime - a.mtime)

            if (mp4Files.length > 0) {
                const latest = mp4Files[0]
                const buf = fs.readFileSync(latest.full)
                formData.append('data', new Blob([buf], { type: 'video/mp4' }), latest.name)
            }
        }

        const res = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: formData
        })

        if (!res.ok) {
            return {
                success: false,
                error: `n8n respondió con HTTP ${res.status}. Asegúrate de tener activo el flujo o haber pulsado "Listen for test event" en n8n.`
            }
        }

        return { success: true }
    } catch (err: any) {
        return {
            success: false,
            error: `No se pudo conectar con ${targetUrl}: ${err.message}`
        }
    }
}

export async function deleteYouTubeShortAction(params: {
    videoIdOrUrl: string
    publicationId?: string
    reelId?: string
    scriptId?: string
}) {
    try {
        const supabase = await createClient()
        const res = await socialPublishService.deleteYouTubeShort(supabase, {
            videoIdOrUrl: params.videoIdOrUrl,
            publicationId: params.publicationId,
        })

        if (params.reelId) {
            await supabase
                .from('reels')
                .update({ youtube_id: null, status: 'completed' })
                .eq('id', params.reelId)
        }

        if (params.scriptId) {
            revalidatePath(`/scripts/${params.scriptId}`)
        }
        revalidatePath('/social')
        revalidatePath('/dashboard')

        return { success: true, videoId: res.videoId, message: res.message }
    } catch (err: any) {
        return { success: false, error: err.message || 'Error eliminando el Short de YouTube' }
    }
}

