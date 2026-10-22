'use client'

import { Button } from '@/components/ui/button'
import { RotateCw } from 'lucide-react'
import { useGeneration } from '@/context/generation-context'

export function RefreshTrendsButton() {
    const { startTrendsAnalysis, isTrendsRunning } = useGeneration()

    return (
        <Button
            onClick={() => startTrendsAnalysis()}
            disabled={isTrendsRunning}
            size="sm"
            variant="outline"
            className="gap-2"
        >
            <RotateCw className={`h-4 w-4 ${isTrendsRunning ? 'animate-spin' : ''}`} />
            {isTrendsRunning ? 'Analizando…' : 'Refresh Trends'}
        </Button>
    )
}
