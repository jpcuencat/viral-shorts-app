'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Play, Pause, SkipForward, SkipBack, RefreshCw, Volume2, VolumeX } from 'lucide-react'
import { Database } from '@/types/database.types'

type ReelScene = Database['public']['Tables']['reel_scenes']['Row']

interface ReelPlayerProps {
    scenes: ReelScene[]
    quality?: {
        score: number | null
        feedback: string | null
    }
}

export function ReelPlayer({ scenes, quality }: ReelPlayerProps) {
    // Sort scenes just in case
    const sortedScenes = [...scenes].sort((a, b) => a.scene_order - b.scene_order)

    const [currentSceneIndex, setCurrentSceneIndex] = useState(0)
    const [isPlaying, setIsPlaying] = useState(false)
    const [progress, setProgress] = useState(0)
    const [isMuted, setIsMuted] = useState(false)

    const currentScene = sortedScenes[currentSceneIndex]
    const intervalRef = useRef<NodeJS.Timeout | null>(null)

    useEffect(() => {
        // Reset progress when scene changes
        setProgress(0)
    }, [currentSceneIndex])

    useEffect(() => {
        if (!isPlaying) {
            if (intervalRef.current) clearInterval(intervalRef.current)
            return
        }

        const duration = (currentScene?.duration || 3) * 1000 // duration in ms
        const tickRate = 100 // update every 100ms
        const step = 100 / (duration / tickRate)

        intervalRef.current = setInterval(() => {
            setProgress((prev) => {
                if (prev >= 100) {
                    // Scene finished
                    if (currentSceneIndex < sortedScenes.length - 1) {
                        setCurrentSceneIndex((prevIndex) => prevIndex + 1)
                        return 0
                    } else {
                        // Reel finished
                        setIsPlaying(false)
                        return 100
                    }
                }
                return prev + step
            })
        }, tickRate)

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
        }
    }, [isPlaying, currentSceneIndex, sortedScenes.length, currentScene])

    const togglePlay = () => setIsPlaying(!isPlaying)
    const restart = () => {
        setCurrentSceneIndex(0)
        setProgress(0)
        setIsPlaying(true)
    }
    const nextScene = () => {
        if (currentSceneIndex < sortedScenes.length - 1) {
            setCurrentSceneIndex(currentSceneIndex + 1)
            setProgress(0)
        }
    }
    const prevScene = () => {
        if (currentSceneIndex > 0) {
            setCurrentSceneIndex(currentSceneIndex - 1)
            setProgress(0)
        }
    }

    if (!scenes || scenes.length === 0) {
        return <div className="p-4 text-center text-muted-foreground">No scenes found for this reel.</div>
    }

    return (
        <Card className="max-w-xs mx-auto overflow-hidden bg-black text-white shadow-2xl rounded-3xl border-gray-800">
            {/* 9:16 Aspect Ratio Container */}
            <div className="relative aspect-[9/16] bg-gray-900 group">

                {/* Background Image */}
                {/* Background Media (Image or Video) */}
                {(() => {
                    const url = currentScene.image_url
                    // Simple heuristic to detect video vs image. 
                    // In a real app we'd store `media_type` in DB.
                    // Google URIs often don't have extensions, but we can assume 'video' logic if we just generated it.
                    // Or we check known extensions.
                    const isVideo = url?.includes('mp4') || url?.includes('file_uri') || url?.includes('googleapis')

                    if (!url) return null

                    if (isVideo) {
                        return (
                            <video
                                key={url}
                                src={url}
                                className="absolute inset-0 w-full h-full object-cover z-0"
                                autoPlay
                                loop
                                muted={isMuted}
                                playsInline
                                controls // Added controls for debugging/user interaction
                            />
                        )
                    } else {
                        return (
                            <img
                                src={url}
                                alt="Scene background"
                                className="absolute inset-0 w-full h-full object-cover opacity-80"
                            />
                        )
                    }
                })()}

                {/* Overlay Gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

                {/* Content - Hide if it's the generic 'Full Generated Reel' text so video is clear */}
                {currentScene.content_text !== 'Full Generated Reel' && (
                    <div className="absolute inset-0 flex flex-col justify-end p-6 pb-12">
                        <p className="text-xl font-bold font-sans animated-text shadow-sm drop-shadow-md">
                            {currentScene.content_text}
                        </p>
                    </div>
                )}

                {/* Progress Indicators (Instagram Story style) */}
                <div className="absolute top-4 left-2 right-2 flex gap-1">
                    {sortedScenes.map((scene, idx) => (
                        <div key={scene.id} className="h-1 flex-1 bg-white/30 rounded-full overflow-hidden">
                            <div
                                className={`h-full bg-white transition-all duration-100 ease-linear`}
                                style={{
                                    width: idx < currentSceneIndex ? '100%' :
                                        idx === currentSceneIndex ? `${progress}%` : '0%'
                                }}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Controls */}
            <CardContent className="p-4 bg-gray-900 flex justify-between items-center border-t border-gray-800">
                <Button variant="ghost" size="icon" onClick={restart} className="text-gray-400 hover:text-white">
                    <RefreshCw className="h-4 w-4" />
                </Button>

                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={prevScene} disabled={currentSceneIndex === 0} className="text-white">
                        <SkipBack className="h-5 w-5" />
                    </Button>
                    <Button variant="secondary" size="icon" onClick={togglePlay} className="rounded-full bg-white text-black hover:bg-gray-200">
                        {isPlaying ? <Pause className="h-5 w-5 ml-0.5" /> : <Play className="h-5 w-5 ml-1" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={nextScene} disabled={currentSceneIndex === sortedScenes.length - 1} className="text-white">
                        <SkipForward className="h-5 w-5" />
                    </Button>
                </div>

                <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} className="text-gray-400 hover:text-white">
                    {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
            </CardContent>

            {/* AI Quality Audit Result */}
            {quality?.score !== undefined && quality.score !== null && (
                <div className="p-3 bg-gray-950 border-t border-gray-800 text-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-gray-400 uppercase tracking-widest font-semibold flex items-center gap-1">
                            🤖 AI Critic
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${quality.score >= 80 ? 'bg-green-900 text-green-300' :
                            quality.score >= 50 ? 'bg-yellow-900 text-yellow-300' :
                                'bg-red-900 text-red-300'
                            }`}>
                            {quality.score}/100
                        </span>
                    </div>
                    <p className="text-gray-500 leading-tight">
                        {quality.feedback}
                    </p>
                </div>
            )}
        </Card>
    )
}
