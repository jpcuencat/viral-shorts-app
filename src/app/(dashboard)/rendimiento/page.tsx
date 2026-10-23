import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { getLatestInsights } from '@/lib/learning/insights'
import { RecomputeInsightsButton } from '@/components/performance/recompute-button'

export const dynamic = 'force-dynamic'

const PLATFORM_LABEL: Record<string, string> = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' }
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Intl.NumberFormat('es', { notation: v >= 10000 ? 'compact' : 'standard' }).format(v))

type Row = {
    id: string; platform: string; external_id: string; url: string | null; title: string | null; script_id: string | null
    published_at: string | null; views: number | null; likes: number | null; comments: number | null; shares: number | null; fetched_at: string | null
}

export default async function RendimientoPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('post_metrics').select('id, platform, external_id, url, title, script_id, published_at, views, likes, comments, shares, fetched_at')
        .order('published_at', { ascending: false, nullsFirst: false }).limit(500)
    const rows = (data || []) as Row[]
    const insights = user ? await getLatestInsights(supabase, user.id) : null

    // Agrupar por guion (o por título si no está vinculado) para ver cada video en todas las redes
    const groups = new Map<string, { title: string; publishedAt: string | null; linked: boolean; byPlatform: Record<string, Row> }>()
    for (const r of rows) {
        const key = r.script_id || `t:${(r.title || r.external_id).toLowerCase().slice(0, 50)}`
        const g = groups.get(key) || { title: r.title || r.external_id, publishedAt: r.published_at, linked: !!r.script_id, byPlatform: {} }
        g.byPlatform[r.platform] = r
        if (r.published_at && (!g.publishedAt || r.published_at < g.publishedAt)) g.publishedAt = r.published_at
        groups.set(key, g)
    }
    const videos = [...groups.values()].map(g => {
        const total = Object.values(g.byPlatform).reduce((s, r) => s + (r.views || 0), 0)
        const days = g.publishedAt ? Math.max(1, (Date.now() - Date.parse(g.publishedAt)) / 86400000) : 1
        return { ...g, total, perDay: Math.round(total / days) }
    }).sort((a, b) => b.perDay - a.perDay)

    const totals = Object.keys(PLATFORM_LABEL).map(p => ({
        p, views: rows.filter(r => r.platform === p).reduce((s, r) => s + (r.views || 0), 0), posts: rows.filter(r => r.platform === p).length,
        noData: rows.filter(r => r.platform === p).every(r => r.views === null),
    })).filter(t => t.posts > 0)
    const lastFetch = rows.map(r => r.fetched_at).filter(Boolean).sort().pop()

    const list = (title: string, items?: string[]) => items && items.length > 0 ? (
        <div>
            <p className="text-sm font-medium mb-1">{title}</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">{items.map((i, k) => <li key={k}>{i}</li>)}</ul>
        </div>
    ) : null

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Rendimiento</h1>
                    <p className="text-muted-foreground">
                        Vistas reales por red y lo que la app aprende de ellas.
                        {lastFetch ? ` Métricas actualizadas ${formatDistanceToNow(new Date(lastFetch), { addSuffix: true, locale: es })}.` : ' Aún no llegan métricas desde n8n.'}
                    </p>
                </div>
                <RecomputeInsightsButton />
            </div>

            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                {totals.map(t => (
                    <Card key={t.p}>
                        <CardHeader className="pb-2"><CardDescription>{PLATFORM_LABEL[t.p]}</CardDescription>
                            <CardTitle className="text-2xl">{t.noData ? '—' : fmt(t.views)}</CardTitle></CardHeader>
                        <CardContent className="text-xs text-muted-foreground">
                            {t.noData ? `${t.posts} publicaciones · vistas no disponibles (falta permiso de estadísticas en el token)` : `vistas en ${t.posts} publicaciones`}
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Lo que la app aprendió</CardTitle>
                    <CardDescription>
                        {insights
                            ? `Basado en ${insights.stats?.withMetrics ?? 0} videos · confianza ${insights.confidence} · ${formatDistanceToNow(new Date(insights.createdAt), { addSuffix: true, locale: es })}. Se aplica a tendencias, guiones y plan visual.`
                            : 'Todavía no hay lecciones. Se generan solas cuando hay al menos 3 videos con métricas.'}
                    </CardDescription>
                </CardHeader>
                {insights && (
                    <CardContent className="space-y-4">
                        {insights.summary && <p className="text-sm">{insights.summary}</p>}
                        <div className="grid gap-4 md:grid-cols-2">
                            {list('Temas que funcionan', insights.topics_that_work)}
                            {list('Temas que rinden poco', insights.topics_to_avoid)}
                            {list('Ganchos', insights.hook_patterns)}
                            {list('Títulos', insights.title_patterns)}
                            {list('Visual', insights.visual_lessons)}
                            {list('Por red', insights.platform_notes)}
                        </div>
                        {insights.stats?.categories?.length ? (
                            <div className="flex flex-wrap gap-2">
                                {insights.stats.categories.map(c => (
                                    <Badge key={c.name} variant="secondary">{c.name}: {fmt(c.avgViewsPerDay)} vistas/día · {c.videos} videos</Badge>
                                ))}
                            </div>
                        ) : null}
                    </CardContent>
                )}
            </Card>

            <Card>
                <CardHeader><CardTitle>Videos</CardTitle><CardDescription>Ordenados por vistas por día (todas las redes).</CardDescription></CardHeader>
                <CardContent className="overflow-x-auto">
                    {videos.length === 0 ? <p className="text-sm text-muted-foreground">Sin publicaciones registradas todavía.</p> : (
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-muted-foreground border-b">
                                <th className="py-2 pr-3">Video</th>
                                {Object.values(PLATFORM_LABEL).map(l => <th key={l} className="py-2 px-2 text-right">{l}</th>)}
                                <th className="py-2 px-2 text-right">Total</th><th className="py-2 pl-2 text-right">Vistas/día</th>
                            </tr></thead>
                            <tbody>
                                {videos.map((v, i) => (
                                    <tr key={i} className="border-b last:border-0 align-top">
                                        <td className="py-2 pr-3 max-w-md">
                                            <div className="font-medium line-clamp-2">{v.title}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {v.publishedAt ? formatDistanceToNow(new Date(v.publishedAt), { addSuffix: true, locale: es }) : ''}
                                                {!v.linked && ' · sin vincular a un guion'}
                                            </div>
                                        </td>
                                        {Object.keys(PLATFORM_LABEL).map(p => {
                                            const r = v.byPlatform[p]
                                            return <td key={p} className="py-2 px-2 text-right tabular-nums">
                                                {r ? (r.url ? <a className="underline-offset-2 hover:underline" href={r.url} target="_blank" rel="noreferrer">{fmt(r.views)}</a> : fmt(r.views)) : ''}
                                                {r && (r.likes || r.comments) ? <div className="text-xs text-muted-foreground">♥ {fmt(r.likes)} · 💬 {fmt(r.comments)}</div> : null}
                                            </td>
                                        })}
                                        <td className="py-2 px-2 text-right tabular-nums font-medium">{fmt(v.total)}</td>
                                        <td className="py-2 pl-2 text-right tabular-nums">{fmt(v.perDay)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
