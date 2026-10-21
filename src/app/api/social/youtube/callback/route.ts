import { NextResponse } from 'next/server'
import { youtubeService } from '@/services/youtube-service'

export async function GET(request: Request) {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const redirectUri = `${url.origin}/api/social/youtube/callback`

    if (!code) {
        return NextResponse.redirect(`${url.origin}/social?error=oauth_cancelled`)
    }

    try {
        await youtubeService.handleAuthCallback(code, redirectUri)
        return NextResponse.redirect(`${url.origin}/social?connected=youtube`)
    } catch (error: any) {
        console.error('[YouTube OAuth Callback] Error:', error)
        return NextResponse.redirect(`${url.origin}/social?error=${encodeURIComponent(error.message || 'oauth_failed')}`)
    }
}
