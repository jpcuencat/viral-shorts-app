import { NextResponse } from 'next/server'
import { youtubeService } from '@/services/youtube-service'

export async function GET(request: Request) {
    const url = new URL(request.url)
    const redirectUri = `${url.origin}/api/social/youtube/callback`
    const authUrl = youtubeService.getAuthUrl(redirectUri)

    if (!authUrl) {
        return NextResponse.redirect(`${url.origin}/social?error=missing_youtube_credentials`)
    }

    return NextResponse.redirect(authUrl)
}
