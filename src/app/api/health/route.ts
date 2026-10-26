import { NextResponse } from 'next/server'
import { getAdminClient, hasAdminCredentials } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** Estado de la app para el despliegue (CI/CD) y el healthcheck de Docker: versión y conexión a la base de datos. */
export async function GET() {
    const version = process.env.APP_VERSION || 'dev'
    let db = 'sin credenciales'
    if (hasAdminCredentials()) {
        try {
            const { error } = await getAdminClient().from('categories').select('id', { count: 'exact', head: true })
            db = error ? `error: ${error.message}` : 'ok'
        } catch (e: any) {
            db = `error: ${e?.message || e}`
        }
    }
    const ok = db === 'ok'
    return NextResponse.json({ ok, version, db, time: new Date().toISOString() }, { status: ok ? 200 : 503 })
}
