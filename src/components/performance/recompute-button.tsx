'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { recomputeInsights } from '@/app/actions/performance-actions'

export function RecomputeInsightsButton() {
    const [pending, start] = useTransition()
    const [msg, setMsg] = useState('')
    return (
        <div className="flex items-center gap-3">
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
            <Button variant="outline" disabled={pending} onClick={() => start(async () => {
                setMsg('')
                const r = await recomputeInsights()
                setMsg(r.error ? r.error : 'Lecciones actualizadas')
            })}>
                <RefreshCw className={`mr-2 h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
                {pending ? 'Analizando…' : 'Recalcular lecciones'}
            </Button>
        </div>
    )
}
