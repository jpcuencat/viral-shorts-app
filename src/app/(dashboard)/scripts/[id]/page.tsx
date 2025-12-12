import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, Copy, Share2, Clock, Hash } from 'lucide-react'
import Link from 'next/link'

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()

    // Fetch script joined with idea
    const { data: script } = await supabase
        .from('scripts')
        .select(`
            *,
            ideas (
                title,
                description,
                categories (name)
            )
        `)
        .eq('id', id)
        .single()

    if (!script) notFound()

    // Parse content if it's stringified
    let content: any = script.content
    if (typeof content === 'string') {
        try {
            content = JSON.parse(content)
        } catch (e) {
            console.error('Failed to parse script content', e)
        }
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-12">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link href={`/ideas/${script.idea_id}`}>
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Script Editor</h1>
                    <p className="text-muted-foreground text-sm font-medium">{script.ideas?.title}</p>
                </div>
                <div className="ml-auto flex gap-2">
                    <Button variant="outline" size="sm">
                        <Copy className="mr-2 h-4 w-4" />
                        Copy
                    </Button>
                    <Button variant="outline" size="sm">
                        <Share2 className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                </div>
            </div>

            <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
                <div className="space-y-6">
                    {/* Visual Hook & Audio Hook */}
                    <Card className="border-l-4 border-l-yellow-400">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg flex items-center gap-2">
                                🎬 The Hook (0-3s)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Visual</span>
                                <p className="mt-1 font-medium">{content?.hook_visual || 'N/A'}</p>
                            </div>
                            <div>
                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Audio</span>
                                <p className="mt-1 text-xl font-serif italic text-primary">"{content?.hook_audio || 'N/A'}"</p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Body */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg">📺 The Body (Storytelling)</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {content?.body_paragraphs?.map((paragraph: string, i: number) => (
                                <p key={i} className="leading-relaxed text-lg text-slate-700 dark:text-slate-300">
                                    {paragraph}
                                </p>
                            )) || <p>No content generated.</p>}
                        </CardContent>
                    </Card>

                    {/* CTA */}
                    <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/10">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg">📢 Call to Action</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="font-semibold text-lg">{content?.cta || 'Follow for more!'}</p>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Metadata & SEO</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Est. Duration</label>
                                <div className="flex items-center gap-2 mt-1">
                                    <Clock className="w-4 h-4 text-muted-foreground" />
                                    <span className="font-bold">{script.estimated_duration || content?.estimated_duration || 60}s</span>
                                </div>
                            </div>
                            <Separator />
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Hashtags</label>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {script.hashtags?.map((tag: string) => (
                                        <Badge key={tag} variant="secondary" className="text-xs">
                                            {tag}
                                        </Badge>
                                    )) || content?.hashtags?.map((tag: string) => (
                                        <Badge key={tag} variant="secondary" className="text-xs">
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                            <Separator />
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">SEO Title</label>
                                <p className="text-sm mt-1">{script.seo_title || content?.seo_title}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
