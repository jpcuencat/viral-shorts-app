'use client'

import { useState, useRef } from 'react'
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Video, Loader2, Upload, Sparkles, Film, Link as LinkIcon, CheckCircle2 } from 'lucide-react'
import { useGeneration } from '@/context/generation-context'

export type VisualGenerationMode = 'hybrid' | 'real_video' | 'ai_images'

interface GenerateReelButtonProps {
    scriptId: string
    ideaTitle?: string
}

export function GenerateReelButton({ scriptId, ideaTitle = 'Viral Short' }: GenerateReelButtonProps) {
    const { isScriptBusy, startGeneration } = useGeneration()
    // Solo se bloquea si ESTE guion ya tiene una generación en cola o en curso (los demás pueden encolarse)
    const isGenerating = isScriptBusy(scriptId)
    const [open, setOpen] = useState(false)
    const [visualMode, setVisualMode] = useState<VisualGenerationMode>('hybrid')
    const [voiceId, setVoiceId] = useState<string>('es-EC-LuisNeural')
    const [customVideoSource, setCustomVideoSource] = useState<string>('')
    const [uploading, setUploading] = useState(false)
    const [uploadedName, setUploadedName] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return

        setUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)

            const res = await fetch('/api/upload-video', {
                method: 'POST',
                body: formData,
            })
            const data = await res.json()
            if (data.success && data.publicPath) {
                setCustomVideoSource(data.publicPath)
                setUploadedName(file.name)
                if (visualMode === 'ai_images') {
                    setVisualMode('real_video')
                }
            } else {
                alert(data.error || 'No se pudo subir el video')
            }
        } catch (err) {
            console.error(err)
            alert('Error subiendo el archivo de video')
        } finally {
            setUploading(false)
        }
    }

    function handleStart() {
        setOpen(false)
        startGeneration(scriptId, ideaTitle, {
            visualMode,
            voiceId,
            customVideoSource: customVideoSource.trim() || undefined,
        })
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    disabled={isGenerating}
                    className="bg-gradient-to-r from-pink-500 to-violet-600 hover:from-pink-600 hover:to-violet-700 text-white border-0 shadow-lg shadow-pink-500/20"
                >
                    {isGenerating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <Video className="mr-2 h-4 w-4" />
                    )}
                    {isGenerating ? 'Generando...' : 'Generate Reel'}
                </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[520px] overflow-hidden">
                <DialogHeader className="min-w-0 pr-6">
                    <DialogTitle className="flex items-center gap-2">
                        <Film className="h-5 w-5 shrink-0 text-pink-500" />
                        Configurar Producción del Short
                    </DialogTitle>
                    <DialogDescription className="leading-relaxed">
                        Elige cómo generar los visuales, la voz del narrador y si deseas usar un video propio. Todo se guarda en tu <strong>Bóveda (`public/ai-vault`)</strong>.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2 min-w-0">
                    {/* 1. Modo Visual */}
                    <div className="space-y-1.5 min-w-0">
                        <Label>1. Motor Visual de Escenas</Label>
                        <Select
                            value={visualMode}
                            onValueChange={(v) => setVisualMode(v as VisualGenerationMode)}
                        >
                            <SelectTrigger className="w-full min-w-0 overflow-hidden [&_[data-slot=select-value]]:truncate">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ai_images">
                                    🎨 100% Imágenes IA (sin video real)
                                </SelectItem>
                                <SelectItem value="hybrid">
                                    🧠 Automático (Recomendado: video real y tarjetas en noticias, IA en temas atemporales)
                                </SelectItem>
                                <SelectItem value="real_video">
                                    🎬 100% Video en Movimiento Real (Video Propio / YouTube HD)
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            {visualMode === 'ai_images' && 'Solo imágenes generadas con IA. No busca video real: no recomendado para noticias.'}
                            {visualMode === 'hybrid' && 'Noticias: busca metraje real en YouTube (motor v4) y usa tarjetas informativas, nunca imágenes IA. Temas atemporales: imágenes IA y clips reales según la escena.'}
                            {visualMode === 'real_video' && 'Usa exclusivamente clips de video real en movimiento para cada escena (ideal cuando subes un video propio o pegas un link).'}
                        </p>
                    </div>

                    {/* 2. Selector de Voz / Narrador */}
                    <div className="space-y-1.5 min-w-0">
                        <Label>2. Voz del Narrador (Neural TTS)</Label>
                        <Select value={voiceId} onValueChange={setVoiceId}>
                            <SelectTrigger className="w-full min-w-0 overflow-hidden [&_[data-slot=select-value]]:truncate">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="es-EC-LuisNeural">
                                    🇪🇨 Luis (Ecuador - Masculina Dinámica / Noticias & Fútbol)
                                </SelectItem>
                                <SelectItem value="es-EC-AndreaNeural">
                                    🇪🇨 Andrea (Ecuador - Femenina Clara / Storytelling)
                                </SelectItem>
                                <SelectItem value="es-CO-GonzaloNeural">
                                    🎙️ Gonzalo (LatAm Neutro - Masculina Enérgica)
                                </SelectItem>
                                <SelectItem value="es-MX-DaliaNeural">
                                    🎙️ Dalia (LatAm - Femenina Expresiva)
                                </SelectItem>
                                <SelectItem value="es-MX-JorgeNeural">
                                    🎙️ Jorge (LatAm - Masculina Profunda / Documental)
                                </SelectItem>
                                <SelectItem value="es-ES-AlvaroNeural">
                                    🇪🇸 Álvaro (España - Masculina Rápida)
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* 3. Video Propio (Opcional: Subir MP4 o Pegar Link de YouTube) */}
                    <div className="space-y-3 rounded-lg border p-3.5 bg-muted/30 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                            <Label className="text-sm font-semibold flex items-center gap-1.5">
                                <LinkIcon className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                                3. Video Propio (Opcional)
                            </Label>
                            <span className="text-[11px] text-muted-foreground">
                                Si lo dejas vacío, busca automático
                            </span>
                        </div>

                        <div className="space-y-2 min-w-0">
                            <Input
                                placeholder="Pega URL de YouTube (https://youtu.be/...) o sube un .mp4 abajo"
                                value={customVideoSource}
                                onChange={(e) => {
                                    setCustomVideoSource(e.target.value)
                                    setUploadedName(null)
                                }}
                                className="text-xs w-full"
                            />

                            <div className="flex items-center gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="video/mp4,video/webm,video/quicktime"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={uploading}
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full text-xs"
                                >
                                    {uploading ? (
                                        <>
                                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                            Subiendo tu video...
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="mr-2 h-3.5 w-3.5" />
                                            Subir Video Propio (.mp4) desde mi PC
                                        </>
                                    )}
                                </Button>
                            </div>

                            {uploadedName && (
                                <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium pt-1 truncate">
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">Video cargado: {uploadedName}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleStart}
                        disabled={isGenerating || uploading}
                        className="bg-gradient-to-r from-pink-500 to-violet-600 hover:from-pink-600 hover:to-violet-700 text-white"
                    >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Iniciar Renderizado 9:16
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
