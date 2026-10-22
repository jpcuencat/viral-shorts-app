import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Plus, Sparkles, Clock, Calendar, FileText } from 'lucide-react'
import { IdeaFilters } from '@/components/ideas/idea-filters'
import { IdeaArchiveButton } from '@/components/ideas/idea-archive-button'

// Update signature to accept searchParams
export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ status?: string, category?: string, show_archived?: string }> }) {
    const supabase = await createClient()
    const { status, category, show_archived } = await searchParams
    const showArchived = show_archived === 'true'

    // Fetch categories for filter
    const { data: categories } = await supabase.from('categories').select('id, name').order('name')

    // Start building query
    let query = supabase
        .from('ideas')
        .select('*, categories(name), scripts(id)')
        .order('created_at', { ascending: false })

    // Apply filters
    if (status) {
        query = query.eq('status', status)
    }
    if (category) {
        query = query.eq('category_id', category)
    }

    // Archive Logic: 
    // If NOT showing archived explicitly, filtering OUT archived items.
    // Use user request: "see only active ones but with a button to see all states"
    // So if showArchived is FALSE, we hide archived.
    // If showArchived is TRUE, we show everything (don't filter is_archived) OR show only archived?
    // "ver todos los estados" -> See ALL.
    if (!showArchived) {
        query = query.eq('is_archived', false)
    }

    const { data: ideas } = await query

    return (
        <div className="space-y-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Ideas Library</h1>
                    <p className="text-muted-foreground mt-2">Manage your generated content ideas.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="secondary" asChild>
                        <Link href="/ideas/generate">
                            <Sparkles className="mr-2 h-4 w-4 text-yellow-500" />
                            Generate with AI
                        </Link>
                    </Button>
                    <Button asChild>
                        <Link href="/ideas/new">
                            <Plus className="mr-2 h-4 w-4" />
                            New Idea
                        </Link>
                    </Button>
                </div>
            </div>

            <IdeaFilters categories={categories || []} />

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {ideas && ideas.length > 0 ? (
                    ideas.map((idea: any) => (
                        <div key={idea.id} className={`group relative flex flex-col justify-between space-y-4 rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md ${idea.is_archived ? 'opacity-60 grayscale' : ''}`}>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        {idea.categories?.name ? (
                                            <Badge variant="outline">{idea.categories.name}</Badge>
                                        ) : (
                                            <Badge variant="outline">Uncategorized</Badge>
                                        )}
                                        {/* Fecha de la tendencia de origen (antes era una categoría por día) */}
                                        {typeof idea.ai_metadata?.trend_bucket === 'string' && (
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                {idea.ai_metadata.trend_bucket.replace(/^Tendencias\s+/i, '')}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <Badge variant={
                                            idea.status === 'approved' ? 'default' :
                                                idea.status === 'rejected' ? 'destructive' :
                                                    'secondary'
                                        }>
                                            {idea.status ? idea.status.replace('_', ' ') : 'Draft'}
                                        </Badge>

                                        {/* Archive Button */}
                                        <IdeaArchiveButton id={idea.id} isArchived={!!idea.is_archived} />
                                    </div>
                                </div>
                                <h3 className="font-semibold text-lg leading-tight tracking-tight line-clamp-2">
                                    <Link href={`/ideas/${idea.id}`} className="hover:underline">
                                        {idea.title}
                                    </Link>
                                </h3>
                                <p className="text-sm text-muted-foreground line-clamp-3">
                                    {idea.description}
                                </p>
                            </div>

                            <div className="space-y-3">
                                {idea.ai_metadata?.viral_score && (
                                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded w-fit">
                                        <Sparkles className="w-3 h-3" />
                                        {idea.ai_metadata.viral_score}% Viral Score
                                    </div>
                                )}
                                <div className="flex items-center gap-4 pt-4 border-t text-sm text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {idea.ai_metadata?.estimated_duration || 45}s
                                    </span>
                                    {idea.scripts && idea.scripts.length > 0 && (
                                        <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200 gap-1">
                                            <FileText className="w-3 h-3" />
                                            Script Ready
                                        </Badge>
                                    )}
                                    <Link href={`/ideas/${idea.id}`} className="ml-auto text-primary font-medium hover:underline">
                                        View Details
                                    </Link>
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="col-span-full flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-lg bg-muted/50">
                        <Sparkles className="h-10 w-10 text-muted-foreground mb-4 opacity-50" />
                        <h3 className="text-lg font-semibold">No ideas yet</h3>
                        <p className="max-w-xs text-center mt-1">Start generating viral ideas with AI or add one manually.</p>
                        <Button variant="secondary" className="mt-4" asChild>
                            <Link href="/ideas/generate">Start Generating</Link>
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
