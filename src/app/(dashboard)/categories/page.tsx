'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Trash2, Plus, Loader2 } from 'lucide-react'
import { getCategories, addCategory, deleteCategory } from '@/app/actions/category-actions'

export default function CategoriesPage() {
    const [categories, setCategories] = useState<any[]>([])
    const [newCategory, setNewCategory] = useState('')
    const [loading, setLoading] = useState(false)
    const [highlightId, setHighlightId] = useState<string | null>(null)

    useEffect(() => {
        loadCategories()
    }, [])

    async function loadCategories() {
        // Use Server Action
        const data = await getCategories()
        setCategories(data)
    }

    async function handleAdd() {
        if (!newCategory.trim()) return
        setLoading(true)

        // Use Server Action
        const result = await addCategory(newCategory)

        if (result.success) {
            setNewCategory('')
            loadCategories()
        } else {
            const msg = result.message || 'Error adding category'
            alert(msg)

            // Highlight existing if duplicate
            if (msg.toLowerCase().includes('ya existe')) {
                const existing = categories.find(c => c.name.toLowerCase() === newCategory.toLowerCase())
                if (existing) {
                    setHighlightId(existing.id)
                    // Scroll to row? (optional, but highlight is good)
                    setTimeout(() => setHighlightId(null), 3000)
                }
            }
        }
        setLoading(false)
    }

    async function handleDelete(id: string) {
        // Optional: The server action also checks this, but UI check is faster
        const cat = categories.find(c => c.id === id)
        if (cat && cat.count > 0) {
            alert(`Cannot delete category "${cat.name}" because it has ${cat.count} ideas. Please delete the ideas first.`)
            return
        }

        if (!confirm('Are you sure you want to delete this category?')) return

        const result = await deleteCategory(id)
        if (result.success) {
            loadCategories()
        } else {
            alert(result.message || 'Error deleting category')
        }
    }

    return (
        <div className="p-8 max-w-2xl mx-auto space-y-8">
            <h1 className="text-3xl font-bold tracking-tight">Category Manager</h1>

            <div className="flex gap-4">
                <Input
                    placeholder="New Category Name... (e.g. 'Tech')"
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
                            <TableHead>Idea Count</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {categories.map((cat) => (
                            <TableRow
                                key={cat.id}
                                className={`transition-colors duration-500 ${highlightId === cat.id ? 'bg-yellow-100 dark:bg-yellow-900/50' : ''}`}
                            >
                                <TableCell className="font-medium">
                                    {cat.name}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{cat.slug}</TableCell>
                                <TableCell>
                                    <span className={`text-xs px-2 py-1 rounded-full ${cat.count > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                                        {cat.count} Ideas
                                    </span>
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDelete(cat.id)}
                                        className="hover:bg-red-50"
                                    >
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
