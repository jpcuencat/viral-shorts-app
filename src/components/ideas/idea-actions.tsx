'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Check, X, Trash2, Video, RefreshCw } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { useRouter } from 'next/navigation'
import { updateIdeaStatus, deleteIdea } from '@/app/actions/idea-actions'
import { generateScript, regenerateScript } from '@/app/actions/generate-script'

interface IdeaActionsProps {
    id: string
    currentStatus: string
    scriptId?: string
    scriptCount?: number
}

export function IdeaActions({ id, currentStatus, scriptId, scriptCount = 0 }: IdeaActionsProps) {
    const [loading, setLoading] = useState(false)
    const [regenOpen, setRegenOpen] = useState(false)
    const [feedback, setFeedback] = useState('')
    const router = useRouter()

    async function handleStatusUpdate(status: 'approved' | 'rejected') {
        setLoading(true)
        try {
            await updateIdeaStatus(id, status)
            router.refresh()
        } catch (e) {
            console.error(e)
            alert('Failed to update status')
        } finally {
            setLoading(false)
        }
    }

    async function handleDelete() {
        if (!confirm('Are you sure you want to delete this idea?')) return

        setLoading(true)
        try {
            await deleteIdea(id)
            router.push('/ideas')
        } catch (e) {
            console.error(e)
            alert('Failed to delete')
            setLoading(false)
        }
    }

    async function handleGenerateScript() {
        setLoading(true)
        try {
            const result = await generateScript(id)
            if (result.error) {
                alert(result.error)
            } else if (result.scriptId) {
                router.push(`/scripts/${result.scriptId}`)
            }
        } catch (e) {
            console.error(e)
            alert('Unexpected error')
        } finally {
            setLoading(false)
        }
    }

    async function handleRegenerateScript() {
        setLoading(true)
        try {
            const result = await regenerateScript(id, feedback)
            if (result.error) {
                alert(result.error)
            } else if (result.scriptId) {
                setRegenOpen(false)
                setFeedback('')
                router.push(`/scripts/${result.scriptId}`)
            }
        } catch (e) {
            console.error(e)
            alert('Error inesperado al regenerar el guion')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-4">
            {currentStatus === 'approved' && !scriptId && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800 flex flex-col gap-2">
                    <div className="flex items-center gap-2 font-medium">
                        <Check className="h-4 w-4" />
                        Idea Approved!
                    </div>
                    <p>Great choice. The next step is to generate a script for this idea.</p>
                </div>
            )}

            {currentStatus === 'rejected' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800 flex flex-col gap-2">
                    <div className="flex items-center gap-2 font-medium">
                        <X className="h-4 w-4" />
                        Idea Rejected
                    </div>
                    <p>This idea has been flagged. You can delete it to clean up your workspace or keep it for reference.</p>
                </div>
            )}

            <div className="bg-muted/30 p-4 rounded-lg border space-y-3">
                <h3 className="font-medium mb-2">Actions</h3>

                {currentStatus === 'pending_approval' && (
                    <>
                        <Button
                            className="w-full bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => handleStatusUpdate('approved')}
                            disabled={loading}
                        >
                            <Check className="mr-2 h-4 w-4" />
                            Approve Idea
                        </Button>
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => handleStatusUpdate('rejected')}
                            disabled={loading}
                        >
                            <X className="mr-2 h-4 w-4" />
                            Reject Idea
                        </Button>
                    </>
                )}

                {currentStatus === 'approved' && !scriptId && (
                    <Button
                        className="w-full"
                        variant="default" // Changed to default to emphasize next step
                        onClick={handleGenerateScript}
                        disabled={loading}
                    >
                        <Video className="mr-2 h-4 w-4" />
                        Create Script with AI
                    </Button>
                )}

                {scriptId && (
                    <Button
                        className="w-full cursor-pointer hover:bg-slate-200 transaction-colors"
                        variant="secondary"
                        onClick={() => router.push(`/scripts/${scriptId}`)}
                    >
                        <Video className="mr-2 h-4 w-4" />
                        View Generated Script{scriptCount > 1 ? ` (versión ${scriptCount})` : ''}
                    </Button>
                )}

                {scriptId && currentStatus === 'approved' && !regenOpen && (
                    <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => setRegenOpen(true)}
                        disabled={loading}
                    >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Regenerar guion
                    </Button>
                )}

                {scriptId && currentStatus === 'approved' && regenOpen && (
                    <div className="space-y-2 rounded-md border bg-background p-3">
                        <p className="text-sm font-medium">¿Qué debe corregir el nuevo guion? (opcional)</p>
                        <Textarea
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            placeholder="Ej.: el dato de la fecha está mal; el gancho es muy exagerado; enfócate en la fiscal y no en el contexto político…"
                            rows={4}
                            disabled={loading}
                        />
                        <p className="text-xs text-muted-foreground">
                            Se crea una versión nueva con verificación de hechos actualizada. El guion anterior y su reel quedan guardados.
                        </p>
                        <div className="flex gap-2">
                            <Button className="flex-1" onClick={handleRegenerateScript} disabled={loading}>
                                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                                {loading ? 'Regenerando…' : 'Regenerar'}
                            </Button>
                            <Button variant="ghost" onClick={() => setRegenOpen(false)} disabled={loading}>
                                Cancelar
                            </Button>
                        </div>
                    </div>
                )}

                {currentStatus === 'rejected' && (
                    <Button
                        variant="outline"
                        className="w-full hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200"
                        onClick={() => handleStatusUpdate('approved')}
                        disabled={loading}
                    >
                        <Check className="mr-2 h-4 w-4" />
                        Reconsider & Approve
                    </Button>
                )}

                {currentStatus !== 'approved' && (
                    <Button
                        variant="destructive"
                        className="w-full"
                        onClick={handleDelete}
                        disabled={loading}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Idea
                    </Button>
                )}
            </div>
        </div>
    )
}
