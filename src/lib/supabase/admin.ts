import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente de Supabase con la clave de servicio (salta RLS). SOLO para código de servidor:
 * el worker de trabajos, el índice del vault y la importación de datos locales.
 * Nunca debe importarse desde componentes de cliente.
 */
let adminClient: SupabaseClient | null = null

export function hasAdminCredentials(): boolean {
    return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export function getAdminClient(): SupabaseClient {
    if (!adminClient) {
        if (!hasAdminCredentials()) {
            throw new Error(
                'Falta SUPABASE_SERVICE_ROLE_KEY en .env.local (Supabase → Project Settings → API Keys → secret key). ' +
                'La necesita el procesamiento en segundo plano.'
            )
        }
        adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
            auth: { persistSession: false, autoRefreshToken: false },
        })
    }
    return adminClient
}
