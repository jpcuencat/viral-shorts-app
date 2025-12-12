import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ChevronLeft, Edit2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IdeaActions } from '@/components/ideas/idea-actions'

export default async function IdeaDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()

    const { data: idea } = await supabase
        .from('ideas')
        .select('*, categories(name), scripts(id)')
        .eq('id', id)
        .single()

    if (!idea) {
        notFound()
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link href="/ideas">
                        <ChevronLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold tracking-tight">{idea.title}</h1>
                    <div className="flex items-center gap-2 mt-2">
                        {idea.categories?.name && (
                            <Badge variant="outline">{idea.categories.name}</Badge>
                        )}
                        <Badge variant={idea.status === 'approved' ? 'default' : 'secondary'}>
                            {idea.status.replace('_', ' ')}
                        </Badge>
                    </div>
                </div>
            </div>

            <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
                <div className="space-y-8">
                    <section className="space-y-4">
                        <h2 className="text-lg font-semibold">Description & Visual Hook</h2>
                        <div className="bg-card border rounded-lg p-6">
                            <p className="whitespace-pre-wrap leading-relaxed">{idea.description}</p>
                        </div>
                    </section>

                    {idea.ai_metadata && (
                        <section className="space-y-4">
                            <h2 className="text-lg font-semibold">AI Analysis</h2>
                            <div className="bg-card border rounded-lg p-6 grid gap-4 sm:grid-cols-2">
                                <div>
                                    <div className="text-sm text-muted-foreground">Viral Potential</div>
                                    <div className="text-2xl font-bold text-emerald-600">
                                        {idea.ai_metadata.viral_score ? `${idea.ai_metadata.viral_score}%` : <span className="text-muted-foreground text-sm font-normal">Not enough data</span>}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">Predicted retention rate</div>
                                </div>
                                <div>
                                    <div className="text-sm text-muted-foreground">Est. Duration</div>
                                    <div className="text-2xl font-bold">
                                        {idea.ai_metadata.estimated_duration || 45}s
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">Short format optimal</div>
                                </div>
                            </div>
                        </section>
                    )}
                </div>

                <div className="space-y-6">
                    <IdeaActions id={idea.id} currentStatus={idea.status} scriptId={idea.scripts?.[0]?.id} />
                </div>
            </div>
        </div>
    )
}
