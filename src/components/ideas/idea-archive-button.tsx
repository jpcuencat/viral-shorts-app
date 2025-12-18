'use client'

import { Button } from "@/components/ui/button"
import { Archive, RotateCcw } from 'lucide-react'
import { toggleArchiveIdea } from "@/app/actions/idea-actions"
import { useTransition } from "react"

interface OptionProps {
    id: string
    isArchived: boolean
}

export function IdeaArchiveButton({ id, isArchived }: OptionProps) {
    const [isPending, startTransition] = useTransition()

    const handleToggle = () => {
        startTransition(async () => {
            const result = await toggleArchiveIdea(id, !isArchived)
            if (result.error) {
                // native alert or toast if available
                console.error("Failed to update status")
            }
        })
    }

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
                e.preventDefault() // Prevent link navigation
                handleToggle()
            }}
            disabled={isPending}
            title={isArchived ? "Restore Idea" : "Archive Idea"}
            className="text-muted-foreground hover:text-foreground"
        >
            {isArchived ? (
                <RotateCcw className="h-4 w-4" />
            ) : (
                <Archive className="h-4 w-4" />
            )}
            <span className="sr-only">{isArchived ? "Restore" : "Archive"}</span>
        </Button>
    )
}
