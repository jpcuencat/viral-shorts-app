'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RotateCw, Sparkles } from 'lucide-react'
import { processTrends } from '@/app/actions/process-trends'
import { useRouter } from 'next/navigation'

export function RefreshTrendsButton() {
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    async function handleRefresh() {
        setLoading(true)
        try {
            const result = await processTrends()
            alert(`✅ Se analizaron ${result.processed} tendencias mundiales y se crearon ${result.created} nuevos guiones virales (${result.trendCategory || 'Tendencias'}).`)
            router.refresh()
        } catch (e) {
            console.error(e)
            alert('Error procesando las tendencias en vivo')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Button
            onClick={handleRefresh}
            disabled={loading}
            size="sm"
            variant="outline"
            className="gap-2"
        >
            <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Analyzing...' : 'Refresh Trends'}
        </Button>
    )
}
