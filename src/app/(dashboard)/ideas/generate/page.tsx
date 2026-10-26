'use client'

import { useState, useEffect, useMemo } from 'react'
import { generateIdeas, saveGeneratedIdeas } from '@/app/actions/generate-ideas'
import type { TrendIdea } from '@/lib/ideas/idea-engine'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Loader2, Sparkles, Check, Flame, ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'

type Cat = { id: string; name: string; slug: string; parent_id: string | null; sort_order: number }
const ALL = '__ALL__'

function ageText(h: number) {
    if (!Number.isFinite(h)) return '—'
    if (h < 1) return 'hace minutos'
    if (h < 48) return `hace ${Math.round(h)} h`
    return `hace ${Math.round(h / 24)} días`
}

export default function GenerateIdeasPage() {
    const [cats, setCats] = useState<Cat[]>([])
    const [parentId, setParentId] = useState<string>('OPEN_TRENDS')
    const [subId, setSubId] = useState<string>(ALL)
    const [ideas, setIdeas] = useState<TrendIdea[]>([])
    const [discarded, setDiscarded] = useState<{ title: string; reason: string }[]>([])
    const [selected, setSelected] = useState<number[]>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [elapsed, setElapsed] = useState(0)
    const supabase = createClient()
    const router = useRouter()

    useEffect(() => {
        supabase.from('categories').select('id, name, slug, parent_id, sort_order').then(({ data }) => setCats((data || []) as Cat[]))
    }, [])
    // Desde el Dashboard (Refresh Trends): búsqueda automática en modo abierto; nada se guarda sin elegirlo
    useEffect(() => {
        if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('auto') === '1') {
            window.history.replaceState(null, '', '/ideas/generate')
            handleGenerate()
        }
    }, [])
    useEffect(() => {
        if (!loading) return
        setElapsed(0)
        const t = setInterval(() => setElapsed(s => s + 1), 1000)
        return () => clearInterval(t)
    }, [loading])

    const parents = useMemo(() => cats.filter(c => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order), [cats])
    const subs = useMemo(() => cats.filter(c => c.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order), [cats, parentId])
    const target = parentId === 'OPEN_TRENDS' ? 'OPEN_TRENDS' : subId !== ALL ? subId : parentId
    const isTrendsBucket = parents.find(p => p.id === parentId)?.slug === 'tendencias'

    async function handleGenerate() {
        setLoading(true); setIdeas([]); setDiscarded([]); setSelected([])
        try {
            const res = await generateIdeas(isTrendsBucket ? 'OPEN_TRENDS' : target)
            if (res.error) alert(res.error)
            setIdeas(res.data || [])
            setDiscarded(res.discarded || [])
        } catch (e) {
            console.error(e)
            alert('No se pudieron generar ideas')
        } finally {
            setLoading(false)
        }
    }

    async function handleSave() {
        setSaving(true)
        const res = await saveGeneratedIdeas(selected.map(i => ideas[i]))
        if (res.error) { alert(res.error); setSaving(false); return }
        router.push('/ideas')
        router.refresh()
    }

    const toggle = (i: number) => setSelected(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
    const step = elapsed < 12 ? 'Leyendo noticias y tendencias de las últimas horas…' : elapsed < 35 ? 'Proponiendo ideas con ángulo original…' : 'Verificando que cada idea siga vigente…'

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-8 pb-32">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Sparkles className="text-yellow-500" /> Generador de ideas en tendencia
                </h1>
                <p className="text-muted-foreground">
                    Usa solo noticias de las últimas 48 horas, Google Trends de varios países y X. Cada idea se verifica con los
                    titulares más recientes antes de mostrártela; si el tema ya pasó o no se puede confirmar, se descarta.
                </p>
            </div>

            <div className="flex flex-wrap items-end gap-4 p-4 border rounded-lg bg-card">
                <div className="space-y-2 flex-1 min-w-[220px]">
                    <Label>Categoría</Label>
                    <Select value={parentId} onValueChange={v => { setParentId(v); setSubId(ALL) }}>
                        <SelectTrigger><SelectValue placeholder="Elige…" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="OPEN_TRENDS" className="font-semibold text-orange-600">🔥 Todo lo que es tendencia ahora</SelectItem>
                            {parents.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                {parentId !== 'OPEN_TRENDS' && subs.length > 0 && (
                    <div className="space-y-2 flex-1 min-w-[220px]">
                        <Label>Subcategoría</Label>
                        <Select value={subId} onValueChange={setSubId}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL}>Todas</SelectItem>
                                {subs.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <Button onClick={handleGenerate} disabled={loading} size="lg" className="min-w-[170px]">
                    {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{elapsed}s</> : <><Flame className="mr-2 h-4 w-4 text-orange-400" />Generar ideas</>}
                </Button>
            </div>

            {loading && <p className="text-sm text-muted-foreground text-center">{step} (suele tardar 30–60 s)</p>}

            {ideas.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2">
                    {ideas.map((idea, i) => {
                        const on = selected.includes(i)
                        return (
                            <Card key={i} onClick={() => toggle(i)}
                                className={`flex flex-col cursor-pointer border-2 transition-all ${on ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-transparent hover:border-border'}`}>
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start gap-2">
                                        <CardTitle className="text-lg leading-tight">{idea.title}</CardTitle>
                                        <div className={`h-6 w-6 shrink-0 rounded-full border-2 flex items-center justify-center ${on ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30'}`}>
                                            {on && <Check className="h-4 w-4" />}
                                        </div>
                                    </div>
                                    <div className="text-xs text-muted-foreground">{idea.categoryLabel}{idea.angle ? ` · Ángulo: ${idea.angle}` : ''}</div>
                                </CardHeader>
                                <CardContent className="flex-1 flex flex-col gap-3">
                                    <p className="text-sm text-muted-foreground">{idea.description}</p>
                                    {idea.whyNow && <p className="text-xs"><span className="font-medium">Por qué hoy:</span> {idea.whyNow}</p>}
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        <span className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-medium" title={`Potencial ${idea.scoreParts.potential} · Frescura ${idea.scoreParts.freshness} · Demanda ${idea.scoreParts.demand} · Cobertura ${idea.scoreParts.coverage}`}>
                                            🚀 {idea.viralScore}/100
                                        </span>
                                        <span className="bg-sky-100 text-sky-800 px-2 py-1 rounded">📰 {ageText(idea.newestAgeHours)} · {idea.headlines.length} titulares</span>
                                        <span className={`px-2 py-1 rounded ${idea.demand.youtube >= 5 ? 'bg-orange-100 text-orange-800' : 'bg-muted'}`}>
                                            🔎 {idea.demand.youtube >= 5 ? 'Se busca mucho' : idea.demand.youtube > 0 ? 'Se busca' : 'Poca búsqueda aún'}
                                        </span>
                                        {idea.status === 'actualizada' && <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded">✎ Actualizada con lo último</span>}
                                        <span className="bg-muted px-2 py-1 rounded">⏱ {idea.estimatedDuration}s</span>
                                    </div>
                                    {idea.headlines[0] && (
                                        <a href={idea.headlines[0].url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                                            className="text-xs text-muted-foreground hover:underline flex items-start gap-1">
                                            <ExternalLink className="h-3 w-3 mt-0.5 shrink-0" />{idea.headlines[0].title}
                                        </a>
                                    )}
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {!loading && discarded.length > 0 && (
                <details className="text-sm text-muted-foreground">
                    <summary className="cursor-pointer">{discarded.length} ideas descartadas en la verificación</summary>
                    <ul className="mt-2 space-y-1 list-disc pl-5">{discarded.map((d, i) => <li key={i}><span className="font-medium">{d.title}</span> — {d.reason}</li>)}</ul>
                </details>
            )}

            {!loading && ideas.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">Elige una categoría (o todo lo que es tendencia) y pulsa <strong>Generar ideas</strong>.</div>
            )}

            {selected.length > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-md p-4 pointer-events-none">
                    <div className="bg-foreground text-background rounded-full shadow-2xl p-4 flex items-center justify-between gap-4 pointer-events-auto">
                        <div className="pl-2 font-medium">{selected.length} idea{selected.length !== 1 && 's'} seleccionada{selected.length !== 1 && 's'}</div>
                        <Button onClick={handleSave} disabled={saving} className="rounded-full" size="sm">
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Guardar
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
