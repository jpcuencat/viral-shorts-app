import fs from 'fs'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Publicación de Reels: única vía = webhook de n8n (Railway), que publica en YouTube y demás redes
 * con sus propias credenciales. La app ya no guarda tokens de YouTube, TikTok ni Instagram.
 */
export type SocialPlatform = 'webhook'

export interface SocialConfig {
    publicBaseUrl?: string
    webhookUrl?: string
    webhookSecret?: string
    defaultHashtags?: string
}

export interface PublicationRecord {
    id: string
    reelId: string
    scriptId: string
    title: string
    videoUrl: string
    platforms: SocialPlatform[]
    results: {
        platform: SocialPlatform
        status: 'published' | 'scheduled' | 'failed'
        externalIdOrUrl?: string
        message?: string
    }[]
    scheduledAt?: string
    createdAt: string
}

const MAX_PUBLICATIONS_SHOWN = 100

function rowToPublication(r: any): PublicationRecord {
    return {
        id: r.id,
        reelId: r.reel_id,
        scriptId: r.script_id,
        title: r.title,
        videoUrl: r.video_url,
        platforms: (r.platforms || ['webhook']) as SocialPlatform[],
        results: r.results || [],
        scheduledAt: r.scheduled_at || undefined,
        createdAt: r.created_at,
    }
}

/** Extrae el ID de 11 caracteres de cualquier URL de YouTube (shorts, watch, youtu.be) o un ID directo. */
export function extractYouTubeVideoId(input: string): string | null {
    const raw = (input || '').trim()
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw
    const match = raw.match(/(?:shorts\/|v=|youtu\.be\/|embed\/|live\/)([A-Za-z0-9_-]{11})/)
    return match ? match[1] : null
}

/** n8n: intenta primero la URL de producción (/webhook/) y luego la de prueba (/webhook-test/). */
async function postToN8n(webhookUrl: string, init: RequestInit, buildBody: () => BodyInit): Promise<Response> {
    const prodUrl = webhookUrl.replace('/webhook-test/', '/webhook/')
    const testUrl = webhookUrl.includes('/webhook-test/') ? webhookUrl : webhookUrl.replace('/webhook/', '/webhook-test/')
    let res = await fetch(prodUrl, { ...init, method: 'POST', body: buildBody() })
    if (!res.ok && prodUrl !== testUrl) {
        res = await fetch(testUrl, { ...init, method: 'POST', body: buildBody() })
    }
    return res
}

/**
 * Configuración del webhook y el historial de publicaciones viven en Supabase (tablas app_settings y
 * publications, con RLS por usuario). Todas las funciones reciben el cliente con la sesión del usuario.
 */
class SocialPublishService {
    private async currentUserId(db: SupabaseClient): Promise<string> {
        const { data: { user } } = await db.auth.getUser()
        if (!user) throw new Error('Sesión no válida. Vuelve a iniciar sesión.')
        return user.id
    }

    public async getConfig(db: SupabaseClient): Promise<SocialConfig> {
        const userId = await this.currentUserId(db)
        const { data } = await db.from('app_settings').select('*').eq('user_id', userId).maybeSingle()
        if (!data) return {}
        return {
            webhookUrl: data.webhook_url || undefined,
            webhookSecret: data.webhook_secret || undefined,
            publicBaseUrl: data.public_base_url || undefined,
            defaultHashtags: data.default_hashtags || undefined,
        }
    }

