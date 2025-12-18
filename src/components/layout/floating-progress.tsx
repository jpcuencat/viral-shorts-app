'use client'

import { useGeneration } from "@/context/generation-context"
import { Loader2, Video } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { AnimatePresence, motion } from "framer-motion"

export function FloatingProgress() {
    const { isGenerating, progress, activeIdeaTitle } = useGeneration()

    if (!isGenerating) return null

    return (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-2xl shadow-2xl p-4 animate-in slide-in-from-bottom-5 overflow-hidden">
            {/* Ambient Background Effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-pink-500/10 to-violet-600/10 pointer-events-none" />

            <div className="relative z-10">
                <div className="flex items-center gap-3 mb-3">
                    <div className="relative h-10 w-10 flex-shrink-0">
                        <div className="absolute inset-0 bg-pink-500 rounded-full blur opacity-40 animate-pulse"></div>
                        <div className="relative h-full w-full bg-slate-800 rounded-full flex items-center justify-center border border-slate-600">
                            <Loader2 className="h-5 w-5 text-pink-500 animate-spin" />
                        </div>
                    </div>

                    <div className="flex-1 overflow-hidden">
                        <h4 className="text-sm font-bold bg-gradient-to-r from-pink-400 to-violet-400 bg-clip-text text-transparent truncate leading-tight">
                            Generating Reel...
                        </h4>
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                            {activeIdeaTitle || 'Processing...'}
                        </p>
                    </div>

                    <span className="text-xs font-bold text-slate-500 tabular-nums">
                        {Math.round(progress)}%
                    </span>
                </div>

                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                        className="bg-gradient-to-r from-pink-500 to-violet-600 h-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(236,72,153,0.5)]"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        </div>
    )
}
