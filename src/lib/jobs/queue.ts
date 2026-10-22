import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobRow, JobType } from './types'

const WAKE_KEY = '__viralShortsWorkerWake'

/** Despierta al worker embebido para que tome el trabajo sin esperar al siguiente sondeo. */
export function wakeWorker() {
    const wake = (globalThis as any)[WAKE_KEY] as (() => void) | undefined
    if (wake) wake()
}

export function registerWorkerWake(fn: () => void) {
    ;(globalThis as any)[WAKE_KEY] = fn
}

/** Encola un trabajo a nombre del usuario de la sesión (respeta RLS). Devuelve el id del trabajo. */
export async function enqueueJob(
    db: SupabaseClient,
    job: { type: JobType; title: string; payload: Record<string, unknown> }
): Promise<string> {
    const { data: { user } } = await db.auth.getUser()
    if (!user) throw new Error('Sesión no válida. Vuelve a iniciar sesión.')

    const { data, error } = await db
        .from('jobs')
        .insert({ user_id: user.id, type: job.type, title: job.title, payload: job.payload })
        .select('id')
        .single()
    if (error || !data) throw new Error(`No se pudo encolar el trabajo: ${error?.message || 'sin respuesta'}`)

    wakeWorker()
    return data.id as string
}

export const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const

export type JobView = Pick<JobRow,
    'id' | 'type' | 'status' | 'title' | 'progress' | 'stage' | 'message' | 'result' | 'error' | 'payload' | 'created_at' | 'finished_at' | 'cancel_requested'>

export const JOB_VIEW_COLUMNS =
    'id, type, status, title, progress, stage, message, result, error, payload, created_at, finished_at, cancel_requested'
