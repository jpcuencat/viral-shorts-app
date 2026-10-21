'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Send,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Calendar,
    ExternalLink,
    Settings,
    Sparkles,
} from 'lucide-react'
import {
    getSocialDashboardData,
    publishReelToSocialsAction,
} from '@/app/actions/social-actions'
import { SocialPlatform, PublicationRecord } from '@/services/social-publish-service'
import { toast } from 'sonner'

interface PublishReelModalProps {
    reelId: string
    scriptId: string
    videoUrl: string
    defaultTitle: string
    defaultDescription: string
    defaultHashtags?: string[]
    youtubeId?: string | null
}

export function PublishReelModal({
    reelId,
    scriptId,
    videoUrl,
    defaultTitle,
    defaultDescription,
    defaultHashtags = ['#Shorts', '#Ecuador', '#Viral'],
    youtubeId,
}: PublishReelModalProps) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [title, setTitle] = useState(defaultTitle)
    const [description, setDescription] = useState(defaultDescription)
    const [hashtagsText, setHashtagsText] = useState(
        defaultHashtags.length > 0 ? defaultHashtags.join(' ') : '#Shorts #Ecuador #Viral'
    )

    const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatform[]>(['webhook'])
    const [privacyStatus, setPrivacyStatus] = useState<'public' | 'unlisted' | 'private'>('public')
    const [scheduleMode, setScheduleMode] = useState<'now' | 'scheduled'>('now')
    const [scheduledDateTime, setScheduledDateTime] = useState<string>('')

    const [statusInfo, setStatusInfo] = useState<{ webhookConfigured: boolean }>({
        webhookConfigured: false,
    })

    const [publishing, setPublishing] = useState(false)
    const [lastResults, setLastResults] = useState<PublicationRecord['results'] | null>(null)

    useEffect(() => {
        if (!open) return
        getSocialDashboardData().then((data) => {
            setStatusInfo({ webhookConfigured: Boolean(data.config.webhookUrl) })
        })
    }, [open])

    function togglePlatform(p: SocialPlatform) {
        setSelectedPlatforms((prev) =>
            prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
        )
    }

    function applyEcuadorPeakPreset(hour24: number, addDays = 0) {
        const now = new Date()
        now.setDate(now.getDate() + addDays)
        now.setHours(hour24, 0, 0, 0)
        if (now.getTime() <= Date.now()) {
            now.setDate(now.getDate() + 1)
        }
        const pad = (n: number) => String(n).padStart(2, '0')
        const localIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
        setScheduleMode('scheduled')
        setScheduledDateTime(localIso)
    }

    async function handlePublish() {
        if (selectedPlatforms.length === 0) {
            toast.error('Selecciona al menos una red social para publicar.')
            return
        }

        setPublishing(true)
        setLastResults(null)

        try {
            const tags = hashtagsText
                .split(/[\s,]+/)
                .map((t) => t.trim())
                .filter(Boolean)

            const scheduledIso =
                scheduleMode === 'scheduled' && scheduledDateTime
                    ? new Date(scheduledDateTime).toISOString()
                    : undefined

            const res = await publishReelToSocialsAction({
                reelId,
                scriptId,
                videoUrl,
                title: title.trim() || defaultTitle,
                description: description.trim(),
                hashtags: tags,
                platforms: selectedPlatforms,
                privacyStatus,
                scheduledAt: scheduledIso,
            })

            setLastResults(res.record.results)

            if (res.success) {
                toast.success(
                    scheduleMode === 'scheduled'
                        ? '¡Short programado con éxito!'
                        : '¡Short publicado en las redes seleccionadas!'
                )
                router.refresh()
            } else {
                toast.error('No se pudo enviar a n8n. Revisa la URL del webhook en Redes Sociales.')
            }
        } catch (err: any) {
            console.error(err)
            toast.error(err.message || 'Error durante la publicación')
        } finally {
            setPublishing(false)
        }
    }

    const platformOptions: {
        id: SocialPlatform
        name: string
        subtitle: string
        ready: boolean
    }[] = [
        {
            id: 'webhook',
            name: '⚡ n8n Multi-Red (YouTube y demás redes)',
            subtitle: statusInfo.webhookConfigured
                ? 'Webhook listo para envío simultáneo'
                : 'Configura URL de Webhook en Redes',
            ready: statusInfo.webhookConfigured,
        },
    ]

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white border-0 shadow-md gap-2">
                    <Send className="h-4 w-4" />
                    {youtubeId ? 'Publicado (Volver a Publicar)' : 'Publicar / Programar en Redes'}
                </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
                <DialogHeader className="min-w-0 pr-6">
                    <DialogTitle className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                            <Send className="h-5 w-5 text-emerald-500 shrink-0" />
                            Publicar / Programar Short en Redes Sociales
                        </span>
                        <Button variant="ghost" size="sm" asChild className="text-xs h-7">
                            <Link href="/social">
                                <Settings className="h-3.5 w-3.5 mr-1" />
                                Configurar Cuentas
                            </Link>
                        </Button>
                    </DialogTitle>
                    <DialogDescription className="leading-relaxed">
                        Publica inmediatamente o deja programado tu video 9:16 con metadatos SEO. El envío va a tu flujo de n8n, que lo publica en tus canales.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2 min-w-0">
                    {/* 1. Selección de Redes */}
                    <div className="space-y-2 min-w-0">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            1. Redes de Destino
                        </Label>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {platformOptions.map((p) => {
                                const isChecked = selectedPlatforms.includes(p.id)
                                return (
                                    <div
                                        key={p.id}
                                        onClick={() => togglePlatform(p.id)}
                                        className={`cursor-pointer rounded-lg border p-2.5 transition-all flex items-start justify-between gap-2 ${
                                            isChecked
                                                ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                                                : 'hover:border-muted-foreground/40 bg-card'
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <div className="text-xs font-semibold">{p.name}</div>
                                            <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                                <span
                                                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                                                        p.ready ? 'bg-emerald-500' : 'bg-amber-500'
                                                    }`}
                                                />
                                                <span className="truncate">{p.subtitle}</span>
                                            </div>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => {}}
                                            className="mt-1 accent-emerald-600"
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* 2. Metadatos SEO (Título, Descripción, Hashtags) */}
                    <div className="space-y-3 rounded-lg border p-3.5 bg-muted/20 min-w-0">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Título del Short / Caption Principal</Label>
                            <Input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="text-xs"
                                maxLength={100}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs">Descripción SEO</Label>
                            <Textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={2}
                                className="text-xs resize-none"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs">Hashtags Virales</Label>
                            <Input
                                value={hashtagsText}
                                onChange={(e) => setHashtagsText(e.target.value)}
                                className="text-xs font-mono"
                                placeholder="#Shorts #Ecuador #Viral"
                            />
                        </div>
                    </div>

                    {/* 3. Visibilidad y Programación Horaria (Hora Ecuador) */}
                    <div className="grid gap-3 sm:grid-cols-2 min-w-0">
                        <div className="space-y-1.5 min-w-0">
                            <Label className="text-xs">Modo de Lanzamiento</Label>
                            <Select
                                value={scheduleMode}
                                onValueChange={(v) => setScheduleMode(v as 'now' | 'scheduled')}
                            >
                                <SelectTrigger className="w-full h-9 text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="now">🚀 Publicar Ahora Mismo</SelectItem>
                                    <SelectItem value="scheduled">
                                        📅 Programar Fecha y Hora (Hora Pico EC)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5 min-w-0">
                            <Label className="text-xs">Visibilidad</Label>
                            <Select
                                value={privacyStatus}
                                onValueChange={(v) =>
                                    setPrivacyStatus(v as 'public' | 'unlisted' | 'private')
                                }
                            >
                                <SelectTrigger className="w-full h-9 text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="public">🌍 Público (Para Todo el Mundo)</SelectItem>
                                    <SelectItem value="unlisted">🔗 No Listado (Solo con enlace)</SelectItem>
                                    <SelectItem value="private">🔒 Privado (Borrador)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {scheduleMode === 'scheduled' && (
                        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2.5 min-w-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <Label className="text-xs font-semibold flex items-center gap-1.5">
                                    <Calendar className="h-3.5 w-3.5 text-violet-500" />
                                    Fecha y Hora Programada (Ecuador UTC-5)
                                </Label>
                                <div className="flex flex-wrap gap-1">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[10px] px-2"
                                        onClick={() => applyEcuadorPeakPreset(12, 0)}
                                    >
                                        ⚡ Mediodía (12:00)
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[10px] px-2"
                                        onClick={() => applyEcuadorPeakPreset(19, 0)}
                                    >
                                        🔥 Noche Pico EC (19:00)
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[10px] px-2"
                                        onClick={() => applyEcuadorPeakPreset(8, 1)}
                                    >
                                        ☀️ Mañana (08:00)
                                    </Button>
                                </div>
                            </div>
                            <Input
                                type="datetime-local"
                                value={scheduledDateTime}
                                onChange={(e) => setScheduledDateTime(e.target.value)}
                                className="text-xs h-8"
                            />
                        </div>
                    )}

                    {/* Resultados de la publicación */}
                    {lastResults && (
                        <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
                            <div className="text-xs font-semibold">Resultado de Publicación:</div>
                            {lastResults.map((r, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-start justify-between gap-2 text-xs p-2 rounded bg-background border"
                                >
                                    <div className="flex items-start gap-2 min-w-0">
                                        {r.status === 'failed' ? (
                                            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                                        ) : (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                                        )}
                                        <div className="min-w-0">
                                            <span className="font-semibold uppercase mr-1.5">
                                                [{r.platform}]
                                            </span>
                                            <span className="text-muted-foreground break-words">
                                                {r.message}
                                            </span>
                                        </div>
                                    </div>
                                    {r.externalIdOrUrl && r.externalIdOrUrl.startsWith('http') && (
                                        <a
                                            href={r.externalIdOrUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-emerald-600 hover:underline flex items-center gap-1 shrink-0 font-medium"
                                        >
                                            Ver <ExternalLink className="h-3 w-3" />
                                        </a>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cerrar
                    </Button>
                    <Button
                        onClick={handlePublish}
                        disabled={publishing || selectedPlatforms.length === 0}
                        className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
                    >
                        {publishing ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Publicando en Redes...
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 h-4 w-4" />
                                {scheduleMode === 'scheduled'
                                    ? 'Programar Publicación'
                                    : 'Publicar Ahora'}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
