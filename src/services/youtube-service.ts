import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// Scopes for YouTube Upload
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'client_secret.json');

const TOKEN_PATH = path.join(process.cwd(), 'tokens.json');

class YouTubeService {
    private oauth2Client: OAuth2Client | null = null;

    constructor() {
        this.init();
    }

    private init() {
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            console.warn('[YouTubeService] client_secret.json not found. Auto-upload disabled.');
            return;
        }

        try {
            const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
            const credentials = JSON.parse(content);
            const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

            this.oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris ? redirect_uris[0] : 'http://localhost');

            // Check for saved tokens
            if (fs.existsSync(TOKEN_PATH)) {
                const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
                this.oauth2Client.setCredentials(tokens);
                console.log('[YouTubeService] Authenticated with tokens.json');
            } else {
                console.warn('[YouTubeService] tokens.json not found. Run "node scripts/auth-youtube.js" to authorize.');
            }

        } catch (error) {
            console.error('[YouTubeService] Error loading credentials', error);
        }
    }

    /**
     * Upload a video to YouTube
     * Returns the YouTube Video ID or null if failed/not configured.
     */
    async uploadVideo(videoPath: string, title: string, description: string, tags: string[] = []): Promise<string | null> {
        if (!this.oauth2Client) {
            console.log('[YouTubeService] Skipping upload: OAuth not configured.');
            return null;
        }

        const tokens = this.oauth2Client.credentials;
        if (!tokens || !tokens.refresh_token && !tokens.access_token) {
            console.log('[YouTubeService] Skipping upload: No valid tokens.');
            return null;
        }

        try {
            const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });

            console.log(`[YouTubeService] Uploading: ${title}...`);

            const fileSize = fs.statSync(videoPath).size;

            const res = await youtube.videos.insert({
                part: ['snippet', 'status'],
                requestBody: {
                    snippet: {
                        title: title.slice(0, 100), // Max 100 chars
                        description: description.slice(0, 5000) + '\n\n#Shorts',
                        tags: tags,
                        categoryId: '24' // Entertainment
                    },
                    status: {
                        privacyStatus: 'private', // Default to private for safety
                        selfDeclaredMadeForKids: false
                    }
                },
                media: {
                    body: fs.createReadStream(videoPath)
                }
            });

            console.log(`[YouTubeService] Upload Complete! ID: ${res.data.id}`);
            return res.data.id || null;

        } catch (error: any) {
            console.error('[YouTubeService] Upload Failed:', error.message);
            return null;
        }
    }
}

export const youtubeService = new YouTubeService();
