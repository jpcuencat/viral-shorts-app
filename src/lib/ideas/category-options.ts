/** Utilidades puras (cliente y servidor) para mostrar las categorías en orden de árbol. */
export type CategoryRow = { id: string; name: string; slug?: string; parent_id?: string | null; sort_order?: number | null }
export type CategoryOption = { id: string; label: string; name: string; isParent: boolean; parentId: string | null; childIds: string[] }

export function flattenCategories(rows: CategoryRow[]): CategoryOption[] {
    const parents = rows.filter(r => !r.parent_id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
    const out: CategoryOption[] = []
    for (const p of parents) {
        const kids = rows.filter(r => r.parent_id === p.id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        out.push({ id: p.id, label: p.name, name: p.name, isParent: true, parentId: null, childIds: kids.map(k => k.id) })
        for (const k of kids) out.push({ id: k.id, label: `${p.name} › ${k.name}`, name: k.name, isParent: false, parentId: p.id, childIds: [] })
    }
    // Huérfanas (por si acaso)
    for (const r of rows) if (r.parent_id && !rows.some(p => p.id === r.parent_id)) out.push({ id: r.id, label: r.name, name: r.name, isParent: false, parentId: null, childIds: [] })
    return out
}
