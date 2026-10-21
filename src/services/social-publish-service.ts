import fs from 'fs'
import path from 'path'

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

const DATA_DIR = path.join(process.cwd(), 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'social-config.json')
const PUBLICATIONS_PATH = path.join(DATA_DIR, 'social-publications.json')
const ALLOWED_CONFIG_KEYS: (keyof SocialConfig)[] = ['publicBaseUrl', 'webhookUrl', 'webhookSecret', 'defaultHashtags']

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

class SocialPublishService {
    constructor() {
        fs.mkdirSync(DATA_DIR, { recursive: true })
    }

    public getConfig(): SocialConfig {
        try {
            if (!fs.existsSync(CONFIG_PATH)) return {}
            const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
            const clean: SocialConfig = {}
            for (const k of ALLOWED_CONFIG_KEYS) if (raw[k] !== undefined) clean[k] = raw[k]
            return clean
        } catch {
            return {}
        }
    }

    public saveConfig(newConfig: Partial<SocialConfig>): SocialConfig {
        const merged: SocialConfig = { ...this.getConfig() }
        for (const k of ALLOWED_CONFIG_KEYS) if (newConfig[k] !== undefined) merged[k] = newConfig[k]
        fs.mkdirSync(DATA_DIR, { recursive: true })
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8')
        return merged
    }

    public getPublications(): PublicationRecord[] {
        try {
            if (!fs.existsSync(PUBLICATIONS_PATH)) return []
            return JSON.parse(fs.readFileSync(PUBLICATIONS_PATH, 'utf-8'))
        } catch {
            return []
        }
    }

    private addPublicationRecord(record: PublicationRecord) {
        const list = this.getPublications()
        list.unshift(record)
        fs.writeFileSync(PUBLICATIONS_PATH, JSON.stringify(list.slice(0, 100), null, 2), 'utf-8')
    }

    public removePublicationRecord(publicationId: string) {
        const list = this.getPublications().filter((p) => p.id !== publicationId)
        fs.writeFileSync(PUBLICATIONS_PATH, JSON.stringify(list, null, 2), 'utf-8')
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
    public async publishReel(params: {
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
        const config = this.getConfig()
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

        const record: PublicationRecord = {
            id: `pub_${Date.now()}`,
            reelId: params.reelId,
            scriptId: params.scriptId,
            title: params.title,
            videoUrl: params.videoUrl,
            platforms: ['webhook'],
            results,
            scheduledAt: params.scheduledAt,
            createdAt: new Date().toISOString()
        }
        this.addPublicationRecord(record)

        return { success: results.some((r) => r.status !== 'failed'), record }
    }

    /** Pide a n8n que elimine un Short de YouTube (n8n usa su propia credencial del canal). */
    public async deleteYouTubeShort(params: {
        videoIdOrUrl: string
        publicationId?: string
    }): Promise<{ success: boolean; videoId: string; message: string }> {
        const config = this.getConfig()
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
            this.removePublicationRecord(params.publicationId)
        }

        return {
            success: true,
            videoId: cleanVideoId,
            message: `Orden de eliminación enviada a n8n para el Short "${cleanVideoId}".`
        }
    }
}

export const socialPublishService = new SocialPublishService()
