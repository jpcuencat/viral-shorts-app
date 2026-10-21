'use client'

import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react'
import { toast } from 'sonner'
import { generateReel, GenerateReelOptions } from '@/app/actions/generate-reel'
import { useRouter } from 'next/navigation'

interface GenerationContextType {
    isGenerating: boolean
    progress: number
    activeIdeaTitle: string | null
    startGeneration: (scriptId: string, title?: string, options?: GenerateReelOptions) => Promise<void>
}

const GenerationContext = createContext<GenerationContextType | undefined>(undefined)

export function GenerationProvider({ children }: { children: ReactNode }) {
    const [isGenerating, setIsGenerating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [activeIdeaTitle, setActiveIdeaTitle] = useState<string | null>(null)
    const router = useRouter()

    const startGeneration = useCallback(async (scriptId: string, title: string = 'Reel', options?: GenerateReelOptions) => {
        if (isGenerating) return

        setIsGenerating(true)
        setActiveIdeaTitle(title)
        setProgress(10)

        const modeLabel =
            options?.visualMode === 'real_video'
                ? '100% Video en Movimiento Real'
                : options?.visualMode === 'ai_images'
                    ? '100% Storyboard IA (SD3)'
                    : 'Híbrido (Video Real + IA SD3)'

        toast.info(`Generando Reel (${modeLabel}): ${title}`, {
            description: "Todo lo generado se guardará en tu Bóveda (public/ai-vault) para reutilizarse."
        })

        const interval = setInterval(() => {
            setProgress((prev) => {
                if (prev >= 90) return prev
                return prev + Math.random() * 5
            })
        }, 800)

        try {
            const result = await generateReel(scriptId, options)

            clearInterval(interval)
            setProgress(100)

            if (result.success) {
                toast.success("¡Reel Generado con Éxito!", {
                    description: `${title} está listo para reproducirse.`,
                    action: {
                        label: "Ver Reel",
                        onClick: () => window.location.href = `/scripts/${scriptId}`
                    }
                })
            } else {
                toast.error("Error en la generación", {
                    description: result.error || "Ocurrió un error desconocido."
                })
            }
        } catch (error) {
            clearInterval(interval)
            toast.error("Error de Generación", {
                description: "Revisa la consola del servidor para más detalles."
            })
            console.error(error)
        } finally {
            setTimeout(() => {
                setIsGenerating(false)
                setProgress(0)
                setActiveIdeaTitle(null)
            }, 2000)

            router.refresh()
        }
    }, [isGenerating, router])

    return (
        <GenerationContext.Provider value={{ isGenerating, progress, activeIdeaTitle, startGeneration }}>
            {children}
        </GenerationContext.Provider>
    )
}

export function useGeneration() {
    const context = useContext(GenerationContext)
    if (context === undefined) {
        throw new Error('useGeneration must be used within a GenerationProvider')
    }
    return context
}
