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
} from 'lucide-react'
import {
    getReelSceneManifest,
    replaceSingleReelScene,
    SceneManifestEntry,
} from '@/app/actions/generate-reel'
import { toast } from 'sonner'

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
        setReplacingIdx(sceneIndex)
        try {
            const customPromptOrQuery = customPrompts[sceneIndex] || ''
            const res = await replaceSingleReelScene(reelId, scriptId, sceneIndex, {
                visualMode: mode,
                customPromptOrQuery,
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
                        Si una escena específica del Reel no te convence, reemplázala aquí por una nueva imagen IA o clip en movimiento y el video se re-ensamblará en segundos sin perder las demás escenas ni volver a generar el audio.
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
                                            disabled={replacingIdx !== null}
                                            className="text-xs h-8 flex-1"
                                        />
                                        <div className="flex gap-1.5 shrink-0">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={replacingIdx !== null}
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
                                                disabled={replacingIdx !== null}
                                                onClick={() => handleReplaceScene(idx, 'real_video')}
                                                className="h-8 text-xs gap-1"
                                            >
                                                {isBusy ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <Film className="h-3.5 w-3.5 text-blue-500" />
                                                )}
                                                Nuevo Clip Real
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
