import { NextResponse } from 'next/server'
import { authenticateN8n, upsertMetrics, type MetricItem } from '@/lib/n8n/callbacks'
import { refreshInsightsIfStale, generateChannelInsights } from '@/lib/learning/insights'

/**
 * n8n envía aquí las métricas de todas las publicaciones (cada pocas horas).
 * Body: { items: MetricItem[], recompute?: boolean }
 * Tras guardarlas, la app actualiza las lecciones del canal (en segundo plano).
 */
export async function POST(req: Request) {
    const auth = await authenticateN8n(req)
    if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const body = await req.json().catch(() => null) as { items?: MetricItem[]; recompute?: boolean } | null
    const items = Array.isArray(body?.items) ? body!.items : []
    if (items.length === 0) return NextResponse.json({ error: 'Sin items' }, { status: 400 })
    const { db, userId } = auth
    const result = await upsertMetrics(db, userId, items.slice(0, 1000))
    console.log(`[n8n] Métricas: ${result.saved}/${result.received} guardadas, ${result.linked} vinculadas a guiones${result.errors.length ? `, errores: ${result.errors.slice(0, 3).join(' | ')}` : ''}`)
    // Aprender de los nuevos datos sin hacer esperar a n8n
    void (body?.recompute ? generateChannelInsights(db, userId).catch(e => console.warn('[Learning]', e?.message)) : refreshInsightsIfStale(db, userId, 6))
    return NextResponse.json({ ok: true, ...result })
}
