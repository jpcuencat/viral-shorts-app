'use client'

import { useGeneration } from '@/context/generation-context'
import { Loader2, Video, TrendingUp, X, CheckCircle2, AlertCircle, Clock, Ban } from 'lucide-react'

const statusLabel: Record<string, string> = {
    queued: 'En cola',
    running: 'En curso',
    completed: 'Completado',
    failed: 'Error',
    cancelled: 'Cancelado',
}

export function FloatingProgress() {
    const { jobs, cancelJob } = useGeneration()
    if (jobs.length === 0) return null

    return (
        <div className="fixed bottom-6 right-6 z-50 w-80 max-w-[calc(100vw-2rem)] space-y-2">
            {jobs.map(job => {
                const active = job.status === 'queued' || job.status === 'running'
                const Icon = job.type === 'process_trends' ? TrendingUp : Video
                const StatusIcon =
                    job.status === 'completed' ? CheckCircle2 :
                    job.status === 'failed' ? AlertCircle :
                    job.status === 'cancelled' ? Ban :
                    job.status === 'queued' ? Clock : Loader2

                return (
                    <div
                        key={job.id}
                        className="relative bg-slate-900/95 backdrop-blur border border-slate-700 rounded-2xl shadow-2xl p-3.5 overflow-hidden animate-in slide-in-from-bottom-5"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-pink-500/10 to-violet-600/10 pointer-events-none" />
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-2.5">
                                <div className="relative h-9 w-9 flex-shrink-0 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
                                    <Icon className="h-4 w-4 text-pink-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-100 truncate leading-tight">
                                        {job.title || (job.type === 'process_trends' ? 'Tendencias' : 'Reel')}
                                    </p>
                                    <p className="text-[11px] text-slate-400 truncate mt-0.5 flex items-center gap-1">
                                        <StatusIcon className={`h-3 w-3 shrink-0 ${job.status === 'running' ? 'animate-spin' : ''}`} />
                                        {job.cancel_requested && active ? 'Cancelando…' : (job.stage || statusLabel[job.status])}
                                    </p>
                                </div>
                                <span className="text-xs font-bold text-slate-400 tabular-nums">
                                    {job.status === 'queued' ? '—' : `${Math.round(job.progress)}%`}
                                </span>
                                {active && !job.cancel_requested && (
                                    <button
                                        type="button"
                                        onClick={() => cancelJob(job.id)}
                                        className="text-slate-500 hover:text-red-400 transition-colors"
                                        title="Cancelar"
                                        aria-label="Cancelar trabajo"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>

                            {job.message && active && (
                                <p className="text-[11px] text-slate-500 truncate mb-2">{job.message}</p>
                            )}
                            {job.status === 'failed' && job.error && (
                                <p className="text-[11px] text-red-400 line-clamp-2 mb-2">{job.error}</p>
                            )}

                            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                <div
                                    className={`h-full transition-all duration-500 ease-out ${
                                        job.status === 'failed' ? 'bg-red-500' :
                                        job.status === 'cancelled' ? 'bg-slate-500' :
                                        'bg-gradient-to-r from-pink-500 to-violet-600'
                                    }`}
                                    style={{ width: `${job.status === 'queued' ? 0 : job.progress}%` }}
                                />
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
