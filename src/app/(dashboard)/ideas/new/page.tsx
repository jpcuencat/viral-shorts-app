import { flattenCategories } from '@/lib/ideas/category-options'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default async function NewIdeaPage() {
    const supabase = await createClient()

    // Fetch categories for the select dropdown
    const { data: categoryRows } = await supabase
        .from('categories')
        .select('id, name, parent_id, sort_order')
    const categories = flattenCategories(categoryRows || []).map(c => ({ id: c.id, name: c.label }))

    async function createIdea(formData: FormData) {
        'use server'

        const title = formData.get('title') as string
        const description = formData.get('description') as string
        const category_id = formData.get('category') as string
        const status = formData.get('status') as string

        if (!title) return

        const supabase = await createClient()

        await supabase.from('ideas').insert({
            title,
            description,
            category_id: category_id || null, // Handle empty selection
            status: status as any,
        })

        redirect('/ideas')
    }

    return (
        <div className="p-8 max-w-2xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">New Idea</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Idea Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <form action={createIdea} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="title">Title</Label>
                            <Input id="title" name="title" placeholder="e.g. 5 AI Tools for Productivity" required />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">Description (Concept)</Label>
                            <Textarea
                                id="description"
                                name="description"
                                placeholder="Briefly describe the video concept, hook, and key takeaways."
                                rows={4}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="category">Category</Label>
                                <Select name="category">
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories?.map((cat: any) => (
                                            <SelectItem key={cat.id} value={cat.id}>
                                                {cat.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="status">Initial Status</Label>
                                <Select name="status" defaultValue="draft">
                                    <SelectTrigger>
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="draft">Draft</SelectItem>
                                        <SelectItem value="pending_approval">Pending Approval</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="flex justify-end gap-4 pt-4">
                            <Button variant="outline" asChild>
                                <Link href="/ideas">Cancel</Link>
                            </Button>
                            <Button type="submit">Create Idea</Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}
