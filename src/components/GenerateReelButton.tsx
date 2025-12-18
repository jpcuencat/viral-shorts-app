'use client'

import { Button } from '@/components/ui/button'
import { Video, Loader2 } from 'lucide-react'
import { useGeneration } from '@/context/generation-context'

interface GenerateReelButtonProps {
    scriptId: string
    ideaTitle?: string
}

export function GenerateReelButton({ scriptId, ideaTitle = 'Viral Short' }: GenerateReelButtonProps) {
    const { isGenerating, startGeneration } = useGeneration()

    // If currently generating, we might want to disable the button or show a spinner inside it
    // But since it's global, we should check if THIS script is the one generating?
    // For simplicity v1: just disable if any generation is happening.

    return (
        <div className="flex flex-col gap-2">
            <Button
                onClick={() => startGeneration(scriptId, ideaTitle)}
                disabled={isGenerating}
                className="w-full bg-gradient-to-r from-pink-500 to-violet-600 hover:from-pink-600 hover:to-violet-700 text-white border-0 shadow-lg shadow-pink-500/20"
            >
                {isGenerating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                    <Video className="mr-2 h-4 w-4" />
                )}
                {isGenerating ? 'Generating...' : 'Generate Reel'}
            </Button>
        </div>
    )
}
