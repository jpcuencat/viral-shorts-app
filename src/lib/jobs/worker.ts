import os from 'os'
import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient, hasAdminCredentials } from '@/lib/supabase/admin'
import { registerWorkerWake } from './queue'
import { JobCancelledError, type JobRow, type ProgressReporter } from './types'
import { runReelPipeline } from '@/lib/pipeline/reel-pipeline'
import { runTrendsPipeline } from '@/lib/pipeline/trends-pipeline'
import { importLocalData } from './import-local-data'

/**
 * Worker de trabajos en segundo plano. Corre dentro del servidor de Next (ver src/instrumentation.ts),
 * procesa UN trabajo a la vez (FFmpeg y la IA son pesados) y deja progreso, latido y resultado en la tabla jobs.
 */
const POLL_MS = Number(process.env.WORKER_POLL_MS || 3000)
const HEARTBEAT_MS = 15_000
const STALE_SECONDS = 120
const STALE_SECONDS_AT_STARTUP = 45
const STATE_KEY = '__viralShortsWorkerState'

interface WorkerState {
    running: boolean
    workerId: string
    wake: (() => void) | null
}

function sleep(ms: number, state: WorkerState) {
    return new Promise<void>(resolve => {
        const timer = setTimeout(() => {
            state.wake = null
            resolve()
        }, ms)
        state.wake = () => {
            clearTimeout(timer)
            state.wake = null
            resolve()
        }
    })
}

export function startWorker() {
    const g = globalThis as any
    if (g[STATE_KEY]?.running) return // evita duplicados con recargas en caliente

    if (!hasAdminCredentials()) {
        console.warn(
            '[Worker] No iniciado: falta SUPABASE_SERVICE_ROLE_KEY en .env.local. ' +
            'Las generaciones quedarán en cola hasta que lo configures y reinicies el servidor.'
        )
        return
    }

    const state: WorkerState = {
        running: true,
        workerId: `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 6)}`,
        wake: null,
    }
    g[STATE_KEY] = state
    registerWorkerWake(() => state.wake?.())

    console.log(`[Worker] Iniciado (${state.workerId}). Sondeo cada ${POLL_MS / 1000}s.`)
    loop(state).catch(err => {
        console.error('[Worker] Detenido por un error inesperado:', err)
        state.running = false
    })
}

async function loop(state: WorkerState) {
    const db = getAdminClient()

    await importLocalData(db).catch(err => console.warn('[Worker] Importación de datos locales incompleta:', err?.message || err))

    // Trabajos que quedaron "running" porque el servidor se reinició
    await requeueStale(db, STALE_SECONDS_AT_STARTUP)
    let lastStaleCheck = Date.now()

    while (state.running) {
        try {
            if (Date.now() - lastStaleCheck > 60_000) {
                await requeueStale(db, STALE_SECONDS)
                lastStaleCheck = Date.now()
            }

            // Trabajos cancelados antes de empezar
            await db
                .from('jobs')
                .update({ status: 'cancelled', stage: 'Cancelado', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq('status', 'queued')
                .eq('cancel_requested', true)

            const { data, error } = await db.rpc('claim_next_job', { p_worker: state.workerId })
            if (error) throw error
            const job = (Array.isArray(data) ? data[0] : data) as JobRow | undefined
            if (job) {
                await runJob(db, job)
                continue // buscar el siguiente sin esperar
            }
        } catch (err: any) {
            console.error('[Worker] Error en el ciclo:', err?.message || err)
        }
        await sleep(POLL_MS, state)
    }
}

async function requeueStale(db: SupabaseClient, seconds: number) {
    const { data, error } = await db.rpc('requeue_stale_jobs', { p_stale_seconds: seconds })
    if (error) console.warn('[Worker] No se pudieron recuperar trabajos colgados:', error.message)
    else if (data) console.log(`[Worker] ${data} trabajo(s) interrumpido(s) devuelto(s) a la cola o marcados como fallidos.`)
}

async function runJob(db: SupabaseClient, job: JobRow) {
    const now = () => new Date().toISOString()
    const write = async (fields: Record<string, unknown>) => {
        const { error } = await db
            .from('jobs')
            .update({ ...fields, heartbeat_at: now(), updated_at: now() })
            .eq('id', job.id)
        if (error) console.warn(`[Worker] No se pudo actualizar el trabajo ${job.id}:`, error.message)
    }

    const checkCancel = async () => {
        const { data } = await db.from('jobs').select('cancel_requested').eq('id', job.id).single()
        if (data?.cancel_requested) throw new JobCancelledError()
    }

    const report: ProgressReporter = async (progress, stage, message) => {
        await write({ progress: Math.max(0, Math.min(99, Math.round(progress))), stage, message: message ?? null })
        await checkCancel()
    }

    // Latido independiente: los pasos largos (FFmpeg, descargas) no deben parecer colgados
    const heartbeat = setInterval(() => { write({}).catch(() => { }) }, HEARTBEAT_MS)
    const started = Date.now()
    console.log(`[Worker] ▶ ${job.type} · ${job.title || job.id} (intento ${job.attempts})`)

    try {
        let result: Record<string, unknown>
        if (job.type === 'generate_reel') {
            const scriptId = job.payload?.scriptId
            if (!scriptId) throw new Error('El trabajo no indica el guion.')
            const r = await runReelPipeline({ db, userId: job.user_id, scriptId, options: job.payload?.options || {}, report })
            if (!r.success) throw new Error(r.error || 'La generación del reel falló.')
            result = { scriptId, reelId: r.reelId, qualityScore: r.qualityScore ?? null, videoUrl: r.videoUrl }
        } else if (job.type === 'process_trends') {
            const r = await runTrendsPipeline({ db, userId: job.user_id, report })
            result = { ...r }
        } else {
            throw new Error(`Tipo de trabajo desconocido: ${job.type}`)
        }

        await write({ status: 'completed', progress: 100, stage: 'Completado', message: null, result, finished_at: now(), locked_by: null })
        console.log(`[Worker] ✔ ${job.type} · ${job.title || job.id} en ${Math.round((Date.now() - started) / 1000)}s`)
    } catch (err: any) {
        if (err instanceof JobCancelledError) {
            await write({ status: 'cancelled', stage: 'Cancelado', message: null, finished_at: now(), locked_by: null })
            console.log(`[Worker] ■ Cancelado: ${job.title || job.id}`)
        } else {
            const msg = (err?.message || String(err)).slice(0, 1000)
            await write({ status: 'failed', stage: 'Error', error: msg, finished_at: now(), locked_by: null })
            console.error(`[Worker] ✖ ${job.type} · ${job.title || job.id}: ${msg}`)
        }
    } finally {
        clearInterval(heartbeat)
    }
}
