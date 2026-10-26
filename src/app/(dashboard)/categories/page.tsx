'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Trash2, Plus, Loader2, Wand2 } from 'lucide-react'
import { getCategories, addCategory, deleteCategory, classifyIdeasIntoSubcategories } from '@/app/actions/category-actions'

type Cat = { id: string; name: string; slug: string; parent_id: string | null; sort_order: number; count: number }

export default function CategoriesPage() {
    const [cats, setCats] = useState<Cat[]>([])
    const [newName, setNewName] = useState('')
    const [parentId, setParentId] = useState('')
    const [loading, setLoading] = useState(false)
    const [classifying, setClassifying] = useState(false)
    const [msg, setMsg] = useState('')

    useEffect(() => { load() }, [])
    async function load() { setCats(await getCategories() as Cat[]) }

    const parents = cats.filter(c => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order)
    const kids = (id: string) => cats.filter(c => c.parent_id === id).sort((a, b) => a.sort_order - b.sort_order)
    const total = (p: Cat) => p.count + kids(p.id).reduce((s, k) => s + k.count, 0)

    async function handleAdd() {
        setLoading(true)
        const r = await addCategory(newName, parentId)
        if (r.success) { setNewName(''); load() } else alert(r.message)
        setLoading(false)
    }
    async function handleDelete(c: Cat) {
        if (c.count > 0) { alert(`"${c.name}" tiene ${c.count} ideas; muévelas antes de borrarla.`); return }
        if (!c.parent_id) { alert('Las categorías principales son fijas.'); return }
        if (!confirm(`¿Borrar la subcategoría "${c.name}"?`)) return
        const r = await deleteCategory(c.id)
        if (r.success) load(); else alert(r.message)
    }
    async function handleClassify() {
        setClassifying(true); setMsg('')
        const r = await classifyIdeasIntoSubcategories()
        setMsg(r.error ? r.error : `${r.moved} ideas movidas a su subcategoría`)
        setClassifying(false); load()
    }

    return (
        <div className="p-8 max-w-3xl mx-auto space-y-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Categorías</h1>
                    <p className="text-muted-foreground text-sm">6 temáticas fijas con subcategorías, más "Tendencias" para lo que no encaja en ninguna.</p>
                </div>
                <div className="flex items-center gap-3">
                    {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
                    <Button variant="outline" onClick={handleClassify} disabled={classifying}>
                        {classifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                        Clasificar ideas
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap gap-3">
                <Select value={parentId} onValueChange={setParentId}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="Categoría principal" /></SelectTrigger>
                    <SelectContent>{parents.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="flex-1 min-w-[200px]" placeholder="Nueva subcategoría…" value={newName}
                    onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
                <Button onClick={handleAdd} disabled={loading || !parentId || !newName.trim()}>
                    {loading ? <Loader2 className="animate-spin" /> : <Plus />} Agregar
                </Button>
            </div>

            <div className="space-y-4">
                {parents.map(p => (
                    <div key={p.id} className="rounded-md border">
                        <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
                            <span className="font-semibold">{p.name}</span>
                            <span className="text-xs text-muted-foreground">{total(p)} ideas{p.count > 0 && kids(p.id).length > 0 ? ` (${p.count} sin subcategoría)` : ''}</span>
                        </div>
                        {kids(p.id).map(k => (
                            <div key={k.id} className="flex items-center justify-between px-4 py-2 border-t">
                                <span className="pl-4">{k.name}</span>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs px-2 py-1 rounded-full ${k.count > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{k.count} ideas</span>
                                    <Button variant="ghost" size="sm" onClick={() => handleDelete(k)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                </div>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    )
}
