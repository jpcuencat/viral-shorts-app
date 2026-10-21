import fs from 'fs'
import path from 'path'
import { youtubeService } from './youtube-service'

export type SocialPlatform = 'youtube' | 'tiktok' | 'instagram' | 'webhook'

export interface SocialConfig {
    youtubeClientId?: string
    youtubeClientSecret?: string
    tiktokAccessToken?: string
    tiktokPostMode?: 'DIRECT_POST' | 'MEDIA_UPLOAD'
    instagramUserId?: string
    instagramAccessToken?: string
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

class SocialPublishService {
    constructor() {
        fs.mkdirSync(DATA_DIR, { recursive: true })
    }

    public getConfig(): SocialConfig {
        try {
            if (!fs.existsSync(CONFIG_PATH)) return {}
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
        } catch {
            return {}
        }
    }

    public saveConfig(newConfig: Partial<SocialConfig>): SocialConfig {
        const current = this.getConfig()
        const merged: SocialConfig = { ...current, ...newConfig }
        fs.mkdirSync(DATA_DIR, { recursive: true })
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8')

        if (merged.youtubeClientId && merged.youtubeClientSecret) {
            youtubeService.saveClientCredentials(merged.youtubeClientId, merged.youtubeClientSecret)
        }
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

    /**
     * Direct upload to TikTok via TikTok Content Posting API v2 (FILE_UPLOAD)
     */
    private async publishToTikTok(
        videoDiskPath: string,
        title: string,
        description: string,
        config: SocialConfig
    ): Promise<{ externalIdOrUrl: string; message: string }> {
        const token = config.tiktokAccessToken || process.env.TIKTOK_ACCESS_TOKEN
        if (!token) {
            throw new Error('Falta configurar el TikTok Access Token en la sección Redes Sociales.')
        }

        const fileSize = fs.statSync(videoDiskPath).size
        const isInboxDraft = config.tiktokPostMode === 'MEDIA_UPLOAD'
        const endpoint = isInboxDraft
            ? 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
            : 'https://open.tiktokapis.com/v2/post/publish/video/init/'

        const caption = `${title}\n${description}`.slice(0, 2100)

        const initBody: Record<string, any> = isInboxDraft
            ? {
                  source_info: {
                      source: 'FILE_UPLOAD',
                      video_size: fileSize,
                      chunk_size: fileSize,
                      total_chunk_count: 1
                  }
              }
            : {
                  post_info: {
                      title: caption,
                      privacy_level: 'PUBLIC_TO_EVERYONE',
                      disable_duet: false,
                      disable_comment: false,
                      disable_stitch: false
                  },
                  source_info: {
                      source: 'FILE_UPLOAD',
                      video_size: fileSize,
                      chunk_size: fileSize,
                      total_chunk_count: 1
                  }
              }

        const initRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json; charset=UTF-8'
            },
            body: JSON.stringify(initBody)
        })

        const initData = await initRes.json()
        if (!initRes.ok || initData?.error?.code !== 'ok') {
            throw new Error(initData?.error?.message || `TikTok API HTTP ${initRes.status}`)
        }

        const uploadUrl = initData?.data?.upload_url
        const publishId = initData?.data?.publish_id
        if (!uploadUrl) {
            throw new Error('TikTok API no devolvió upload_url.')
        }

