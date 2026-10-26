'use client'

import { Button } from '@/components/ui/button'
import { RotateCw } from 'lucide-react'
import { useRouter } from 'next/navigation'

/**
 * Abre el generador en modo "Todo lo que es tendencia" y lanza la búsqueda: las ideas se revisan y
 * solo se guardan en la biblioteca las que el creador selecciona (ya no se guardan todas solas).
 */
export function RefreshTrendsButton() {
    const router = useRouter()
    return (
        <Button onClick={() => router.push('/ideas/generate?auto=1')} size="sm" variant="outline" className="gap-2">
            <RotateCw className="h-4 w-4" />
            Refresh Trends
        </Button>
    )
}
