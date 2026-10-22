'use server'

import { createClient } from '@/lib/supabase/server'
import { JOB_VIEW_COLUMNS, type JobView } from '@/lib/jobs/queue'

/** Trabajos en cola o en curso del usuario (para reanudar el seguimiento al volver a la app). */
export async function getActiveJobs(): Promise<JobView[]> {
    const supabase = await createClient()
    const { data } = await supabase
        .from('jobs')
        .select(JOB_VIEW_COLUMNS)
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: true })
    return (data || []) as JobView[]
}

/** Estado actual de trabajos concretos (respaldo por sondeo si Realtime no entrega cambios). */
export async function getJobsByIds(ids: string[]): Promise<JobView[]> {
    if (ids.length === 0) return []
    const supabase = await createClient()
    const { data } = await supabase.from('jobs').select(JOB_VIEW_COLUMNS).in('id', ids)
    return (data || []) as JobView[]
}

/** Pide cancelar un trabajo. El worker lo detiene en la siguiente etapa. */
export async function cancelJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient()
    const { error } = await supabase.from('jobs').update({ cancel_requested: true }).eq('id', jobId)
    return error ? { success: false, error: error.message } : { success: true }
}
