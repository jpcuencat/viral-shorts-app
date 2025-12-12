import { Sidebar } from "@/components/layout/sidebar"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    return (
        <div className="flex h-screen overflow-hidden">
            <Sidebar className="w-64 hidden md:block" />
            <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-8">
                {children}
            </main>
        </div>
    )
}
