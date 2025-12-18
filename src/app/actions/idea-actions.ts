'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateIdeaStatus(id: string, status: 'approved' | 'rejected' | 'pending_approval') {
    const supabase = await createClient()

    const { error } = await supabase
        .from('ideas')
        .update({ status })
        .eq('id', id)

    if (error) {
        return { error: 'Failed to update status' }
    }

    revalidatePath('/ideas')
    revalidatePath(`/ideas/${id}`)
    return { success: true }
}

export async function deleteIdea(id: string) {
    const supabase = await createClient()

    const { error } = await supabase
        .from('ideas')
        .delete()
        .eq('id', id)

    if (error) {
        return { error: 'Failed to delete idea' }
    }

    revalidatePath('/ideas')
    revalidatePath('/ideas')
    return { success: true }
}

export async function toggleArchiveIdea(id: string, isArchived: boolean) {
    const supabase = await createClient()

    const { error } = await supabase
        .from('ideas')
        .update({ is_archived: isArchived })
        .eq('id', id)

    if (error) {
        return { error: 'Failed to update archive status' }
    }

    revalidatePath('/ideas')
    revalidatePath(`/ideas/${id}`)
    return { success: true }
}
