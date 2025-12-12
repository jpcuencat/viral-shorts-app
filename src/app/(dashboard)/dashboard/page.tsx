import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from 'next/link'
import { Sparkles, Library, Layers, ArrowRight, Play, FileText, TrendingUp } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export default async function DashboardPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Fetch recent ideas
    const { data: recentIdeas } = await supabase
        .from('ideas')
        .select('*, categories(name)')
        .order('created_at', { ascending: false })
        .limit(5)

    // Fetch top viral ideas
    const { data: topViral } = await supabase
        .from('ideas')
        .select('*')
        .order('ai_metadata->viral_score', { ascending: false })
        .limit(4)

    const modules = [
        {
            title: "Idea Generator",
            description: "Create new viral concepts with AI assistance",
            icon: Sparkles,
            href: "/ideas/generate",
            color: "text-yellow-500",
            bgColor: "bg-yellow-50 dark:bg-yellow-900/20"
        },
        {
            title: "Content Library",
            description: "Manage, edit, and export your approved scripts",
            icon: Library,
            href: "/ideas",
            color: "text-blue-500",
            bgColor: "bg-blue-50 dark:bg-blue-900/20"
        },
        {
            title: "Topic Manager",
            description: "Configure niches and categories for generation",
            icon: Layers,
            href: "/categories",
            color: "text-purple-500",
            bgColor: "bg-purple-50 dark:bg-purple-900/20"
        }
    ]

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Welcome back!</h1>
                <p className="text-muted-foreground">Here's an overview of your creative studio.</p>
            </div>

            {/* Modules Grid */}
            <div className="grid gap-6 md:grid-cols-3">
                {modules.map((module) => (
                    <Card key={module.title} className="flex flex-col">
                        <CardHeader className="flex-row gap-4 items-center space-y-0 pb-2">
                            <div className={`p-3 rounded-lg ${module.bgColor}`}>
                                <module.icon className={`w-6 h-6 ${module.color}`} />
                            </div>
                            <div className="space-y-1">
                                <CardTitle className="text-lg">{module.title}</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-4 flex-1">
                            <CardDescription className="text-sm">
                                {module.description}
                            </CardDescription>
                        </CardContent>
                        <CardFooter>
                            <Button className="w-full" variant="secondary" asChild>
                                <Link href={module.href}>Open</Link>
                            </Button>
                        </CardFooter>
                    </Card>
                ))}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Recent Files Section */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold tracking-tight">Recent Ideas</h2>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/ideas" className="text-muted-foreground">View All</Link>
                        </Button>
                    </div>

                    <Card>
                        <CardContent className="p-0">
                            {recentIdeas?.map((idea: any) => (
                                <div key={idea.id} className="flex items-center justify-between p-4 border-b last:border-0 hover:bg-muted/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className="p-2 bg-primary/10 rounded-md">
                                            <FileText className="w-4 h-4 text-primary" />
                                        </div>
                                        <div>
                                            <div className="font-medium line-clamp-1">{idea.title}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {formatDistanceToNow(new Date(idea.created_at), { addSuffix: true })} • {idea.categories?.name}
                                            </div>
                                        </div>
                                    </div>
                                    <Button variant="ghost" size="sm" asChild>
                                        <Link href={`/ideas/${idea.id}`}>Open</Link>
                                    </Button>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </div>

                {/* Top Viral Section (Active Projects equivalent) */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold tracking-tight">Top Viral Potential</h2>
                        <Badge variant="outline" className="text-muted-foreground">AI Prediction</Badge>
                    </div>

                    <Card>
                        <CardContent className="p-6 space-y-6">
                            {topViral?.map((idea: any) => {
                                const score = idea.ai_metadata?.viral_score || 0
                                return (
                                    <div key={idea.id} className="space-y-2">
                                        <div className="flex items-center justify-between text-sm">
                                            <div className="font-medium truncate max-w-[200px]">{idea.title}</div>
                                            <span className="font-bold text-muted-foreground">{score}%</span>
                                        </div>
                                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${score >= 90 ? 'bg-emerald-500' :
                                                        score >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                                                    }`}
                                                style={{ width: `${score}%` }}
                                            />
                                        </div>
                                    </div>
                                )
                            })}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
