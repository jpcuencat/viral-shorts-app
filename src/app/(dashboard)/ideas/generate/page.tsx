'use client'

import { useState, useEffect } from 'react'
import { generateIdeas } from '@/app/actions/generate-ideas'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Loader2, Sparkles, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function GenerateIdeasPage() {
    const [categories, setCategories] = useState<any[]>([])
    const [selectedCategory, setSelectedCategory] = useState<string>('')
    const [generatedIdeas, setGeneratedIdeas] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [savingId, setSavingId] = useState<number | null>(null)

    const supabase = createClient()
    const router = useRouter()

    useEffect(() => {
        async function fetchCategories() {
            const { data } = await supabase.from('categories').select('*')
            if (data) setCategories(data)
        }
        fetchCategories()
    }, [])

    async function handleGenerate() {
        if (!selectedCategory) return

        setLoading(true)
        setGeneratedIdeas([])

        try {
            // Find category name
            const categoryName = categories.find(c => c.id === selectedCategory)?.name || 'General'
            const response = await generateIdeas(categoryName)

            if (response.error) {
                alert(response.error)
            } else {
                setGeneratedIdeas(response.data || [])
            }
        } catch (e) {
            console.error(e)
            alert('Error generating ideas')
        } finally {
            setLoading(false)
        }
    }

    async function handleSave(idea: any, index: number) {
        setSavingId(index)
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                alert('You must be logged in to save ideas')
                return
            }

            const { error } = await supabase.from('ideas').insert({
                title: idea.title,
                description: idea.description,
                category_id: selectedCategory,
                status: 'pending_approval',
                user_id: user.id,
                ai_metadata: {
                    generated: true,
                    estimated_duration: idea.estimated_duration,
                    viral_score: idea.viral_score
                }
            })

            if (error) throw error

            // Remove from list or mark as saved
            setGeneratedIdeas(prev => prev.filter((_, i) => i !== index))
            router.refresh()

        } catch (e) {
            console.error(e)
            alert('Failed to save idea')
        } finally {
            setSavingId(null)
        }
    }

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-8">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Sparkles className="text-yellow-500" />
                    AI Idea Generator
                </h1>
                <p className="text-muted-foreground">
                    Use Google Gemini to brainstorm viral content ideas based on your categories.
                </p>
            </div>

            <div className="flex items-end gap-4 p-4 border rounded-lg bg-card">
                <div className="space-y-2 flex-1">
                    <Label>Target Category</Label>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a category..." />
                        </SelectTrigger>
                        <SelectContent>
                            {categories.map((cat) => (
                                <SelectItem key={cat.id} value={cat.id}>
                                    {cat.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <Button
                    onClick={handleGenerate}
                    disabled={!selectedCategory || loading}
                    size="lg"
                    className="min-w-[150px]"
                >
                    {loading ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Brainstorming...
                        </>
                    ) : (
                        <>
                            <Sparkles className="mr-2 h-4 w-4" />
                            Generate Ideas
                        </>
                    )}
                </Button>
            </div>

            {generatedIdeas.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2">
                    {generatedIdeas.map((idea, index) => (
                        <Card key={index} className="flex flex-col">
                            <CardHeader>
                                <CardTitle className="text-lg leading-tight">{idea.title}</CardTitle>
                            </CardHeader>
                            <CardContent className="flex-1">
                                <p className="text-sm text-muted-foreground mb-2">{idea.description}</p>
                                <div className="flex gap-2">
                                    <span className="text-xs bg-muted px-2 py-1 rounded">
                                        ⏱ {idea.estimated_duration}s
                                    </span>
                                    {idea.viral_score && (
                                        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-medium">
                                            🚀 {idea.viral_score}% Viral
                                        </span>
                                    )}
                                </div>
                            </CardContent>
                            <CardFooter className="pt-4 border-t bg-muted/20">
                                <Button
                                    className="w-full"
                                    onClick={() => handleSave(idea, index)}
                                    disabled={savingId === index}
                                    variant="secondary"
                                >
                                    {savingId === index ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <>
                                            <Check className="mr-2 h-4 w-4" />
                                            Approve & Save
                                        </>
                                    )}
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}

            {!loading && generatedIdeas.length === 0 && selectedCategory && (
                <div className="text-center py-12 text-muted-foreground">
                    Click generate to see magic happen.
                </div>
            )}
        </div>
    )
}
