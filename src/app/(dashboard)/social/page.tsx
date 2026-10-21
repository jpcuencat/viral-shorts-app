'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Share2,
    CheckCircle2,
    AlertCircle,
    Save,
    Loader2,
    ExternalLink,
    Webhook,
    Video,
    Calendar,
    Trash2,
} from 'lucide-react'
import {
    getSocialDashboardData,
    saveSocialConfigAction,
    testWebhookAction,
    deleteYouTubeShortAction,
} from '@/app/actions/social-actions'
import { SocialConfig, PublicationRecord } from '@/services/social-publish-service'
import { toast } from 'sonner'

export default function SocialPublishingPage() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [testingWebhook, setTestingWebhook] = useState(false)
    const [deleteInput, setDeleteInput] = useState('')
    const [deletingVideo, setDeletingVideo] = useState(false)
    const [config, setConfig] = useState<SocialConfig>({
        tiktokPostMode: 'DIRECT_POST',
    })
    const [youtubeStatus, setYoutubeStatus] = useState<{
        hasClientSecret: boolean
        isConnected: boolean
    }>({ hasClientSecret: false, isConnected: false })
    const [publications, setPublications] = useState<PublicationRecord[]>([])

    async function loadData() {
        setLoading(true)
        try {
            const data = await getSocialDashboardData()
            setConfig({
                tiktokPostMode: 'DIRECT_POST',
                ...data.config,
            })
            setYoutubeStatus(data.youtubeStatus)
            setPublications(data.publications)
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadData()
    }, [])

    async function handleSave() {
        setSaving(true)
        try {
            const res = await saveSocialConfigAction(config)
            if (res.success) {
                toast.success('Configuración de redes sociales guardada correctamente.')
                if (res.youtubeStatus) setYoutubeStatus(res.youtubeStatus)
            } else {
                toast.error(res.error || 'Error guardando configuración')
            }
        } catch (err) {
            console.error(err)
            toast.error('Error guardando configuración')
        } finally {
            setSaving(false)
        }
    }

    async function handleTestWebhook() {
        setTestingWebhook(true)
        try {
            const res = await testWebhookAction(config.webhookUrl, config.webhookSecret)
            if (res.success) {
                toast.success('¡Prueba enviada con éxito! Revisa el nodo Webhook en tu n8n.')
            } else {
                toast.error(res.error || 'No se pudo conectar al Webhook de n8n.')
            }
        } catch (err: any) {
            toast.error(err.message || 'Error probando Webhook')
        } finally {
            setTestingWebhook(false)
        }
    }

    async function handleDeleteYouTubeShort(videoIdOrUrl: string, publicationId?: string, reelId?: string, scriptId?: string) {
        if (!videoIdOrUrl.trim()) {
            toast.error('Pega primero el enlace o ID del Short de YouTube que deseas eliminar.')
            return
        }
        setDeletingVideo(true)
        try {
            const res = await deleteYouTubeShortAction({
                videoIdOrUrl,
                publicationId,
                reelId,
                scriptId,
            })
            if (res.success) {
                toast.success(res.message || 'Short eliminado correctamente.')
                setDeleteInput('')
                await loadData()
            } else {
                toast.error(res.error || 'No se pudo eliminar el Short.')
            }
        } catch (err: any) {
            toast.error(err.message || 'Error eliminando el Short')
        } finally {
            setDeletingVideo(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8 pb-16">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2.5">
                        <Share2 className="h-7 w-7 text-emerald-500" />
                        Automatización de Redes Sociales
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Conecta tus cuentas de YouTube Shorts, TikTok, Instagram Reels o tu Webhook de Make/n8n para publicar y programar tus videos con un clic.
                    </p>
                </div>
                <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                >
                    {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Save className="h-4 w-4" />
                    )}
                    Guardar Credenciales
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* 1. YouTube Shorts */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base flex items-center gap-2">
                                ▶️ YouTube Shorts (API Oficial v3)
                            </CardTitle>
                            <Badge
                                variant={youtubeStatus.isConnected ? 'default' : 'outline'}
                                className={
                                    youtubeStatus.isConnected
                                        ? 'bg-emerald-600 text-white'
                                        : 'text-amber-600 border-amber-400'
                                }
                            >
                                {youtubeStatus.isConnected ? 'Canal Conectado' : 'Sin Autorizar'}
                            </Badge>
                        </div>
                        <CardDescription className="text-xs">
                            Soporta subida directa en 9:16, etiquetas SEO y programación automática de fecha/hora (`publishAt`).
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Google OAuth Client ID</Label>
                            <Input
                                placeholder="Ej: 123456789-abc.apps.googleusercontent.com"
                                value={config.youtubeClientId || ''}
                                onChange={(e) =>
                                    setConfig({ ...config, youtubeClientId: e.target.value })
                                }
                                className="text-xs"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Google OAuth Client Secret</Label>
                            <Input
                                type="password"
                                placeholder="GOCSPX-..."
                                value={config.youtubeClientSecret || ''}
                                onChange={(e) =>
                                    setConfig({ ...config, youtubeClientSecret: e.target.value })
                                }
                                className="text-xs"
                            />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            En Google Cloud Console agrega como URI de redirección autorizada:{' '}
                            <code className="bg-muted px-1 py-0.5 rounded">
                                http://localhost:3000/api/social/youtube/callback
                            </code>
                        </p>
                        <div className="pt-1 flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs"
                                asChild
                            >
                                <a href="/api/social/youtube/auth">
                                    🔗 Autorizar Canal de YouTube con Google
                                </a>
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* 2. TikTok Content Posting API */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base flex items-center gap-2">
                                🎵 TikTok (Content Posting API v2)
                            </CardTitle>
                            <Badge
                                variant={config.tiktokAccessToken ? 'default' : 'outline'}
                                className={
                                    config.tiktokAccessToken
                                        ? 'bg-emerald-600 text-white'
                                        : 'text-muted-foreground'
                                }
                            >
                                {config.tiktokAccessToken ? 'Configurado' : 'Opcional'}
                            </Badge>
                        </div>
                        <CardDescription className="text-xs">
                            Envía el MP4 directamente al feed de TikTok o como borrador a la bandeja de tu app móvil.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-1">
                            <Label className="text-xs">TikTok OAuth Access Token</Label>
                            <Input
                                type="password"
                                placeholder="act.123456789..."
                                value={config.tiktokAccessToken || ''}
                                onChange={(e) =>
                                    setConfig({ ...config, tiktokAccessToken: e.target.value })
                                }
                                className="text-xs"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Modo de Envío a TikTok</Label>
                            <Select
                                value={config.tiktokPostMode || 'DIRECT_POST'}
                                onValueChange={(v) =>
                                    setConfig({
                                        ...config,
                                        tiktokPostMode: v as 'DIRECT_POST' | 'MEDIA_UPLOAD',
                                    })
                                }
                            >
                                <SelectTrigger className="w-full h-9 text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="DIRECT_POST">
                                        🚀 Publicar Directo en el Feed de TikTok
                                    </SelectItem>
                                    <SelectItem value="MEDIA_UPLOAD">
                                        📱 Enviar a Bandeja de Entrada de mi App TikTok (Draft)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </CardContent>
                </Card>

                {/* 3. Instagram Reels (Meta Graph API) */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base flex items-center gap-2">
                                📸 Instagram Reels (Meta Graph API)
                            </CardTitle>
                            <Badge
                                variant={
                                    config.instagramUserId && config.instagramAccessToken
                                        ? 'default'
                                        : 'outline'
                                }
                                className={
                                    config.instagramUserId && config.instagramAccessToken
                                        ? 'bg-emerald-600 text-white'
                                        : 'text-muted-foreground'
                                }
                            >
                                {config.instagramUserId && config.instagramAccessToken
                                    ? 'Configurado'
                                    : 'Opcional'}
                            </Badge>
                        </div>
                        <CardDescription className="text-xs">
                            Publica directamente en cuentas de Instagram Profesional / Creator mediante contenedores REELS.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Instagram Business / Creator User ID</Label>
                            <Input
                                placeholder="Ej: 17841400000000000"
                                value={config.instagramUserId || ''}
                                onChange={(e) =>
                                    setConfig({ ...config, instagramUserId: e.target.value })
                                }
                                className="text-xs"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Meta Graph Access Token</Label>
                            <Input
                                type="password"
                                placeholder="EAAG..."
                                value={config.instagramAccessToken || ''}
                                onChange={(e) =>
                                    setConfig({ ...config, instagramAccessToken: e.target.value })
                                }
                                className="text-xs"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">
                                URL Pública Base (Requerido por Meta para leer el MP4)
                            </Label>
                            <Input
                                placeholder="Ej: https://mi-tunel.ngrok-free.app"
                                value={config.publicBaseUrl || ''}
                                onChange={(e) =>
                                    setConfig({ ...config, publicBaseUrl: e.target.value })
                                }
                                className="text-xs"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* 4. Webhook Multi-Red (n8n / Make.com / Zapier) */}
                <Card className="border-emerald-500/30">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Webhook className="h-4 w-4 text-emerald-500" />
                                Webhook Multi-Red (Make.com / n8n / Zapier)
                            </CardTitle>
                            <Badge
                                variant={config.webhookUrl ? 'default' : 'outline'}
                                className={
                                    config.webhookUrl
                                        ? 'bg-emerald-600 text-white'
                                        : 'text-muted-foreground'
                                }
                            >
                                {config.webhookUrl ? 'Activo' : 'Recomendado'}
                            </Badge>
                        </div>
                        <CardDescription className="text-xs">
                            Dispara un flujo automático con el video, título, descripción y hashtags para publicar simultáneamente en TikTok, Instagram, Facebook, YouTube y X.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Webhook URL (POST)</Label>
                            <Input
                                placeholder="http://localhost:5678/webhook/realsai-publish"
                                value={config.webhookUrl || ''}
                                onChange={(e) =>
                                    setConfig({ ...config, webhookUrl: e.target.value })
                                }
                                className="text-xs"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">
                                Token Secreto Opcional (`X-Webhook-Secret`)
                            </Label>
                            <Input
                                type="password"
                                placeholder="Opcional"
                                value={config.webhookSecret || ''}
                                onChange={(e) =>
                                    setConfig({ ...config, webhookSecret: e.target.value })
                                }
                                className="text-xs"
                            />
                        </div>
                        <div className="pt-1 flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={testingWebhook}
                                onClick={handleTestWebhook}
                                className="flex-1 text-xs"
                            >
                                {testingWebhook ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                ) : null}
                                ⚡ Enviar Prueba a n8n
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                asChild
                                className="flex-1 text-xs"
                            >
                                <a href="/n8n-multi-red-workflow.json" download>
                                    📥 Descargar Plantilla n8n (.json)
                                </a>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Eliminar Short de Prueba o Publicado en YouTube */}
            <Card className="border-red-500/30 bg-red-500/[0.02]">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2 text-red-600 dark:text-red-400">
                        <Trash2 className="h-4 w-4" />
                        Eliminar un Short de YouTube (Prueba o Publicado)
                    </CardTitle>
                    <CardDescription className="text-xs">
                        Pega el enlace del Short que se subió de prueba (ej.{' '}
                        <code className="bg-muted px-1 py-0.5 rounded">
                            https://youtube.com/shorts/XXXXXXXXXXX
                        </code>{' '}
                        o su ID de 11 letras) para eliminarlo de tu canal de YouTube a través de n8n o la API directa.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <Input
                            placeholder="Pega aquí el link de YouTube Shorts (https://youtube.com/shorts/...) o Video ID"
                            value={deleteInput}
                            onChange={(e) => setDeleteInput(e.target.value)}
                            className="text-xs flex-1"
                        />
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={deletingVideo || !deleteInput.trim()}
                            onClick={() => handleDeleteYouTubeShort(deleteInput)}
                            className="gap-1.5 shrink-0"
                        >
                            {deletingVideo ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Eliminar Short de YouTube
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Historial de Publicaciones y Programaciones */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-violet-500" />
                        Historial y Cola de Publicaciones
                    </CardTitle>
                    <CardDescription>
                        Registro de todos los Shorts enviados o programados desde el Reel Preview.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {publications.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground text-sm">
                            Aún no has publicado ningún Short. Abre cualquier guion con video generado y haz clic en{' '}
                            <strong>"Publicar / Programar en Redes"</strong>.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {publications.map((pub) => (
                                <div
                                    key={pub.id}
                                    className="rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                                >
                                    <div className="space-y-1.5 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Link
                                                href={`/scripts/${pub.scriptId}?tab=reel`}
                                                className="font-semibold text-sm hover:underline flex items-center gap-1.5"
                                            >
                                                <Video className="h-4 w-4 text-pink-500 shrink-0" />
                                                {pub.title}
                                            </Link>
                                            <span className="text-xs text-muted-foreground">
                                                • {new Date(pub.createdAt).toLocaleString('es-EC')}
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                            {pub.results.map((r, i) => (
                                                <div
                                                    key={i}
                                                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border bg-muted/30"
                                                >
                                                    {r.status === 'failed' ? (
                                                        <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                                                    ) : (
                                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                                    )}
                                                    <span className="font-semibold uppercase">
                                                        {r.platform}:
                                                    </span>
                                                    <span className="text-muted-foreground">
                                                        {r.status === 'scheduled'
                                                            ? 'Programado'
                                                            : r.status === 'published'
                                                              ? 'Publicado'
                                                              : 'Error'}
                                                    </span>
                                                    {r.externalIdOrUrl &&
                                                        r.externalIdOrUrl.startsWith('http') && (
                                                            <a
                                                                href={r.externalIdOrUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="text-emerald-600 hover:underline inline-flex items-center gap-0.5 ml-1"
                                                            >
                                                                Abrir <ExternalLink className="h-3 w-3" />
                                                            </a>
                                                        )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <Button variant="outline" size="sm" asChild className="shrink-0">
                                        <Link href={`/scripts/${pub.scriptId}?tab=reel`}>
                                            Ver Short
                                        </Link>
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
