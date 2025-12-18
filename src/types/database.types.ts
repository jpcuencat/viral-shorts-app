export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export type Database = {
    // Allows to automatically instantiate createClient with right options
    // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
    __InternalSupabase: {
        PostgrestVersion: "13.0.5"
    }
    public: {
        Tables: {
            categories: {
                Row: {
                    created_at: string | null
                    id: string
                    name: string
                    slug: string
                }
                Insert: {
                    created_at?: string | null
                    id?: string
                    name: string
                    slug: string
                }
                Update: {
                    created_at?: string | null
                    id?: string
                    name?: string
                    slug?: string
                }
                Relationships: []
            }
            ideas: {
                Row: {
                    ai_metadata: Json | null
                    category_id: string | null
                    created_at: string | null
                    description: string | null
                    id: string
                    source_trend_id: string | null
                    status: Database["public"]["Enums"]["idea_status"] | null
                    thumbnail_url: string | null
                    title: string
                    user_id: string | null
                    is_archived: boolean | null
                }
                Insert: {
                    ai_metadata?: Json | null
                    category_id?: string | null
                    created_at?: string | null
                    description?: string | null
                    id?: string
                    source_trend_id?: string | null
                    status?: Database["public"]["Enums"]["idea_status"] | null
                    thumbnail_url?: string | null
                    title: string
                    user_id?: string | null
                    is_archived?: boolean | null
                }
                Update: {
                    ai_metadata?: Json | null
                    category_id?: string | null
                    created_at?: string | null
                    description?: string | null
                    id?: string
                    source_trend_id?: string | null
                    status?: Database["public"]["Enums"]["idea_status"] | null
                    thumbnail_url?: string | null
                    title: string
                    user_id?: string | null
                    is_archived?: boolean | null
                }
                Relationships: [
                    {
                        foreignKeyName: "ideas_category_id_fkey"
                        columns: ["category_id"]
                        isOneToOne: false
                        referencedRelation: "categories"
                        referencedColumns: ["id"]
                    },
                ]
            }
            reel_scenes: {
                Row: {
                    audio_url: string | null
                    content_text: string | null
                    created_at: string
                    duration: number | null
                    id: string
                    image_prompt: string | null
                    image_url: string | null
                    reel_id: string
                    scene_order: number
                }
                Insert: {
                    audio_url?: string | null
                    content_text?: string | null
                    created_at?: string
                    duration?: number | null
                    id?: string
                    image_prompt?: string | null
                    image_url?: string | null
                    reel_id: string
                    scene_order: number
                }
                Update: {
                    audio_url?: string | null
                    content_text?: string | null
                    created_at?: string
                    duration?: number | null
                    id?: string
                    image_prompt?: string | null
                    image_url?: string | null
                    reel_id?: string
                    scene_order?: number
                }
                Relationships: [
                    {
                        foreignKeyName: "reel_scenes_reel_id_fkey"
                        columns: ["reel_id"]
                        isOneToOne: false
                        referencedRelation: "reels"
                        referencedColumns: ["id"]
                    },
                ]
            }
            reels: {
                Row: {
                    created_at: string
                    export_url: string | null
                    id: string
                    script_id: string | null
                    status: string
                    user_id: string | null
                    quality_score: number | null
                    quality_feedback: string | null
                }
                Insert: {
                    created_at?: string
                    export_url?: string | null
                    id?: string
                    script_id?: string | null
                    status?: string
                    user_id?: string | null
                    quality_score?: number | null
                    quality_feedback?: string | null
                }
                Update: {
                    created_at?: string
                    export_url?: string | null
                    id?: string
                    script_id?: string | null
                    status?: string
                    user_id?: string | null
                    quality_score?: number | null
                    quality_feedback?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "reels_script_id_fkey"
                        columns: ["script_id"]
                        isOneToOne: false
                        referencedRelation: "scripts"
                        referencedColumns: ["id"]
                    },
                ]
            }
            scripts: {
                Row: {
                    content: Json | null
                    created_at: string | null
                    estimated_duration: number | null
                    hashtags: string[] | null
                    id: string
                    idea_id: string | null
                    seo_description: string | null
                    seo_title: string | null
                    status: Database["public"]["Enums"]["script_status"] | null
                    user_id: string | null
                }
                Insert: {
                    content?: Json | null
                    created_at?: string | null
                    estimated_duration?: number | null
                    hashtags?: string[] | null
                    id?: string
                    idea_id?: string | null
                    seo_description?: string | null
                    seo_title?: string | null
                    status?: Database["public"]["Enums"]["script_status"] | null
                    user_id?: string | null
                }
                Update: {
                    content?: Json | null
                    created_at?: string | null
                    estimated_duration?: number | null
                    hashtags?: string[] | null
                    id?: string
                    idea_id?: string | null
                    seo_description?: string | null
                    seo_title?: string | null
                    status?: Database["public"]["Enums"]["script_status"] | null
                    user_id?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "scripts_idea_id_fkey"
                        columns: ["idea_id"]
                        isOneToOne: false
                        referencedRelation: "ideas"
                        referencedColumns: ["id"]
                    },
                ]
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            idea_status: "draft" | "pending_approval" | "approved" | "rejected"
            script_status: "draft" | "finalized"
        }
        CompositeTypes: {
            [_ in never]: never
        }
    }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
    PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
            Row: infer R
        }
    ? R
    : never
    : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
            Row: infer R
        }
    ? R
    : never
    : never

export type TablesInsert<
    PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
        Insert: infer I
    }
    ? I
    : never
    : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
    }
    ? I
    : never
    : never

export type TablesUpdate<
    PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
        Update: infer U
    }
    ? U
    : never
    : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
    }
    ? U
    : never
    : never

export type Enums<
    PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
    EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
    ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
    : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
    PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
    CompositeTypeName extends PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
    ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
    : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
