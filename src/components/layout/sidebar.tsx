'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Menu, Lightbulb, Grid, PlusCircle, Settings, LogOut, LayoutDashboard } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    const pathname = usePathname()
    const router = useRouter()
    const supabase = createClient()
    const [user, setUser] = useState<any>(null)

    useEffect(() => {
        async function getUser() {
            const { data: { user } } = await supabase.auth.getUser()
            setUser(user)
        }
        getUser()
    }, [])

    const handleLogout = async () => {
        await supabase.auth.signOut()
        router.refresh()
        router.push('/login')
    }

    const routes = [
        {
            label: 'Dashboard',
            icon: LayoutDashboard,
            href: '/dashboard',
            isActive: pathname === '/dashboard' || pathname === '/ideas',
        },
        {
            label: 'Ideas Library',
            icon: Lightbulb,
            href: '/ideas',
            isActive: pathname === '/ideas',
        },
        {
            label: 'New Idea',
            icon: PlusCircle,
            href: '/ideas/new',
            isActive: pathname === '/ideas/new',
        },
        {
            label: 'Generator',
            icon: Grid,
            href: '/ideas/generate',
            isActive: pathname === '/ideas/generate',
        },
        {
            label: 'Categories',
            icon: Grid, // Or another icon
            href: '/categories',
            isActive: pathname === '/categories',
        },
    ]

    return (
        <div className={cn("pb-12 h-screen border-r bg-background", className)}>
            <div className="space-y-4 py-4 h-full flex flex-col">
                <div className="px-3 py-2">
                    <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight text-primary flex items-center gap-2">
                        <Lightbulb className="w-5 h-5" />
                        RealsAI
                    </h2>
                    <div className="space-y-1">
                        {routes.map((route) => (
                            <Button
                                key={route.href}
                                variant={route.isActive ? "secondary" : "ghost"}
                                className="w-full justify-start"
                                asChild
                            >
                                <Link href={route.href}>
                                    <route.icon className="mr-2 h-4 w-4" />
                                    {route.label}
                                </Link>
                            </Button>
                        ))}
                    </div>
                </div>

                <div className="mt-auto px-3 py-2">
                    <div className="flex items-center gap-3 px-4 py-4 mb-2 border-t">
                        <Avatar>
                            <AvatarImage src={user?.user_metadata?.avatar_url} />
                            <AvatarFallback>{user?.email?.substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col overflow-hidden">
                            <span className="text-sm font-medium truncate">{user?.email}</span>
                            <span className="text-xs text-muted-foreground">Pro Plan</span>
                        </div>
                    </div>

                    <Button variant="ghost" className="w-full justify-start text-red-500 hover:text-red-500 hover:bg-red-50" onClick={handleLogout}>
                        <LogOut className="mr-2 h-4 w-4" />
                        Log Out
                    </Button>
                </div>
            </div>
        </div>
    )
}
