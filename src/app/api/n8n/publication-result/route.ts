import { NextResponse } from 'next/server'
import { authenticateN8n, upsertMetrics, PLATFORMS, type Platform } from '@/lib/n8n/callbacks'

/**
 * n8n avisa aquí cada publicación hecha (YouTube, Instagram, Facebook...).
 * Body: { reelId, scriptId?, title?, platform, externalId, url? }
 * Se registra en post_metrics (para luego pedir sus métricas) y en el historial de publicaciones.
 */
export async function POST(req: Request) {
    const auth = await authenticateN8n(req)
    if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const body = await req.json().catch(() => null) as Record<string, any> | null
    if (!body?.platform || !body?.externalId || !PLATFORMS.includes(body.platform)) {
        return NextResponse.json({ error: 'Faltan platform/externalId' }, { status: 400 })
    }
    const { db, userId } = auth
    const result = await upsertMetrics(db, userId, [{
        platform: body.platform as Platform,
        externalId: String(body.externalId),
        url: body.url,
        title: body.title,
        reelId: body.reelId,
        scriptId: body.scriptId,
        publishedAt: body.publishedAt || new Date().toISOString(),
    }])

    // Añadir el resultado al historial de la publicación más reciente de ese reel
    if (body.reelId) {
        const { data: pub } = await db.from('publications').select('id, results').eq('user_id', userId)
            .eq('reel_id', body.reelId).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (pub) {
            const results = Array.isArray(pub.results) ? pub.results : []
            const entry = { platform: body.platform, success: true, externalId: String(body.externalId), url: body.url || null, at: new Date().toISOString() }
            const next = [...results.filter((r: any) => !(r?.platform === body.platform && r?.externalId === entry.externalId)), entry]
            await db.from('publications').update({ results: next }).eq('id', pub.id)
        }
    }
    console.log(`[n8n] Publicación registrada: ${body.platform} ${body.externalId} (vinculada: ${result.linked > 0})`)
    return NextResponse.json({ ok: true, ...result })
}
