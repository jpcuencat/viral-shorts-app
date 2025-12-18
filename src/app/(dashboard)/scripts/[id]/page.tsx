import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, Copy, Share2, Clock, Hash, Video } from 'lucide-react'
import Link from 'next/link'
import { ReelPlayer } from '@/components/ReelPlayer'
import { GenerateReelButton } from '@/components/GenerateReelButton'
import { ScriptActions } from '@/components/ScriptActions'

export default async function ScriptPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ tab?: string }> }) {
    const { id } = await params
    const { tab } = await searchParams
    const supabase = await createClient()

    // Fetch script ... (rest is same)


    // Fetch script joined with idea and reels
    const { data: script } = await supabase
        .from('scripts')
        .select(`
            *,
            ideas (
                title,
                description,
                categories (name)
            ),
            reels (
                *,
                reel_scenes (*)
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

    const reel = script.reels?.[0] || null

    return (
        <div className="max-w-6xl mx-auto space-y-8 pb-12">
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
                    <GenerateReelButton scriptId={id} />
                    <ScriptActions
                        content={content}
                        metadata={{
                            seo_title: script.seo_title || content?.seo_title,
                            hashtags: script.hashtags || content?.hashtags,
                            estimated_duration: script.estimated_duration || content?.estimated_duration
                        }}
                    />
                </div>
            </div>

            <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
                <div className="space-y-6">
                    <Tabs defaultValue={tab === 'reel' || reel ? "reel" : "script"} className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="script">Script View</TabsTrigger>
                            <TabsTrigger value="reel">Reel Preview</TabsTrigger>
                        </TabsList>

                        <TabsContent value="script" className="space-y-6 mt-4">
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
                        </TabsContent>

                        <TabsContent value="reel" className="mt-4">
                            {!reel ? (
                                <Card className="bg-slate-50 border-dashed dark:bg-slate-900/50">
                                    <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                                        <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center">
                                            <Video className="h-8 w-8 text-slate-400" />
                                        </div>
                                        <div className="text-center space-y-1">
                                            <h3 className="text-lg font-semibold">No Reel Generated Yet</h3>
                                            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                                Turn this script into a visual sequence with one click.
                                            </p>
                                        </div>
                                        <GenerateReelButton scriptId={id} />
                                    </CardContent>
                                </Card>
                            ) : (
                                <div className="space-y-4">
                                    <ReelPlayer
                                        scenes={reel.reel_scenes}
                                        quality={{
                                            score: reel.quality_score,
                                            feedback: reel.quality_feedback
                                        }}
                                    />
                                    <div className="text-center">
                                        <Badge variant={reel.status === 'completed' ? 'default' : 'outline'}>
                                            Status: {reel.status}
                                        </Badge>
                                    </div>
                                    <div className="flex justify-center gap-4 p-4">
                                        {reel.export_url && (
                                            <Button variant="outline" asChild>
                                                <a href={reel.export_url} download target="_blank">
                                                    <Share2 className="mr-2 h-4 w-4" />
                                                    Download Video
                                                </a>
                                            </Button>
                                        )}
                                        <GenerateReelButton scriptId={id} />
                                    </div>
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
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
        </div >
    )
}
