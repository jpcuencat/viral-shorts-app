export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            categories: {
                Row: {
                    id: string
                    name: string
                    slug: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    slug: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    slug?: string
                    created_at?: string
                }
            }
            ideas: {
                Row: {
                    id: string
                    title: string
                    description: string | null
                    status: 'draft' | 'pending_approval' | 'approved' | 'rejected'
                    category_id: string | null
                    linear_issue_id: string | null
                    linear_issue_url: string | null
                    ai_metadata: Json | null
                    thumbnail_url: string | null
                    created_at: string
                    user_id: string | null
                }
                Insert: {
                    id?: string
                    title: string
                    description?: string | null
                    status?: 'draft' | 'pending_approval' | 'approved' | 'rejected'
                    category_id?: string | null
                    linear_issue_id?: string | null
                    linear_issue_url?: string | null
                    ai_metadata?: Json | null
                    thumbnail_url?: string | null
                    created_at?: string
                    user_id?: string | null
                }
                Update: {
                    id?: string
                    title?: string
                    description?: string | null
                    status?: 'draft' | 'pending_approval' | 'approved' | 'rejected'
                    category_id?: string | null
                    linear_issue_id?: string | null
                    linear_issue_url?: string | null
                    ai_metadata?: Json | null
                    thumbnail_url?: string | null
                    created_at?: string
                    user_id?: string | null
                }
            }
        }
    }
}
