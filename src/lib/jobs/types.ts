/** Reporta el avance de un trabajo largo (0-100) con la etapa actual. Lanza JobCancelledError si el usuario canceló. */
export type ProgressReporter = (progress: number, stage: string, message?: string) => Promise<void>

export class JobCancelledError extends Error {
    constructor() {
        super('Trabajo cancelado por el usuario')
        this.name = 'JobCancelledError'
    }
}

export type JobType = 'generate_reel' | 'process_trends'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface JobRow {
    id: string
    user_id: string
    type: JobType
    status: JobStatus
    title: string | null
    payload: any
    progress: number
    stage: string | null
    message: string | null
    result: any
    error: string | null
    attempts: number
    max_attempts: number
    cancel_requested: boolean
    created_at: string
    started_at: string | null
    finished_at: string | null
    updated_at: string
}
