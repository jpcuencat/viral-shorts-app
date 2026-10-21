import fs from 'fs'
import path from 'path'
import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'

const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl'
]
const CREDENTIALS_PATH = path.join(process.cwd(), 'client_secret.json')
const TOKEN_PATH = path.join(process.cwd(), 'tokens.json')

export interface YouTubeUploadOptions {
    videoPath: string
    title: string
    description: string
    tags?: string[]
    privacyStatus?: 'public' | 'unlisted' | 'private'
    publishAt?: string // ISO 8601 timestamp (e.g. 2026-10-20T23:00:00.000Z)
}

class YouTubeService {
    private oauth2Client: OAuth2Client | null = null

    constructor() {
        this.init()
    }

    public init(customRedirectUri?: string) {
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            this.oauth2Client = null
            return
        }

        try {
            const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8')
            const credentials = JSON.parse(content)
            const config = credentials.installed || credentials.web
            if (!config) return

            const { client_secret, client_id, redirect_uris } = config
            const redirectUri =
                customRedirectUri ||
                process.env.YOUTUBE_REDIRECT_URI ||
                'http://localhost:3000/api/social/youtube/callback' ||
                (redirect_uris ? redirect_uris[0] : 'http://localhost')

            this.oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri)

            if (fs.existsSync(TOKEN_PATH)) {
                const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'))
                this.oauth2Client.setCredentials(tokens)
            }
        } catch (error) {
            console.error('[YouTubeService] Error loading credentials:', error)
        }
    }

    public getStatus(): { hasClientSecret: boolean; isConnected: boolean } {
        const hasClientSecret = fs.existsSync(CREDENTIALS_PATH)
        let isConnected = false
        if (hasClientSecret && fs.existsSync(TOKEN_PATH)) {
            try {
                const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'))
                isConnected = Boolean(tokens.refresh_token || tokens.access_token)
            } catch {
                isConnected = false
            }
        }
        return { hasClientSecret, isConnected }
    }

    public saveClientCredentials(clientId: string, clientSecret: string, redirectUri = 'http://localhost:3000/api/social/youtube/callback') {
        const payload = {
            web: {
                client_id: clientId.trim(),
                client_secret: clientSecret.trim(),
                redirect_uris: [redirectUri],
                auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                token_uri: 'https://oauth2.googleapis.com/token'
            }
        }
        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(payload, null, 2), 'utf-8')
        this.init(redirectUri)
    }

    public getAuthUrl(redirectUri = 'http://localhost:3000/api/social/youtube/callback'): string | null {
        this.init(redirectUri)
        if (!this.oauth2Client) return null
        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: SCOPES
        })
    }

    public async handleAuthCallback(code: string, redirectUri = 'http://localhost:3000/api/social/youtube/callback'): Promise<boolean> {
        this.init(redirectUri)
        if (!this.oauth2Client) throw new Error('OAuth client not initialized')
        const { tokens } = await this.oauth2Client.getToken(code)
        this.oauth2Client.setCredentials(tokens)
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8')
        return true
    }

    /**
     * Upload a video to YouTube Shorts with support for Public/Unlisted/Private and Scheduled publishing (`publishAt`).
     */
    async uploadVideo(
        videoPathOrOptions: string | YouTubeUploadOptions,
        titleArg?: string,
        descriptionArg?: string,
        tagsArg: string[] = []
    ): Promise<string | null> {
        this.init()
        if (!this.oauth2Client) {
            throw new Error('YouTube OAuth no está configurado. Conecta tu cuenta en la sección Redes Sociales.')
        }

        const tokens = this.oauth2Client.credentials
        if (!tokens || (!tokens.refresh_token && !tokens.access_token)) {
            throw new Error('No hay sesión activa de YouTube. Haz clic en "Autorizar Canal de YouTube" en Redes Sociales.')
        }

        const opts: YouTubeUploadOptions =
            typeof videoPathOrOptions === 'string'
                ? {
                      videoPath: videoPathOrOptions,
                      title: titleArg || 'Viral Short',
                      description: descriptionArg || '',
                      tags: tagsArg,
                      privacyStatus: 'public'
                  }
                : videoPathOrOptions

        if (!fs.existsSync(opts.videoPath)) {
            throw new Error(`El archivo de video no existe en disco: ${opts.videoPath}`)
        }

        const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client })

        // YouTube API rule: if `publishAt` is provided, `privacyStatus` MUST be 'private'
        const isScheduled = Boolean(opts.publishAt && new Date(opts.publishAt).getTime() > Date.now())
        const effectivePrivacy = isScheduled ? 'private' : (opts.privacyStatus || 'public')

        const cleanTitle = opts.title.includes('#Shorts')
            ? opts.title.slice(0, 100)
            : `${opts.title.slice(0, 91)} #Shorts`

        const cleanDescription = opts.description.includes('#Shorts')
            ? opts.description.slice(0, 4900)
            : `${opts.description.slice(0, 4850)}\n\n#Shorts`

        const statusBody: Record<string, any> = {
            privacyStatus: effectivePrivacy,
            selfDeclaredMadeForKids: false,
            containsSyntheticMedia: false
        }
        if (isScheduled && opts.publishAt) {
            statusBody.publishAt = new Date(opts.publishAt).toISOString()
        }

        console.log(`[YouTubeService] Uploading Short: "${cleanTitle}" (privacy: ${effectivePrivacy}${isScheduled ? `, scheduled: ${statusBody.publishAt}` : ''})...`)

        const res = await youtube.videos.insert({
            part: ['snippet', 'status'],
            requestBody: {
                snippet: {
                    title: cleanTitle,
                    description: cleanDescription,
                    tags: opts.tags || ['shorts', 'viral', 'ecuador'],
                    categoryId: '24'
                },
                status: statusBody
            },
            media: {
                body: fs.createReadStream(opts.videoPath)
            }
        })

        console.log(`[YouTubeService] Upload Complete! ID: ${res.data.id}`)
        return res.data.id || null
    }

    /**
     * Extracts the 11-character YouTube Video ID from any Shorts URL, watch URL, youtu.be link, or raw ID
     */
    public extractVideoId(input: string): string {
        const trimmed = (input || '').trim()
        const shortsMatch = trimmed.match(/\/shorts\/([a-zA-Z0-9_-]{11})/)
        if (shortsMatch) return shortsMatch[1]

        const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
        if (watchMatch) return watchMatch[1]

        const shortUrlMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
        if (shortUrlMatch) return shortUrlMatch[1]

        const studioMatch = trimmed.match(/\/video\/([a-zA-Z0-9_-]{11})/)
        if (studioMatch) return studioMatch[1]

        return trimmed
    }

    /**
     * Deletes a video/Short from YouTube by its Video ID or URL
     */
    async deleteVideo(videoIdOrUrl: string): Promise<string> {
        this.init()
        if (!this.oauth2Client) {
            throw new Error('YouTube OAuth directo no está configurado en local.')
        }

        const tokens = this.oauth2Client.credentials
        if (!tokens || (!tokens.refresh_token && !tokens.access_token)) {
            throw new Error('No hay sesión activa de YouTube en local.')
        }

        const cleanId = this.extractVideoId(videoIdOrUrl)
        if (!cleanId) {
            throw new Error('ID o URL de video de YouTube inválido.')
        }

        const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client })
        await youtube.videos.delete({ id: cleanId })
        console.log(`[YouTubeService] Video Deleted! ID: ${cleanId}`)
        return cleanId
    }
}

export const youtubeService = new YouTubeService()
