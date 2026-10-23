'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { generateChannelInsights } from '@/lib/learning/insights'

/** Recalcula las lecciones del canal con los datos actuales (métricas, crítico, correcciones). */
export async function recomputeInsights(): Promise<{ ok?: boolean; error?: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Sesión no válida' }
    try {
        const res = await generateChannelInsights(getAdminClient(), user.id)
        if (!res) return { error: 'Aún no hay suficientes videos publicados con métricas (mínimo 3).' }
        revalidatePath('/rendimiento')
        return { ok: true }
    } catch (e: any) {
        return { error: e?.message || 'No se pudieron calcular las lecciones' }
    }
}
