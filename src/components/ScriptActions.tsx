'use client'

import { Button } from '@/components/ui/button'
import { Copy, Share2, Check } from 'lucide-react'
import { useState } from 'react'

interface ScriptActionsProps {
    content: {
        hook_visual?: string
        hook_audio?: string
        body_paragraphs?: string[]
        cta?: string
    }
    metadata?: {
        seo_title?: string
        hashtags?: string[]
        estimated_duration?: number
    }
}

export function ScriptActions({ content, metadata }: ScriptActionsProps) {
    const [copied, setCopied] = useState(false)

    const formatScript = () => {
        const parts = [
            `TITLE: ${metadata?.seo_title || 'Untitled'}`,
            `DURATION: ~${metadata?.estimated_duration || 60}s`,
            `HASHTAGS: ${(metadata?.hashtags || []).map(t => `#${t}`).join(' ')}`,
            '\n-------------------\n',
            '🎬 THE HOOK (0-3s)',
            `Visual: ${content.hook_visual || 'N/A'}`,
            `Audio: "${content.hook_audio || 'N/A'}"`,
            '\n📺 THE BODY',
            ...(content.body_paragraphs || []),
            '\n📢 CALL TO ACTION',
            content.cta || 'Follow for more!'
        ]
        return parts.join('\n\n')
    }

    const handleCopy = async () => {
        try {
            const text = formatScript()
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy text: ', err)
            // Fallback for older browsers or non-secure contexts
            const textArea = document.createElement("textarea")
            textArea.value = formatScript()
            document.body.appendChild(textArea)
            textArea.focus()
            textArea.select()
            try {
                document.execCommand('copy')
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
            } catch (err2) {
                console.error('Fallback copy failed', err2)
            }
            document.body.removeChild(textArea)
        }
    }

    const handleExport = () => {
        const text = formatScript()
        const blob = new Blob([text], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `script-${new Date().toISOString().split('T')[0]}.txt`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    return (
        <>
            <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? (
                    <Check className="mr-2 h-4 w-4" />
                ) : (
                    <Copy className="mr-2 h-4 w-4" />
                )}
                {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
                <Share2 className="mr-2 h-4 w-4" />
                Export
            </Button>
        </>
    )
}
