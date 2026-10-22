'use client'

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { generateReel, type GenerateReelOptions } from '@/app/actions/generate-reel'
import { processTrends } from '@/app/actions/process-trends'
import { getActiveJobs, getJobsByIds, cancelJob as cancelJobAction } from '@/app/actions/job-actions'
import { createClient } from '@/lib/supabase/client'
import type { JobView } from '@/lib/jobs/queue'

const POLL_MS = 5000
const FINISHED_VISIBLE_MS = 6000

interface GenerationContextType {
    /** Trabajos visibles: en cola, en curso y los recién terminados (unos segundos). */
    jobs: JobView[]
    /** Hay al menos una generación de reel en cola o en curso. */
    isGenerating: boolean
    /** El guion indicado tiene una generación en cola o en curso. */
    isScriptBusy: (scriptId: string) => boolean
    startGeneration: (scriptId: string, title?: string, options?: GenerateReelOptions) => Promise<void>
    startTrendsAnalysis: () => Promise<void>
    isTrendsRunning: boolean
    cancelJob: (jobId: string) => Promise<void>
}

const GenerationContext = createContext<GenerationContextType | undefined>(undefined)

const isActive = (j: JobView) => j.status === 'queued' || j.status === 'running'

export function GenerationProvider({ children }: { children: ReactNode }) {
    const router = useRouter()
    const [jobs, setJobs] = useState<JobView[]>([])
    const notified = useRef<Set<string>>(new Set())
    const jobsRef = useRef<JobView[]>([])
    useEffect(() => {
        jobsRef.current = jobs
    }, [jobs])

    const notifyFinished = useCallback((job: JobView) => {
        if (notified.current.has(job.id)) return
        notified.current.add(job.id)

        if (job.status === 'completed') {
            if (job.type === 'generate_reel') {
                const score = job.result?.qualityScore
                const scriptId = job.result?.scriptId || job.payload?.scriptId
                toast.success('¡Reel listo!', {
                    description: `${job.title || 'Reel'}${typeof score === 'number' ? ` · nota ${score}/100` : ''}`,
                    action: scriptId ? { label: 'Ver reel', onClick: () => router.push(`/scripts/${scriptId}?tab=reel`) } : undefined,
                })
            } else {
                const r = job.result || {}
                toast.success('Tendencias procesadas', {
                    description: `Se analizaron ${r.processed ?? 0} tendencias y se crearon ${r.created ?? 0} guiones (${r.trendCategory || 'Tendencias'}).`,
                    action: { label: 'Ver ideas', onClick: () => router.push('/ideas') },
                })
            }
        } else if (job.status === 'failed') {
            toast.error(job.type === 'generate_reel' ? 'La generación del reel falló' : 'El análisis de tendencias falló', {
                description: job.error || 'Revisa la consola del servidor para más detalles.',
            })
        } else if (job.status === 'cancelled') {
            toast.info('Trabajo cancelado', { description: job.title || undefined })
        }
        router.refresh()
        // Quitar de la vista tras unos segundos
        setTimeout(() => setJobs(prev => prev.filter(j => j.id !== job.id)), FINISHED_VISIBLE_MS)
    }, [router])

    const upsertJobs = useCallback((incoming: JobView[]) => {
        if (incoming.length === 0) return
        setJobs(prev => {
            const map = new Map(prev.map(j => [j.id, j]))
            for (const j of incoming) {
                const known = map.get(j.id)
                // Solo seguimos trabajos que ya conocemos o que están activos
                if (!known && !isActive(j)) continue
                map.set(j.id, { ...(known || {}), ...j } as JobView)
            }
            return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
        })
        // Avisar cuando termina un trabajo que estábamos siguiendo
        for (const j of incoming) {
            const wasTracked = jobsRef.current.some(k => k.id === j.id)
            if (wasTracked && !isActive(j)) notifyFinished(j)
        }
    }, [notifyFinished])

    // 1. Al cargar: retomar los trabajos activos (por ejemplo, si cerraste la pestaña y volviste)
    useEffect(() => {
        getActiveJobs().then(active => setJobs(active)).catch(() => { })
    }, [])

    // 2. Cambios en vivo con Supabase Realtime (RLS: solo llegan los trabajos del usuario)
    useEffect(() => {
        const supabase = createClient()
        let channel: ReturnType<typeof supabase.channel> | null = null
        let cancelled = false

        supabase.auth.getUser().then(({ data: { user } }) => {
            if (!user || cancelled) return
            channel = supabase
                .channel(`jobs-${user.id}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'jobs', filter: `user_id=eq.${user.id}` },
                    payload => {
                        const row = payload.new as any
                        if (row?.id) upsertJobs([row as JobView])
                    }
                )
                .subscribe()
        })

        return () => {
            cancelled = true
            if (channel) supabase.removeChannel(channel)
        }
    }, [upsertJobs])

    // 3. Respaldo por sondeo mientras haya trabajos activos
    useEffect(() => {
        const activeIds = jobs.filter(isActive).map(j => j.id)
        if (activeIds.length === 0) return
        const timer = setInterval(() => {
            getJobsByIds(activeIds).then(upsertJobs).catch(() => { })
        }, POLL_MS)
        return () => clearInterval(timer)
    }, [jobs, upsertJobs])

    const track = useCallback((jobId: string, type: JobView['type'], title: string, payload: any) => {
        setJobs(prev => prev.some(j => j.id === jobId) ? prev : [...prev, {
            id: jobId, type, status: 'queued', title, progress: 0, stage: 'En cola', message: null,
            result: null, error: null, payload, created_at: new Date().toISOString(), finished_at: null, cancel_requested: false,
        }])
    }, [])

    const startGeneration = useCallback(async (scriptId: string, title: string = 'Reel', options?: GenerateReelOptions) => {
        const res = await generateReel(scriptId, options)
        if (!res.success || !res.jobId) {
            toast.error('No se pudo iniciar la generación', { description: res.error })
            return
        }
        track(res.jobId, 'generate_reel', title, { scriptId, options })
        const queuedBefore = jobsRef.current.filter(isActive).length
        toast.info(queuedBefore > 0 ? 'Reel en cola' : 'Generando reel', {
            description: queuedBefore > 0
                ? `${title}: empezará cuando terminen los ${queuedBefore} trabajo(s) anteriores. Puedes cerrar la pestaña.`
                : `${title}: se procesa en segundo plano. Puedes cerrar la pestaña y volver luego.`,
        })
    }, [track])

    const startTrendsAnalysis = useCallback(async () => {
        const res = await processTrends()
        if (!res.success || !res.jobId) {
            toast.error('No se pudo iniciar el análisis de tendencias', { description: res.error })
            return
        }
        track(res.jobId, 'process_trends', 'Tendencias mundiales', {})
        toast.info('Analizando tendencias mundiales', { description: 'Se crearán ideas y guiones en segundo plano.' })
    }, [track])

    const cancelJob = useCallback(async (jobId: string) => {
        const res = await cancelJobAction(jobId)
        if (!res.success) {
            toast.error('No se pudo cancelar', { description: res.error })
            return
        }
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, cancel_requested: true, stage: 'Cancelando…' } : j))
    }, [])

    const isScriptBusy = useCallback(
        (scriptId: string) => jobs.some(j => isActive(j) && j.type === 'generate_reel' && j.payload?.scriptId === scriptId),
        [jobs]
    )

    const value: GenerationContextType = {
        jobs,
        isGenerating: jobs.some(j => isActive(j) && j.type === 'generate_reel'),
        isScriptBusy,
        startGeneration,
        startTrendsAnalysis,
        isTrendsRunning: jobs.some(j => isActive(j) && j.type === 'process_trends'),
        cancelJob,
    }

    return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>
}

export function useGeneration() {
    const context = useContext(GenerationContext)
    if (context === undefined) {
        throw new Error('useGeneration must be used within a GenerationProvider')
    }
    return context
}