        const videoBuffer = fs.readFileSync(videoDiskPath)
        const putRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': String(fileSize),
                'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`
            },
            body: videoBuffer
        })

        if (!putRes.ok) {
            throw new Error(`Error subiendo binario MP4 a TikTok: HTTP ${putRes.status}`)
        }

        return {
            externalIdOrUrl: publishId || 'tiktok_uploaded',
            message: isInboxDraft
                ? 'Enviado a la bandeja de entrada de tu app TikTok (listo para publicar).'
                : `Publicado en TikTok (ID: ${publishId})`
        }
    }

    /**
     * Direct upload to Instagram Reels via Meta Graph API v19.0
     * Uses Resumable Binary Upload (rupload.facebook.com) when running on localhost
     * so no public URL / ngrok tunnel is required.
     */
    private async publishToInstagramReels(
        videoDiskPath: string,
        publicVideoPath: string,
        caption: string,
        config: SocialConfig
    ): Promise<{ externalIdOrUrl: string; message: string }> {
        const igUserId = (config.instagramUserId || process.env.INSTAGRAM_USER_ID || '').trim()
        const accessToken = (config.instagramAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN || '').trim()
        const baseUrl = (config.publicBaseUrl || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')

        if (!igUserId || !accessToken) {
            throw new Error('Falta configurar Instagram User ID y Access Token en la sección Redes Sociales.')
        }

        const hasPublicUrl = Boolean(baseUrl && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1'))
        let creationId = ''

        if (!hasPublicUrl) {
            // Direct Binary Upload via Meta Resumable Upload API (works from localhost without ngrok!)
            if (!fs.existsSync(videoDiskPath)) {
                throw new Error(`No se encontró el archivo MP4 local en: ${videoDiskPath}`)
            }
            const videoBuffer = fs.readFileSync(videoDiskPath)
            const fileSize = videoBuffer.length

            // Step 1A: Create Resumable Reel Container
            const containerRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    media_type: 'REELS',
                    upload_type: 'resumable',
                    caption: caption.slice(0, 2150),
                    share_to_feed: true,
                    access_token: accessToken
                })
            })
            const containerData = await containerRes.json()
            if (!containerRes.ok || !containerData.id) {
                throw new Error(containerData?.error?.message || 'Error creando contenedor resumable de Instagram Reel')
            }
            creationId = containerData.id
            const uploadUri = containerData.uri || `https://rupload.facebook.com/ig-api-upload/v19.0/${creationId}`

            // Step 1B: Upload binary MP4 directly to rupload.facebook.com
            const uploadRes = await fetch(uploadUri, {
                method: 'POST',
                headers: {
                    Authorization: `OAuth ${accessToken}`,
                    offset: '0',
                    file_size: String(fileSize),
                    'Content-Type': 'application/octet-stream'
                },
                body: videoBuffer
            })
            const uploadData = await uploadRes.json().catch(() => ({}))
            if (!uploadRes.ok) {
                throw new Error(
                    uploadData?.debug_info?.message ||
                        uploadData?.error?.message ||
                        `Error subiendo binario MP4 a Instagram (HTTP ${uploadRes.status})`
                )
            }
        } else {
            // Public URL Upload
            const fullVideoUrl = `${baseUrl}${publicVideoPath.startsWith('/') ? publicVideoPath : '/' + publicVideoPath}`
            const containerRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    media_type: 'REELS',
                    video_url: fullVideoUrl,
                    caption: caption.slice(0, 2150),
                    share_to_feed: true,
                    access_token: accessToken
                })
            })
            const containerData = await containerRes.json()
            if (!containerRes.ok || !containerData.id) {
                throw new Error(containerData?.error?.message || 'Error creando contenedor de Instagram Reel')
            }
            creationId = containerData.id
        }

        // Step 2: Poll container status until FINISHED (up to 60s)
        for (let i = 0; i < 12; i++) {
            await new Promise((r) => setTimeout(r, 5000))
            const statusRes = await fetch(
                `https://graph.facebook.com/v19.0/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`
            )
            const statusData = await statusRes.json()
            if (statusData.status_code === 'FINISHED') break
            if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') {
                throw new Error(
                    `Instagram rechazó el procesamiento del video (${statusData.status || statusData.status_code}).`
                )
            }
        }

        // Step 3: Publish Container
        const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                creation_id: creationId,
                access_token: accessToken
            })
        })
        const publishData = await publishRes.json()
        if (!publishRes.ok || !publishData.id) {
            throw new Error(publishData?.error?.message || 'Error publicando Instagram Reel')
        }

        return {
            externalIdOrUrl: `https://www.instagram.com/`,
            message: `Instagram Reel publicado exitosamente (Media ID: ${publishData.id})`
        }
    }

    /**
     * Universal Multi-Network Webhook (Make.com / n8n Cloud / Railway / Zapier)
     * Sends BOTH all metadata fields AND the actual .mp4 binary file via multipart/form-data (field "data")
     * so cloud n8n instances (e.g. Railway) receive the video directly without needing ngrok/localhost tunnels!
     */
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
            throw new Error('Falta configurar la URL del Webhook (n8n / Make.com) en Redes Sociales.')
        }

        const baseUrl = (config.publicBaseUrl || 'http://localhost:3000').replace(/\/$/, '')
        const headers: Record<string, string> = {}
        if (config.webhookSecret) {
            headers['X-Webhook-Secret'] = config.webhookSecret
        }

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

        // Always try n8n Production URL (/webhook/) first so it works 24/7 without clicking Execute in n8n,
        // and fallback to /webhook-test/ if the workflow isn't published yet.
        const prodUrl = webhookUrl.replace('/webhook-test/', '/webhook/')
        const testUrl = webhookUrl.includes('/webhook-test/')
            ? webhookUrl
            : webhookUrl.replace('/webhook/', '/webhook-test/')

        let res = await fetch(prodUrl, {
            method: 'POST',
            headers,
            body: buildFormData()
        })

        if (!res.ok && prodUrl !== testUrl) {
            res = await fetch(testUrl, {
                method: 'POST',
                headers,
                body: buildFormData()
            })
        }

        if (!res.ok) {
            throw new Error(
                `El Webhook de n8n respondió con HTTP ${res.status}. Asegúrate de que el flujo esté Publicado (Active) arriba a la derecha en n8n.`
            )
        }

        return {
            externalIdOrUrl: webhookUrl,
            message: payload.scheduledAt
                ? `Video MP4 + metadatos enviados a n8n (Programado: ${new Date(payload.scheduledAt).toLocaleString('es-EC')})`
                : 'Video MP4 + metadatos enviados directamente a tu flujo n8n en Railway.'
        }
    }

    /**
     * Publishes or schedules a Reel across all selected social platforms
     */
    public async publishReel(params: {
        reelId: string
        scriptId: string
        videoUrl: string
        title: string
        description: string
        hashtags: string[]
        platforms: SocialPlatform[]
        privacyStatus?: 'public' | 'unlisted' | 'private'
        scheduledAt?: string
    }): Promise<{
        success: boolean
        youtubeId?: string | null
        record: PublicationRecord
    }> {
        const config = this.getConfig()
        const videoDiskPath = path.join(process.cwd(), 'public', params.videoUrl.replace(/^\//, ''))
        const cleanTags = params.hashtags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean)
        const hashString = params.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')
        const fullDescription = `${params.description}\n\n${hashString}`.trim()

        const results: PublicationRecord['results'] = []
        let youtubeId: string | null = null

        for (const platform of params.platforms) {
            try {
                if (platform === 'youtube') {
                    const ytId = await youtubeService.uploadVideo({
                        videoPath: videoDiskPath,
                        title: params.title,
                        description: fullDescription,
                        tags: cleanTags,
                        privacyStatus: params.privacyStatus || 'public',
                        publishAt: params.scheduledAt
                    })
                    youtubeId = ytId
                    const isScheduled = Boolean(params.scheduledAt && new Date(params.scheduledAt).getTime() > Date.now())
                    results.push({
                        platform: 'youtube',
                        status: isScheduled ? 'scheduled' : 'published',
                        externalIdOrUrl: ytId ? `https://youtube.com/shorts/${ytId}` : undefined,
                        message: isScheduled
                            ? `YouTube Short programado para ${new Date(params.scheduledAt!).toLocaleString('es-EC')}`
                            : `Publicado en YouTube Shorts (https://youtube.com/shorts/${ytId})`
                    })
                } else if (platform === 'tiktok') {
                    const tt = await this.publishToTikTok(videoDiskPath, params.title, fullDescription, config)
                    results.push({
                        platform: 'tiktok',
                        status: 'published',
                        externalIdOrUrl: tt.externalIdOrUrl,
                        message: tt.message
                    })
                } else if (platform === 'instagram') {
                    const ig = await this.publishToInstagramReels(
                        videoDiskPath,
                        params.videoUrl,
                        `${params.title}\n\n${fullDescription}`,
                        config
                    )
                    results.push({
                        platform: 'instagram',
                        status: 'published',
                        externalIdOrUrl: ig.externalIdOrUrl,
                        message: ig.message
                    })
                } else if (platform === 'webhook') {
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
                }
            } catch (err: any) {
                console.error(`[SocialPublishService] Error on ${platform}:`, err)
                results.push({
                    platform,
                    status: 'failed',
                    message: err.message || `Error publicando en ${platform}`
                })
            }
        }

        const record: PublicationRecord = {
            id: `pub_${Date.now()}`,
            reelId: params.reelId,
            scriptId: params.scriptId,
            title: params.title,
            videoUrl: params.videoUrl,
            platforms: params.platforms,
            results,
            scheduledAt: params.scheduledAt,
            createdAt: new Date().toISOString()
        }

        this.addPublicationRecord(record)

        const anySuccess = results.some((r) => r.status === 'published' || r.status === 'scheduled')
        return {
            success: anySuccess,
            youtubeId,
            record
        }
    }

    public removePublicationRecord(publicationId: string) {
        const list = this.getPublications().filter((p) => p.id !== publicationId)
        fs.writeFileSync(PUBLICATIONS_PATH, JSON.stringify(list, null, 2), 'utf-8')
    }

    /**
     * Deletes a published Short from YouTube (via direct YouTube OAuth if connected AND/OR via the n8n Webhook)
     */
    public async deleteYouTubeShort(params: {
        videoIdOrUrl: string
        publicationId?: string
    }): Promise<{
        success: boolean
        videoId: string
        message: string
    }> {
        const config = this.getConfig()
        const cleanVideoId = youtubeService.extractVideoId(params.videoIdOrUrl)

        if (!cleanVideoId) {
            throw new Error('Pega el enlace del Short de YouTube (ej. https://youtube.com/shorts/XXXX) o su ID de 11 caracteres.')
        }

        const messages: string[] = []
        let deletedSomewhere = false

        // 1. Try Direct YouTube OAuth if connected in RealsAI
        const ytStatus = youtubeService.getStatus()
        if (ytStatus.isConnected) {
            try {
                await youtubeService.deleteVideo(cleanVideoId)
                deletedSomewhere = true
                messages.push(`Eliminado directamente en YouTube API (ID: ${cleanVideoId}).`)
            } catch (err: any) {
                console.warn('[SocialPublishService] Direct YouTube delete warning:', err.message)
            }
        }

        // 2. Also trigger n8n Webhook with action='delete' if Webhook URL is configured (since user connected YouTube in n8n Railway!)
        const webhookUrl = config.webhookUrl || process.env.SOCIAL_WEBHOOK_URL
        if (webhookUrl) {
            try {
                const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                if (config.webhookSecret) headers['X-Webhook-Secret'] = config.webhookSecret

                const deleteBody = JSON.stringify({
                    event: 'reel.delete',
                    action: 'delete',
                    youtubeVideoId: cleanVideoId,
                    youtubeUrl: `https://youtube.com/shorts/${cleanVideoId}`,
                    timestamp: new Date().toISOString()
                })

                const prodUrl = webhookUrl.replace('/webhook-test/', '/webhook/')
                const testUrl = webhookUrl.includes('/webhook-test/')
                    ? webhookUrl
                    : webhookUrl.replace('/webhook/', '/webhook-test/')

                let res = await fetch(prodUrl, {
                    method: 'POST',
                    headers,
                    body: deleteBody
                })
                if (!res.ok && prodUrl !== testUrl) {
                    res = await fetch(testUrl, {
                        method: 'POST',
                        headers,
                        body: deleteBody
                    })
                }

                if (res.ok) {
                    deletedSomewhere = true
                    messages.push(`Orden de eliminación enviada a tu Webhook n8n para el Short ID "${cleanVideoId}".`)
                }
            } catch (whErr: any) {
                console.warn('[SocialPublishService] Webhook delete warning:', whErr.message)
            }
        }

        if (params.publicationId) {
            this.removePublicationRecord(params.publicationId)
        }

        if (!deletedSomewhere) {
            throw new Error('No se pudo eliminar: conecta YouTube en RealsAI o asegúrate de tener activo tu Webhook de n8n.')
        }

        return {
            success: true,
            videoId: cleanVideoId,
            message: messages.join(' ')
        }
    }
}

export const socialPublishService = new SocialPublishService()
