'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getCategories() {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('categories')
        .select(`
            *,
            ideas (count)
        `)
        .order('created_at', { ascending: true })

    if (error) {
        console.error('Error fetching categories:', error)
        return []
    }

    // Transform count
    return data.map((d: any) => ({
        ...d,
        count: d.ideas?.[0]?.count || 0
    }))
}

export async function addCategory(name: string) {
    const supabase = await createClient()

    if (!name.trim()) return { success: false, message: 'Name is required' }

    const slug = name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, '')

    const { error } = await supabase.from('categories').insert({
        name,
        slug
    })

    if (error) {
        console.error('SERVER ACTION ERROR:', error)
        if (error.code === '23505') {
            return { success: false, message: `La categoría "${name}" ya existe.` }
        }
        return { success: false, message: `Error adding: ${error.message} (Code: ${error.code})` }
    }

    revalidatePath('/categories')
    return { success: true }
}

export async function deleteCategory(id: string) {
    const supabase = await createClient()

    // 1. Verify count again on server side for safety
    const { data: category } = await supabase
        .from('categories')
        .select(`
            *,
            ideas (count)
        `)
        .eq('id', id)
        .single()

    const count = category?.ideas?.[0]?.count || 0

    if (count > 0) {
        return { success: false, message: `Cannot delete category with ${count} active ideas.` }
    }

    // 2. Delete
    const { error } = await supabase.from('categories').delete().eq('id', id)

    if (error) {
        console.error('Error deleting category:', error)
        return { success: false, message: error.message }
    }

    revalidatePath('/categories')
    return { success: true }
}
