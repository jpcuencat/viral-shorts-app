'use client'

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useRouter, useSearchParams } from "next/navigation"

interface IdeaFiltersProps {
    categories: { id: string; name: string }[]
}

export function IdeaFilters({ categories }: IdeaFiltersProps) {
    const router = useRouter()
    const searchParams = useSearchParams()

    const currentStatus = searchParams.get('status') || 'all'
    const currentCategory = searchParams.get('category') || 'all'

    function handleFilterChange(key: 'status' | 'category', value: string) {
        const params = new URLSearchParams(searchParams)
        if (value === 'all') {
            params.delete(key)
        } else {
            params.set(key, value)
        }
        router.push(`/ideas?${params.toString()}`)
    }

    return (
        <div className="flex flex-wrap gap-4">
            <Select
                value={currentStatus}
                onValueChange={(val) => handleFilterChange('status', val)}
            >
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filter by Status" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="pending_approval">Pending Approval</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
            </Select>

            <Select
                value={currentCategory}
                onValueChange={(val) => handleFilterChange('category', val)}
            >
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filter by Category" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>


            <Button
                variant={searchParams.get('show_archived') === 'true' ? 'secondary' : 'outline'}
                onClick={() => {
                    const params = new URLSearchParams(searchParams)
                    const isArchived = params.get('show_archived') === 'true'
                    if (isArchived) {
                        params.delete('show_archived')
                    } else {
                        params.set('show_archived', 'true')
                    }
                    router.push(`/ideas?${params.toString()}`)
                }}
            >
                {searchParams.get('show_archived') === 'true' ? 'Hide Archived' : 'Show Archived'}
            </Button>
        </div >
    )
}
