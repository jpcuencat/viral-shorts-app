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
