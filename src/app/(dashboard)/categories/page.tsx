'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sparkles, Trash2, Plus, Loader2 } from 'lucide-react'

export default function CategoriesPage() {
    const [categories, setCategories] = useState<any[]>([])
    const [newCategory, setNewCategory] = useState('')
    const [loading, setLoading] = useState(false)
    const supabase = createClient()

    useEffect(() => {
        fetchCategories()
    }, [])

    async function fetchCategories() {
        const { data } = await supabase.from('categories').select('*').order('created_at', { ascending: true })
        if (data) setCategories(data)
    }

    async function handleAdd() {
        if (!newCategory.trim()) return
        setLoading(true)

        // Auto-generate slug
        const slug = newCategory.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, '')

        const { error } = await supabase.from('categories').insert({
            name: newCategory,
            slug: slug
        })

        if (error) {
            console.error(error)
            alert('Error adding category')
        } else {
            setNewCategory('')
            fetchCategories()
        }
        setLoading(false)
    }

    async function handleDelete(id: string) {
        if (!confirm('Are you sure? This might affect existing ideas.')) return

        const { error } = await supabase.from('categories').delete().eq('id', id)
        if (error) {
            alert('Error deleting category')
        } else {
            fetchCategories()
        }
    }

    return (
        <div className="p-8 max-w-2xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold tracking-tight">Category Manager</h1>

            <div className="flex gap-4">
                <Input
                    placeholder="New Category Name..."
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
                <Button onClick={handleAdd} disabled={loading}>
                    {loading ? <Loader2 className="animate-spin" /> : <Plus />}
                    Add
                </Button>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Slug</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {categories.map((cat) => (
                            <TableRow key={cat.id}>
                                <TableCell className="font-medium">{cat.name}</TableCell>
                                <TableCell className="text-muted-foreground">{cat.slug}</TableCell>
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="sm" onClick={() => handleDelete(cat.id)}>
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