    public async saveConfig(db: SupabaseClient, newConfig: Partial<SocialConfig>): Promise<SocialConfig> {
        const userId = await this.currentUserId(db)
        const merged: SocialConfig = { ...(await this.getConfig(db)) }
        if (newConfig.webhookUrl !== undefined) merged.webhookUrl = newConfig.webhookUrl
        if (newConfig.webhookSecret !== undefined) merged.webhookSecret = newConfig.webhookSecret
        if (newConfig.publicBaseUrl !== undefined) merged.publicBaseUrl = newConfig.publicBaseUrl
        if (newConfig.defaultHashtags !== undefined) merged.defaultHashtags = newConfig.defaultHashtags

        const { error } = await db.from('app_settings').upsert({
            user_id: userId,
            webhook_url: merged.webhookUrl?.trim() || null,
            webhook_secret: merged.webhookSecret?.trim() || null,
            public_base_url: merged.publicBaseUrl?.trim() || null,
            default_hashtags: merged.defaultHashtags?.trim() || null,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
        if (error) throw new Error(`No se pudo guardar la configuración: ${error.message}`)
        return merged
    }

    public async getPublications(db: SupabaseClient): Promise<PublicationRecord[]> {
        const { data, error } = await db
            .from('publications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(MAX_PUBLICATIONS_SHOWN)
        if (error) {
            console.warn('[SocialPublishService] No se pudo leer el historial:', error.message)
            return []
        }
        return (data || []).map(rowToPublication)
    }

    private async addPublicationRecord(db: SupabaseClient, record: Omit<PublicationRecord, 'id' | 'createdAt'>): Promise<PublicationRecord> {
        const userId = await this.currentUserId(db)
        const { data, error } = await db.from('publications').insert({
            user_id: userId,
            reel_id: record.reelId,
            script_id: record.scriptId,
            title: record.title,
            video_url: record.videoUrl,
            platforms: record.platforms,
            results: record.results,
            scheduled_at: record.scheduledAt || null,
        }).select('*').single()
        if (error || !data) {
            console.warn('[SocialPublishService] No se pudo registrar la publicación:', error?.message)
            return { ...record, id: `local_${Date.now()}`, createdAt: new Date().toISOString() }
        }
        return rowToPublication(data)
    }

    public async removePublicationRecord(db: SupabaseClient, publicationId: string) {
        const { error } = await db.from('publications').delete().eq('id', publicationId)
        if (error) console.warn('[SocialPublishService] No se pudo borrar la publicación:', error.message)
    }

    private webhookHeaders(config: SocialConfig, json = false): Record<string, string> {
        const headers: Record<string, string> = {}
        if (json) headers['Content-Type'] = 'application/json'
        if (config.webhookSecret) headers['X-Webhook-Secret'] = config.webhookSecret
        return headers
    }

    /** Envía el MP4 binario + metadatos al flujo n8n, que publica en las redes. */
    private async publishViaWebhook(
        payload: {
            reelId: string
            scriptId: string
            title: string
            description: string
            hashtags: string[]
            videoUrl: string
            videoDiskPath: string
            privacyStatus: string
            scheduledAt?: string
        },
        config: SocialConfig
    ): Promise<{ externalIdOrUrl: string; message: string }> {
        const webhookUrl = config.webhookUrl || process.env.SOCIAL_WEBHOOK_URL
        if (!webhookUrl) {
            throw new Error('Falta configurar la URL del Webhook de n8n en Redes Sociales.')
        }

        const baseUrl = (config.publicBaseUrl || 'http://localhost:3000').replace(/\/$/, '')

        const buildFormData = () => {
            const formData = new FormData()
            formData.append('event', 'reel.publish')
            formData.append('reelId', payload.reelId)
            formData.append('scriptId', payload.scriptId)
            formData.append('title', payload.title)
            formData.append('description', payload.description)
            formData.append(
                'captionWithHashtags',
                `${payload.title}\n\n${payload.description}\n\n${payload.hashtags.join(' ')}`
            )
            formData.append('hashtags', JSON.stringify(payload.hashtags))
            formData.append('hashtagsText', payload.hashtags.join(' '))
            formData.append('videoRelativeUrl', payload.videoUrl)
            formData.append(
                'videoPublicUrl',
                `${baseUrl}${payload.videoUrl.startsWith('/') ? payload.videoUrl : '/' + payload.videoUrl}`
            )
            formData.append('privacyStatus', payload.privacyStatus)
            formData.append('selfDeclaredMadeForKids', 'false')
            formData.append('scheduledAt', payload.scheduledAt || '')
            formData.append('timestamp', new Date().toISOString())

            if (fs.existsSync(payload.videoDiskPath)) {
                const videoBuffer = fs.readFileSync(payload.videoDiskPath)
                const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' })
                const fileName = path.basename(payload.videoDiskPath) || `reel_${payload.reelId}.mp4`
                formData.append('data', videoBlob, fileName)
            }
            return formData
        }

        const res = await postToN8n(webhookUrl, { headers: this.webhookHeaders(config) }, buildFormData)
        if (!res.ok) {
            throw new Error(
                `El Webhook de n8n respondió con HTTP ${res.status}. Asegúrate de que el flujo esté Publicado (Active) en n8n.`
            )
        }

        return {
            externalIdOrUrl: webhookUrl,
            message: payload.scheduledAt
                ? `Video MP4 + metadatos enviados a n8n (Programado: ${new Date(payload.scheduledAt).toLocaleString('es-EC')})`
                : 'Video MP4 + metadatos enviados directamente a tu flujo n8n en Railway.'
        }
    }

    /** Publica o programa un Reel a través del webhook de n8n. */
    public async publishReel(db: SupabaseClient, params: {
        reelId: string
        scriptId: string
        videoUrl: string
        title: string
        description: string
        hashtags: string[]
        platforms?: SocialPlatform[]
        privacyStatus?: 'public' | 'unlisted' | 'private'
        scheduledAt?: string
    }): Promise<{ success: boolean; record: PublicationRecord }> {
        const config = await this.getConfig(db)
        const videoDiskPath = path.join(process.cwd(), 'public', params.videoUrl.replace(/^\//, ''))
        const results: PublicationRecord['results'] = []

        try {
            const wh = await this.publishViaWebhook(
                {
                    reelId: params.reelId,
                    scriptId: params.scriptId,
                    title: params.title,
                    description: params.description,
                    hashtags: params.hashtags,
                    videoUrl: params.videoUrl,
                    videoDiskPath,
                    privacyStatus: params.privacyStatus || 'public',
                    scheduledAt: params.scheduledAt
                },
                config
            )
            results.push({
                platform: 'webhook',
                status: params.scheduledAt ? 'scheduled' : 'published',
                externalIdOrUrl: wh.externalIdOrUrl,
                message: wh.message
            })
        } catch (err: any) {
            console.error('[SocialPublishService] Error en webhook n8n:', err)
            results.push({ platform: 'webhook', status: 'failed', message: err.message || 'Error publicando vía n8n' })
        }

        const record = await this.addPublicationRecord(db, {
            reelId: params.reelId,
            scriptId: params.scriptId,
            title: params.title,
            videoUrl: params.videoUrl,
            platforms: ['webhook'],
            results,
            scheduledAt: params.scheduledAt,
        })

        return { success: results.some((r) => r.status !== 'failed'), record }
    }

    /** Pide a n8n que elimine un Short de YouTube (n8n usa su propia credencial del canal). */
    public async deleteYouTubeShort(db: SupabaseClient, params: {
        videoIdOrUrl: string
        publicationId?: string
    }): Promise<{ success: boolean; videoId: string; message: string }> {
        const config = await this.getConfig(db)
        const cleanVideoId = extractYouTubeVideoId(params.videoIdOrUrl)
        if (!cleanVideoId) {
            throw new Error('Pega el enlace del Short de YouTube (ej. https://youtube.com/shorts/XXXX) o su ID de 11 caracteres.')
        }

        const webhookUrl = config.webhookUrl || process.env.SOCIAL_WEBHOOK_URL
        if (!webhookUrl) {
            throw new Error('Configura primero el Webhook de n8n en Redes Sociales.')
        }

        const deleteBody = JSON.stringify({
            event: 'reel.delete',
            action: 'delete',
            youtubeVideoId: cleanVideoId,
            youtubeUrl: `https://youtube.com/shorts/${cleanVideoId}`,
            timestamp: new Date().toISOString()
        })
        const res = await postToN8n(webhookUrl, { headers: this.webhookHeaders(config, true) }, () => deleteBody)
        if (!res.ok) {
            throw new Error(`n8n respondió con HTTP ${res.status} al pedir la eliminación.`)
        }

        if (params.publicationId) {
            await this.removePublicationRecord(db, params.publicationId)
        }

        return {
            success: true,
            videoId: cleanVideoId,
            message: `Orden de eliminación enviada a n8n para el Short "${cleanVideoId}".`
        }
    }
}

export const socialPublishService = new SocialPublishService()
