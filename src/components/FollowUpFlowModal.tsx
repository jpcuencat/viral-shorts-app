'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    GitBranchPlus,
    Sparkles,
    Loader2,
    FileText,
    Video,
    Check,
    Flame,
    Wand2,
} from 'lucide-react'
import {
    generateFollowUpIdeas,
    createFollowUpIdeaAndScript,
    FollowUpIdeaSuggestion,
} from '@/app/actions/follow-up-flow'
import { useGeneration } from '@/context/generation-context'
import { VisualGenerationMode } from './GenerateReelButton'

interface FollowUpFlowModalProps {
    sourceIdeaId: string
    sourceIdeaTitle?: string
    variant?: 'default' | 'outline' | 'secondary'
    buttonLabel?: string
}

export function FollowUpFlowModal({
    sourceIdeaId,
    sourceIdeaTitle = 'este Short',
    variant = 'secondary',
    buttonLabel = 'Crear Seguimiento (Parte 2)',
}: FollowUpFlowModalProps) {
    const router = useRouter()
    const { startGeneration } = useGeneration()

    const [open, setOpen] = useState(false)
    const [customAngle, setCustomAngle] = useState('')
    const [loadingSuggestions, setLoadingSuggestions] = useState(false)
    const [suggestions, setSuggestions] = useState<FollowUpIdeaSuggestion[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

    const [visualMode, setVisualMode] = useState<VisualGenerationMode>('hybrid')
    const [voiceId, setVoiceId] = useState<string>('es-EC-LuisNeural')
    const [customVideoSource, setCustomVideoSource] = useState('')
    const [processingAction, setProcessingAction] = useState<'script_only' | 'full_video' | null>(null)

    async function handleFetchSuggestions(forceRefresh = false) {
        if (suggestions.length > 0 && !forceRefresh) return
        setLoadingSuggestions(true)
        setSelectedIndex(null)
        try {
            const res = await generateFollowUpIdeas(sourceIdeaId, customAngle)
            if (res.error) {
                alert(res.error)
            } else if (res.data) {
                setSuggestions(res.data)
                if (res.data.length > 0) {
                    setSelectedIndex(0)
                }
            }
        } catch (err) {
            console.error(err)
            alert('Error generando ideas de seguimiento')
        } finally {
            setLoadingSuggestions(false)
        }
    }

    function handleOpenChange(nextOpen: boolean) {
        setOpen(nextOpen)
        if (nextOpen && suggestions.length === 0 && !loadingSuggestions) {
            handleFetchSuggestions(false)
        }
    }

    async function handleExecuteFlow(mode: 'script_only' | 'full_video') {
        if (selectedIndex === null || !suggestions[selectedIndex]) return
        const chosen = suggestions[selectedIndex]

        setProcessingAction(mode)
        try {
            const res = await createFollowUpIdeaAndScript(sourceIdeaId, chosen)
            if (!res.success || !res.scriptId) {
                alert(res.error || 'No se pudo crear el guion de seguimiento.')
                setProcessingAction(null)
                return
            }

            setOpen(false)
            setProcessingAction(null)

            if (mode === 'full_video') {
                // Trigger full Reel generation immediately and navigate to the new Reel Preview!
                startGeneration(res.scriptId, chosen.title, {
                    visualMode,
                    voiceId,
                    customVideoSource: customVideoSource.trim() || undefined,
                })
                router.push(`/scripts/${res.scriptId}?tab=reel`)
            } else {
                // Navigate to the new Script Editor so the user can review/edit first
                router.push(`/scripts/${res.scriptId}`)
            }
        } catch (err) {
            console.error(err)
            alert('Error ejecutando el flujo de seguimiento.')
            setProcessingAction(null)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button
                    variant={variant}
                    className="gap-2 border-violet-500/30 hover:border-violet-500/60"
                >
                    <GitBranchPlus className="h-4 w-4 text-violet-500" />
                    {buttonLabel}
                </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
                <DialogHeader className="min-w-0 pr-6">
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <GitBranchPlus className="h-5 w-5 shrink-0 text-violet-500" />
                        Crear Seguimiento / Parte 2 desde este Video
                    </DialogTitle>
                    <DialogDescription className="leading-relaxed">
                        Base actual: <strong className="text-foreground">{sourceIdeaTitle}</strong>. Genera nuevas ideas conectadas y ejecuta todo el flujo automático (Idea → Guion → Video 9:16).
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2 min-w-0">
                    {/* Buscador / Enfoque personalizado opcional */}
                    <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                        <Input
                            placeholder="Opcional: escribe qué ángulo quieres (ej. 'Multas si no voto', 'Errores que anulan la papeleta')..."
                            value={customAngle}
                            onChange={(e) => setCustomAngle(e.target.value)}
                            className="text-xs flex-1"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={loadingSuggestions || processingAction !== null}
                            onClick={() => handleFetchSuggestions(true)}
                            className="shrink-0 gap-1.5"
                        >
                            {loadingSuggestions ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Wand2 className="h-3.5 w-3.5 text-violet-500" />
                            )}
                            {suggestions.length > 0 ? 'Regenerar Ángulos' : 'Generar Ángulos'}
                        </Button>
                    </div>

                    {/* Lista de Ideas de Seguimiento sugeridas */}
                    {loadingSuggestions ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-3 border rounded-lg bg-muted/20">
                            <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
                            <p className="text-sm text-muted-foreground">
                                Diseñando 4 ángulos de seguimiento virales a partir de tu video...
                            </p>
                        </div>
                    ) : (
                        <div className="grid gap-2.5 max-h-[290px] overflow-y-auto pr-1">
                            {suggestions.map((item, idx) => {
                                const isSelected = selectedIndex === idx
                                return (
                                    <div
                                        key={idx}
                                        onClick={() => setSelectedIndex(idx)}
                                        className={`cursor-pointer rounded-lg border p-3 transition-all ${
                                            isSelected
                                                ? 'border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/30'
                                                : 'hover:border-muted-foreground/40 bg-card'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="space-y-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <Badge variant="secondary" className="text-[10px] font-semibold">
                                                        {item.angle_tag || `Seguimiento #${idx + 1}`}
                                                    </Badge>
                                                    <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-0.5">
                                                        <Flame className="h-3 w-3" />
                                                        {item.viral_score || 95}% Viral
                                                    </span>
                                                </div>
                                                <h4 className="text-sm font-semibold leading-snug">
                                                    {item.title}
                                                </h4>
                                                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                                                    {item.description}
                                                </p>
                                            </div>
                                            <div
                                                className={`h-5 w-5 shrink-0 rounded-full border flex items-center justify-center mt-0.5 ${
                                                    isSelected
                                                        ? 'bg-violet-600 border-violet-600 text-white'
                                                        : 'border-muted-foreground/40'
                                                }`}
                                            >
                                                {isSelected && <Check className="h-3 w-3" />}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* Configuración de Motor Visual y Voz para el flujo directo a Video */}
                    {selectedIndex !== null && suggestions[selectedIndex] && (
                        <div className="rounded-lg border p-3 bg-muted/30 space-y-2.5 min-w-0">
                            <Label className="text-xs font-semibold flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-pink-500" />
                                Motor Visual y Voz (para el flujo directo a Video):
                            </Label>
                            <div className="grid gap-2 sm:grid-cols-2 min-w-0">
                                <Select
                                    value={visualMode}
                                    onValueChange={(v) => setVisualMode(v as VisualGenerationMode)}
                                >
                                    <SelectTrigger className="w-full min-w-0 overflow-hidden [&_[data-slot=select-value]]:truncate h-8 text-xs">
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

                                <Select value={voiceId} onValueChange={setVoiceId}>
                                    <SelectTrigger className="w-full min-w-0 overflow-hidden [&_[data-slot=select-value]]:truncate h-8 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="es-EC-LuisNeural">
                                            🇪🇨 Luis (Ecuador - Masculina)
                                        </SelectItem>
                                        <SelectItem value="es-EC-AndreaNeural">
                                            🇪🇨 Andrea (Ecuador - Femenina)
                                        </SelectItem>
                                        <SelectItem value="es-CO-GonzaloNeural">
                                            🎙️ Gonzalo (LatAm Neutro)
                                        </SelectItem>
                                        <SelectItem value="es-MX-DaliaNeural">
                                            🎙️ Dalia (LatAm Expresiva)
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {(visualMode === 'real_video' || visualMode === 'hybrid') && (
                                <Input
                                    placeholder="Opcional: URL de YouTube para extraer escenas en movimiento (o vacío para búsqueda automática)"
                                    value={customVideoSource}
                                    onChange={(e) => setCustomVideoSource(e.target.value)}
                                    className="text-xs h-8"
                                />
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between pt-2">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={
                            selectedIndex === null ||
                            loadingSuggestions ||
                            processingAction !== null
                        }
                        onClick={() => handleExecuteFlow('script_only')}
                        className="w-full sm:w-auto text-xs"
                    >
                        {processingAction === 'script_only' ? (
                            <>
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                Creando Idea + Guion...
                            </>
                        ) : (
                            <>
                                <FileText className="mr-2 h-3.5 w-3.5" />
                                Solo Crear Idea + Guion
                            </>
                        )}
                    </Button>

                    <Button
                        type="button"
                        disabled={
                            selectedIndex === null ||
                            loadingSuggestions ||
                            processingAction !== null
                        }
                        onClick={() => handleExecuteFlow('full_video')}
                        className="w-full sm:w-auto bg-gradient-to-r from-pink-500 to-violet-600 hover:from-pink-600 hover:to-violet-700 text-white text-xs"
                    >
                        {processingAction === 'full_video' ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Creando Idea, Guion y Lanzando Video...
                            </>
                        ) : (
                            <>
                                <Video className="mr-2 h-4 w-4" />
                                Flujo Completo: Crear Idea + Guion + Video 9:16
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
