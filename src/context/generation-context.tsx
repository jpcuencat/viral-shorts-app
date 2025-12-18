'use client'

import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react'
import { toast } from 'sonner'
import { generateReel } from '@/app/actions/generate-reel'
import { useRouter } from 'next/navigation'

interface GenerationContextType {
    isGenerating: boolean
    progress: number
    activeIdeaTitle: string | null
    startGeneration: (scriptId: string, title?: string) => Promise<void>
}

const GenerationContext = createContext<GenerationContextType | undefined>(undefined)

export function GenerationProvider({ children }: { children: ReactNode }) {
    const [isGenerating, setIsGenerating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [activeIdeaTitle, setActiveIdeaTitle] = useState<string | null>(null)
    const router = useRouter()

    const startGeneration = useCallback(async (scriptId: string, title: string = 'Reel') => {
        if (isGenerating) return

        setIsGenerating(true)
        setActiveIdeaTitle(title)
        setProgress(10)

        toast.info(`Starting generation for: ${title}`, {
            description: "You can continue navigating. We'll notify you when it's done."
        })

        // Simulate progress for UX since we don't have real stream yet
        const interval = setInterval(() => {
            setProgress((prev) => {
                if (prev >= 90) return prev
                return prev + Math.random() * 5
            })
        }, 800)

        try {
            const result = await generateReel(scriptId)

            clearInterval(interval)
            setProgress(100)

            if (result.success) {
                toast.success("Reel Generated Successfully!", {
                    description: `${title} is ready to view.`,
                    action: {
                        label: "View Reel",
                        onClick: () => window.location.href = `/scripts/${scriptId}`
                    }
                })
            } else {
                toast.error("Generation Failed", {
                    description: result.error || "Unknown error occurred."
                })
            }
        } catch (error) {
            clearInterval(interval)
            toast.error("Generation Error", {
                description: "Something went wrong."
            })
            console.error(error)
        } finally {
            // Keep the success state visible for a moment
            setTimeout(() => {
                setIsGenerating(false)
                setProgress(0)
                setActiveIdeaTitle(null)
            }, 2000)

            // Refresh data
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
