'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateScriptForIdea } from '@/lib/pipeline/script-pipeline'

export async function generateScript(ideaId: string) {
    const supabase = await createClient()
    const result = await generateScriptForIdea(supabase, ideaId)
    if (result.success) revalidatePath(`/ideas/${ideaId}`)
    return result
}

/**
 * Regenera el guion de una idea aprobada. Crea un guion NUEVO (el anterior y su reel quedan como historial)
 * usando el guion previo como referencia de lo que NO gustó y los comentarios opcionales del usuario.
 */
export async function regenerateScript(ideaId: string, feedback?: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Sesión no válida' }

    const { data: idea } = await supabase.from('ideas').select('status').eq('id', ideaId).single()
    if (!idea) return { error: 'Idea no encontrada' }
    if (idea.status !== 'approved') return { error: 'Solo se puede regenerar el guion de una idea aprobada' }

    const { data: latest } = await supabase
        .from('scripts')
        .select('id')
        .eq('idea_id', ideaId)
        .order('created_at', { ascending: false })
        .limit(1)

    const result = await generateScriptForIdea(supabase, ideaId, user.id, {
        feedback,
        previousScriptId: latest?.[0]?.id,
    })
    if (result.success) {
        revalidatePath(`/ideas/${ideaId}`)
        if (result.scriptId) revalidatePath(`/scripts/${result.scriptId}`)
    }
    return result
}
