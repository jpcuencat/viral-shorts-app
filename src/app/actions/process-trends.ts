'use server'

import { createClient } from '@/lib/supabase/server'
import { getTodayTrendCategoryName } from '@/lib/trends'
import { enqueueJob } from '@/lib/jobs/queue'

/**
 * Encola el análisis de tendencias mundiales. El worker crea las ideas y guiones en segundo plano;
 * la interfaz sigue el progreso en vivo con el id devuelto.
 */
export async function processTrends(): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
        const supabase = await createClient()
        const jobId = await enqueueJob(supabase, {
            type: 'process_trends',
            title: `Tendencias mundiales · ${getTodayTrendCategoryName()}`,
            payload: {},
        })
        return { success: true, jobId }
    } catch (error: any) {
        return { success: false, error: error.message || 'No se pudo encolar el análisis de tendencias.' }
    }
}
