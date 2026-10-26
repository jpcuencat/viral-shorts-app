'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { generateJson } from '@/lib/ai/gemini'
import { loadCategoryTree, allowedSubcategoriesText, resolveCategory, categoryLabel, TRENDS_SLUG } from '@/lib/ideas/taxonomy'

export async function getCategories() {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('categories')
        .select(`
            *,
            ideas (count)
        `)
        .order('sort_order', { ascending: true })

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

/** Nueva SUBcategoría dentro de una principal (las principales son fijas). */
export async function addCategory(name: string, parentId?: string) {
    const supabase = await createClient()
    if (!name.trim()) return { success: false, message: 'Escribe un nombre' }
    if (!parentId) return { success: false, message: 'Elige la categoría principal donde va la subcategoría' }
    const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
    const { data: siblings } = await supabase.from('categories').select('sort_order').eq('parent_id', parentId)
    const order = Math.max(0, ...(siblings || []).map((x: any) => x.sort_order || 0)) + 1
    const { error } = await supabase.from('categories').insert({ name: name.trim(), slug, parent_id: parentId, sort_order: order })
    if (error) {
        if (error.code === '23505') return { success: false, message: `La categoría "${name}" ya existe.` }
        return { success: false, message: `No se pudo agregar: ${error.message}` }
    }
    revalidatePath('/categories')
    return { success: true }
}

/**
 * Ordena con IA las ideas que están en una categoría PRINCIPAL (sin subcategoría) o sin categoría:
 * las mueve a la subcategoría que corresponde, o a "Tendencias" si no encaja en ninguna.
 */
export async function classifyIdeasIntoSubcategories(): Promise<{ moved?: number; error?: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Sesión no válida' }
    const tree = await loadCategoryTree(supabase)
    const parentIds = tree.parents.filter(p => p.slug !== TRENDS_SLUG).map(p => p.id)
    const { data: ideas } = await supabase.from('ideas').select('id, title, description, category_id')
        .eq('user_id', user.id).or(`category_id.is.null,category_id.in.(${parentIds.join(',')})`).limit(200)
    if (!ideas?.length) return { moved: 0 }
    const result = await generateJson(`Clasifica cada idea de video en UNA subcategoría. Usa EXACTAMENTE uno de estos slugs:
${allowedSubcategoriesText(tree)}
Si la idea ya está en una categoría principal, prefiere una subcategoría de esa principal.

IDEAS:
${ideas.map((i: any, k: number) => `${k}. [actual: ${categoryLabel(tree, i.category_id) || 'sin categoría'}] ${i.title} — ${(i.description || '').slice(0, 160)}`).join('\n')}

Responde SOLO con JSON: [{"index":0,"slug":""}]`, z.array(z.looseObject({ index: z.coerce.number().int(), slug: z.string() })), { label: 'ClassifyIdeas' })
    let moved = 0
    for (const r of result) {
        const idea: any = ideas[r.index]
        const cat = idea ? resolveCategory(tree, r.slug) : undefined
        if (!idea || !cat || cat.id === idea.category_id) continue
        const { error } = await supabase.from('ideas').update({ category_id: cat.id }).eq('id', idea.id)
        if (!error) moved++
    }
    revalidatePath('/categories')
    revalidatePath('/ideas')
    return { moved }
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
        return { success: false, message: `No se puede borrar: tiene ${count} ideas.` }
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
