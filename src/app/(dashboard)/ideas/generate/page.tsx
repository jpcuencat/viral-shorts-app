'use client'

import { useState, useEffect } from 'react'
import { generateIdeas } from '@/app/actions/generate-ideas'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Loader2, Sparkles, Check, Flame, FolderPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function GenerateIdeasPage() {
    const [categories, setCategories] = useState<any[]>([])
    const [selectedCategory, setSelectedCategory] = useState<string>('OPEN_TRENDS')
    const [selectedIndices, setSelectedIndices] = useState<number[]>([])
    const [isBulkSaving, setIsBulkSaving] = useState(false)
    const [generatedIdeas, setGeneratedIdeas] = useState<any[]>([])
    const [loading, setLoading] = useState(false)

    const supabase = createClient()
    const router = useRouter()

    useEffect(() => {
        async function fetchCategories() {
            const { data } = await supabase.from('categories').select('*').order('created_at', { ascending: false })
            if (data) setCategories(data)
        }
        fetchCategories()
    }, [])

    async function handleGenerate() {
        if (!selectedCategory) return

        setLoading(true)
        setGeneratedIdeas([])
        setSelectedIndices([])

        try {
            const categoryName =
                selectedCategory === 'OPEN_TRENDS'
                    ? 'OPEN_TRENDS'
                    : categories.find(c => c.id === selectedCategory)?.name || 'OPEN_TRENDS'

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

    function toggleSelection(index: number) {
        setSelectedIndices(prev =>
            prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
        )
    }

    async function ensureCategoryByName(rawName: string, currentCats: any[]): Promise<string> {
        const cleanName = (rawName || 'Tendencias').trim()
        const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

        const existing = currentCats.find(c => norm(c.name) === norm(cleanName))
        if (existing) return existing.id

        const slug = cleanName
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '-')
            .replace(/[^\w-]/g, '')

        const { data: bySlug } = await supabase
            .from('categories')
            .select('id, name')
            .eq('slug', slug)
            .maybeSingle()

        if (bySlug) {
            currentCats.push(bySlug)
            return bySlug.id
        }

        const { data: created } = await supabase
            .from('categories')
            .insert({ name: cleanName, slug })
            .select('id, name')
            .single()

        if (created) {
            currentCats.push(created)
            return created.id
        }

        return currentCats[0]?.id
    }

    async function handleBulkSave() {
        if (selectedIndices.length === 0) return

        setIsBulkSaving(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                alert('You must be logged in to save ideas')
                setIsBulkSaving(false)
                return
            }

            const localCats = [...categories]
            const ideasToSave = []

            for (const index of selectedIndices) {
                const idea = generatedIdeas[index]
                let categoryId = selectedCategory

                if (selectedCategory === 'OPEN_TRENDS' || idea.suggested_category) {
                    const targetCatName =
                        selectedCategory === 'OPEN_TRENDS'
                            ? idea.suggested_category || 'Tendencias'
                            : localCats.find(c => c.id === selectedCategory)?.name || idea.suggested_category

                    categoryId = await ensureCategoryByName(targetCatName, localCats)
                }

                ideasToSave.push({
                    title: idea.title,
                    description: idea.description,
                    category_id: categoryId,
                    status: 'pending_approval',
                    user_id: user.id,
                    ai_metadata: {
                        generated: true,
                        estimated_duration: idea.estimated_duration,
                        viral_score: idea.viral_score,
                        matched_trend: idea.matched_trend,
                        suggested_category: idea.suggested_category
                    }
                })
            }

            const { error } = await supabase.from('ideas').insert(ideasToSave)

            if (error) throw error

            router.push('/ideas')
            router.refresh()

        } catch (e) {
            console.error(e)
            alert('Failed to save ideas')
            setIsBulkSaving(false)
        }
    }

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-8 pb-32">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Sparkles className="text-yellow-500" />
                    AI Idea & Trend Generator
                </h1>
                <p className="text-muted-foreground">
                    Descubre tendencias virales de cualquier temática (X/Twitter, TikTok, Google Trends, Reddit y Noticias) o genera ideas por nicho. Las categorías nuevas se crean automáticamente.
                </p>
            </div>

            <div className="flex items-end gap-4 p-4 border rounded-lg bg-card">
                <div className="space-y-2 flex-1">
                    <Label>Modo / Categoría Objetivo</Label>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger>
                            <SelectValue placeholder="Selecciona modo o categoría..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="OPEN_TRENDS" className="font-semibold text-orange-600">
                                🔥 Tendencias Globales y Redes (Cualquier Tema - Auto-Categoría)
                            </SelectItem>
                            {categories.map((cat) => (
                                <SelectItem key={cat.id} value={cat.id}>
                                    📁 {cat.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <Button
                    onClick={handleGenerate}
                    disabled={!selectedCategory || loading}
                    size="lg"
                    className="min-w-[170px]"
                >
                    {loading ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Escaneando Redes...
                        </>
                    ) : (
                        <>
                            <Flame className="mr-2 h-4 w-4 text-orange-400" />
                            Generar Ideas
                        </>
                    )}
                </Button>
            </div>

            {generatedIdeas.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2">
                    {generatedIdeas.map((idea, index) => {
                        const isSelected = selectedIndices.includes(index)
                        return (
                            <Card
                                key={index}
                                className={`flex flex-col transition-all cursor-pointer border-2 ${isSelected ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-transparent hover:border-border'}`}
                                onClick={() => toggleSelection(index)}
                            >
                                <CardHeader>
                                    <div className="flex justify-between items-start gap-2">
                                        <CardTitle className="text-lg leading-tight">{idea.title}</CardTitle>
                                        <div className={`h-6 w-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30'}`}>
                                            {isSelected && <Check className="h-4 w-4" />}
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="flex-1 flex flex-col justify-between gap-3">
                                    <p className="text-sm text-muted-foreground">{idea.description}</p>
                                    <div className="flex flex-wrap gap-2 pt-2">
                                        {idea.suggested_category && (
                                            <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded font-medium border border-purple-200 flex items-center gap-1">
                                                <FolderPlus className="h-3 w-3" />
                                                {idea.suggested_category}
                                            </span>
                                        )}
                                        <span className="text-xs bg-muted px-2 py-1 rounded">
                                            ⏱ {idea.estimated_duration}s
                                        </span>
                                        {idea.matched_trend && (
                                            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded font-medium border border-orange-200">
                                                🔥 {idea.matched_trend}
                                            </span>
                                        )}
                                        {idea.viral_score && (
                                            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-medium">
                                                🚀 {idea.viral_score}% Viral
                                            </span>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {!loading && generatedIdeas.length === 0 && selectedCategory && (
                <div className="text-center py-12 text-muted-foreground">
                    Haz clic en <strong>Generar Ideas</strong> para escanear X/Twitter, TikTok, Google Trends y Noticias en vivo.
                </div>
            )}

            {selectedIndices.length > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-md p-4 animate-in slide-in-from-bottom-10 fade-in duration-300 pointer-events-none">
                    <div className="bg-foreground text-background rounded-full shadow-2xl p-4 flex items-center justify-between gap-4 pointer-events-auto">
                        <div className="pl-2 font-medium">
                            {selectedIndices.length} Idea{selectedIndices.length !== 1 && 's'} seleccionada{selectedIndices.length !== 1 && 's'}
                        </div>
                        <Button
                            onClick={handleBulkSave}
                            disabled={isBulkSaving}
                            className="rounded-full"
                            size="sm"
                        >
                            {isBulkSaving ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Check className="mr-2 h-4 w-4" />
                            )}
                            Guardar (Auto-Categoría)
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
