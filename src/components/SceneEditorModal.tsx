'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Layers,
    Loader2,
    RefreshCw,
    Image as ImageIcon,
    Film,
    Link2,
    Upload,
    X,
} from 'lucide-react'
import {
    getReelSceneManifest,
    replaceSingleReelScene,
    SceneManifestEntry,
} from '@/app/actions/generate-reel'
import { toast } from 'sonner'

/** Convierte "75", "1:15" o "01:02:05" a segundos. Devuelve null si el formato no es válido. */
function parseTimeToSeconds(raw: string): number | null {
    const value = raw.trim()
    if (!value) return 0
    if (!/^\d+(:\d{1,2}){0,2}$/.test(value)) return null
    return value.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0)
}

function isHttpUrl(raw: string): boolean {
    try {
        const u = new URL(raw.trim())
        return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
        return false
    }
}

interface SceneEditorModalProps {
    reelId: string
    scriptId: string
}

export function SceneEditorModal({ reelId, scriptId }: SceneEditorModalProps) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [scenes, setScenes] = useState<SceneManifestEntry[]>([])
    const [replacingIdx, setReplacingIdx] = useState<number | null>(null)
    const [customPrompts, setCustomPrompts] = useState<Record<number, string>>({})
    const [customUrls, setCustomUrls] = useState<Record<number, string>>({})
    const [customStarts, setCustomStarts] = useState<Record<number, string>>({})
    const [uploads, setUploads] = useState<Record<number, { publicPath: string; name: string }>>({})
    const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)

    async function handleUpload(sceneIndex: number, file: File | undefined) {
        if (!file) return
        setUploadingIdx(sceneIndex)
        try {
            const formData = new FormData()
            formData.append('file', file)
            const res = await fetch('/api/upload-video', { method: 'POST', body: formData })
            const data = await res.json().catch(() => ({}))
            if (res.ok && data.success && data.publicPath) {
                setUploads((prev) => ({ ...prev, [sceneIndex]: { publicPath: data.publicPath, name: file.name } }))
                toast.success(`Video cargado para la escena #${sceneIndex + 1}`)
            } else {
                toast.error(data.error || 'No se pudo subir el video')
            }
        } catch (err) {
            console.error(err)
            toast.error('Error subiendo el video')
        } finally {
            setUploadingIdx(null)
        }
    }

    function clearUpload(sceneIndex: number) {
        setUploads((prev) => {
            const next = { ...prev }
            delete next[sceneIndex]
            return next
        })
    }

    async function loadManifest() {
        setLoading(true)
        try {
            const data = await getReelSceneManifest(reelId)
            setScenes(data)
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    function handleOpenChange(nextOpen: boolean) {
        setOpen(nextOpen)
        if (nextOpen) {
            loadManifest()
        }
    }

    async function handleReplaceScene(sceneIndex: number, mode: 'ai_images' | 'real_video') {
        const uploaded = uploads[sceneIndex]
        const customVideoUrl = uploaded ? '' : (customUrls[sceneIndex] || '').trim()
        let customStartSec = 0
        if (mode === 'real_video' && (uploaded || customVideoUrl)) {
            if (customVideoUrl && !isHttpUrl(customVideoUrl)) {
                toast.error('La URL del video debe empezar con http:// o https://')
                return
            }
            const parsedStart = parseTimeToSeconds(customStarts[sceneIndex] || '')
            if (parsedStart === null) {
                toast.error('El inicio debe ser en segundos (75) o minutos:segundos (1:15).')
                return
            }
            customStartSec = parsedStart
        }

        setReplacingIdx(sceneIndex)
        try {
            const customPromptOrQuery = customPrompts[sceneIndex] || ''
            const res = await replaceSingleReelScene(reelId, scriptId, sceneIndex, {
                visualMode: mode,
                customPromptOrQuery,
                ...(mode === 'real_video' && uploaded
                    ? { customVideoFile: uploaded.publicPath, customStartSec }
                    : mode === 'real_video' && customVideoUrl
                    ? { customVideoUrl, customStartSec }
                    : {}),
            })

            if (res.success) {
                toast.success(`¡Escena #${sceneIndex + 1} actualizada y video re-ensamblado!`)
                await loadManifest()
                router.refresh()
            } else {
                toast.error(res.error || 'No se pudo reemplazar la escena')
            }
        } catch (err) {
            console.error(err)
            toast.error('Error actualizando la escena')
        } finally {
            setReplacingIdx(null)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <Layers className="h-4 w-4 text-amber-500" />
                    Editar Escenas (1x1)
                </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[660px] max-h-[88vh] overflow-y-auto">
                <DialogHeader className="min-w-0 pr-6">
                    <DialogTitle className="flex items-center gap-2">
                        <Layers className="h-5 w-5 text-amber-500 shrink-0" />
                        Editor de Escenas Individuales
                    </DialogTitle>
                    <DialogDescription className="leading-relaxed">
                        Si una escena específica del Reel no te convence, reemplázala aquí por una nueva imagen IA, un clip buscado automáticamente o un video tuyo indicado por URL. El video se re-ensambla sin perder las demás escenas ni volver a generar el audio.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                        <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
                        <p className="text-sm text-muted-foreground">Cargando desglose de escenas...</p>
                    </div>
                ) : scenes.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
                        <p className="text-sm font-medium">
                            Este Reel fue generado antes de activar el manifiesto por escena.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Haz clic en <strong>Generate Reel</strong> una vez más para que todas sus escenas queden indexadas y editables individualmente.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3 py-2 min-w-0">
                        {scenes.map((scene, idx) => {
                            const isVideoClip = /\.(mp4|webm|mov)$/i.test(scene.imagePath)
                            const isBusy = replacingIdx === idx
                            const uploaded = uploads[idx]
                            const hasUrl = Boolean((customUrls[idx] || '').trim())
                            const hasOwnVideo = Boolean(uploaded) || hasUrl
                            const busyAny = replacingIdx !== null || uploadingIdx !== null

                            return (
                                <div
                                    key={idx}
                                    className="rounded-lg border p-3.5 bg-card space-y-2.5 min-w-0"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="secondary" className="text-xs font-bold">
                                                Escena #{idx + 1}
                                            </Badge>
                                            <Badge
                                                variant="outline"
                                                className={
                                                    isVideoClip
                                                        ? 'border-blue-500/40 text-blue-600 text-[10px]'
                                                        : 'border-pink-500/40 text-pink-600 text-[10px]'
                                                }
                                            >
                                                {isVideoClip ? '🎬 Video en Movimiento' : '🎨 Imagen IA 9:16'}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                ⏱ {scene.duration.toFixed(1)}s
                                            </span>
                                        </div>
                                        <span className="text-[11px] text-muted-foreground truncate max-w-[240px]">
                                            {scene.sourceLabel}
                                        </span>
                                    </div>

                                    <p className="text-xs font-medium text-foreground bg-muted/40 p-2 rounded">
                                        "{scene.text}"
                                    </p>

                                    <div className="flex flex-col sm:flex-row gap-2 pt-1 min-w-0">
                                        <Input
                                            placeholder="Opcional: describe cómo quieres la nueva escena (en inglés o español)..."
                                            value={customPrompts[idx] || ''}
                                            onChange={(e) =>
                                                setCustomPrompts((prev) => ({
                                                    ...prev,
                                                    [idx]: e.target.value,
                                                }))
                                            }
                                            disabled={busyAny}
                                            className="text-xs h-8 flex-1"
                                        />
                                        <div className="flex gap-1.5 shrink-0">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={busyAny}
                                                onClick={() => handleReplaceScene(idx, 'ai_images')}
                                                className="h-8 text-xs gap-1"
                                            >
                                                {isBusy ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <ImageIcon className="h-3.5 w-3.5 text-pink-500" />
                                                )}
                                                Nueva IA 9:16
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={busyAny}
                                                onClick={() => handleReplaceScene(idx, 'real_video')}
                                                className="h-8 text-xs gap-1"
                                            >
                                                {isBusy ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <Film className="h-3.5 w-3.5 text-blue-500" />
                                                )}
                                                {uploaded ? 'Usar video subido' : hasUrl ? 'Usar video de la URL' : 'Nuevo Clip Real'}
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                                        {uploaded ? (
                                            <div className="flex flex-1 min-w-0 items-center gap-2 rounded-md border border-blue-500/40 bg-blue-500/5 px-2 h-8 text-xs">
                                                <Film className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                                                <span className="truncate flex-1">{uploaded.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => clearUpload(idx)}
                                                    disabled={busyAny}
                                                    className="text-muted-foreground hover:text-foreground"
                                                    aria-label="Quitar video subido"
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="relative flex-1 min-w-0">
                                                <Link2 className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                                <Input
                                                    type="url"
                                                    inputMode="url"
                                                    placeholder="Opcional: URL de un video limpio (YouTube u otra web)"
                                                    value={customUrls[idx] || ''}
                                                    onChange={(e) =>
                                                        setCustomUrls((prev) => ({ ...prev, [idx]: e.target.value }))
                                                    }
                                                    disabled={busyAny}
                                                    className="text-xs h-8 pl-7"
                                                />
                                            </div>
                                        )}
                                        <label
                                            className={`inline-flex items-center justify-center gap-1 rounded-md border h-8 px-2.5 text-xs shrink-0 ${
                                                busyAny ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:bg-muted'
                                            }`}
                                            title="Subir un video limpio desde tu equipo (mp4, mov, webm)"
                                        >
                                            {uploadingIdx === idx ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Upload className="h-3.5 w-3.5 text-blue-500" />
                                            )}
                                            {uploadingIdx === idx ? 'Subiendo...' : 'Subir video'}
                                            <input
                                                type="file"
                                                accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
                                                className="hidden"
                                                disabled={busyAny}
                                                onChange={(e) => {
                                                    handleUpload(idx, e.target.files?.[0])
                                                    e.target.value = ''
                                                }}
                                            />
                                        </label>
                                        <Input
                                            placeholder="Inicio (1:15)"
                                            value={customStarts[idx] || ''}
                                            onChange={(e) =>
                                                setCustomStarts((prev) => ({ ...prev, [idx]: e.target.value }))
                                            }
                                            disabled={busyAny || !hasOwnVideo}
                                            className="text-xs h-8 sm:w-28"
                                            title="Segundo del video desde el que se toma el tramo (por defecto 0:00)"
                                        />
                                    </div>
                                    {hasOwnVideo && (
                                        <p className="text-[11px] text-muted-foreground">
                                            Se tomarán ~{Math.ceil(scene.duration)}s del {uploaded ? 'video subido' : 'video de la URL'} desde el inicio indicado. Al usar tu propio video no se aplica el filtro automático de textos y logos: asegúrate de que el tramo esté limpio.
                                        </p>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
