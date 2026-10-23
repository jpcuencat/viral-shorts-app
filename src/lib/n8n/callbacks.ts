import type { SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'crypto'
import { getAdminClient } from '@/lib/supabase/admin'

/**
 * Llamadas de n8n hacia la app (resultado de publicación y métricas).
 * Se autentican con el mismo secreto del webhook (cabecera X-Webhook-Secret) guardado en app_settings.
 */
export async function authenticateN8n(req: Request): Promise<{ db: SupabaseClient; userId: string } | null> {
    const secret = (req.headers.get('x-webhook-secret') || '').trim()
    if (secret.length < 16) return null
    const db = getAdminClient()
    const { data } = await db.from('app_settings').select('user_id, webhook_secret').not('webhook_secret', 'is', null)
    for (const row of data || []) {
        const a = Buffer.from(String(row.webhook_secret || ''))
        const b = Buffer.from(secret)
        if (a.length === b.length && timingSafeEqual(a, b)) return { db, userId: row.user_id }
    }
    return null
}

export type Platform = 'youtube' | 'instagram' | 'facebook' | 'tiktok'
export const PLATFORMS: Platform[] = ['youtube', 'instagram', 'facebook', 'tiktok']

export interface MetricItem {
    platform: Platform
    externalId: string
    url?: string
    title?: string
    publishedAt?: string
    views?: number | null
    likes?: number | null
    comments?: number | null
    shares?: number | null
    saves?: number | null
    extra?: Record<string, unknown>
    reelId?: string
    scriptId?: string
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/#\S+/g, ' ').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

const isUuid = (v?: string) => !!v && /^[0-9a-f-]{36}$/i.test(v)
const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : null)

/** Busca a qué guion/reel corresponde una publicación por título (las publicaciones antiguas no traen IDs). */
async function matchByTitle(db: SupabaseClient, userId: string, title: string): Promise<{ scriptId?: string; reelId?: string }> {
    const t = norm(title)
    if (t.length < 8) return {}
    const [{ data: pubs }, { data: scripts }] = await Promise.all([
        db.from('publications').select('reel_id, script_id, title').eq('user_id', userId).order('created_at', { ascending: false }).limit(300),
        db.from('scripts').select('id, seo_title').eq('user_id', userId).order('created_at', { ascending: false }).limit(300),
    ])
    const same = (cand?: string | null) => {
        const c = norm(cand || '')
        return c.length >= 8 && (t === c || t.startsWith(c) || c.startsWith(t))
    }
    const pub = (pubs || []).find(p => p.script_id && same(p.title))
    if (pub) return { scriptId: pub.script_id || undefined, reelId: pub.reel_id || undefined }
    const sc = (scripts || []).find(s => same(s.seo_title))
    return sc ? { scriptId: sc.id } : {}
}

/** Guarda/actualiza métricas sin perder el vínculo con el guion y el reel que ya tuviera la fila. */
export async function upsertMetrics(db: SupabaseClient, userId: string, items: MetricItem[]) {
    const valid = items.filter(i => PLATFORMS.includes(i.platform) && i.externalId)
    let saved = 0, linked = 0
    const errors: string[] = []
    for (const it of valid) {
        const { data: existing } = await db.from('post_metrics').select('id, reel_id, script_id, title, url, published_at')
            .eq('user_id', userId).eq('platform', it.platform).eq('external_id', String(it.externalId)).maybeSingle()
        let scriptId = isUuid(it.scriptId) ? it.scriptId : existing?.script_id || undefined
        let reelId = isUuid(it.reelId) ? it.reelId : existing?.reel_id || undefined
        if (!scriptId && it.title) {
            const m = await matchByTitle(db, userId, it.title)
            scriptId = m.scriptId
            reelId = reelId || m.reelId
        }
        if (scriptId && !reelId) {
            const { data: reel } = await db.from('reels').select('id').eq('script_id', scriptId)
                .order('created_at', { ascending: false }).limit(1).maybeSingle()
            reelId = reel?.id
        }
        const hasStats = [it.views, it.likes, it.comments, it.shares, it.saves].some(v => v !== undefined && v !== null)
        const row: Record<string, unknown> = {
            user_id: userId,
            platform: it.platform,
            external_id: String(it.externalId),
            url: it.url || existing?.url || null,
            title: (it.title || existing?.title || '').slice(0, 300) || null,
            reel_id: reelId || null,
            script_id: scriptId || null,
            published_at: it.publishedAt || existing?.published_at || null,
            extra: it.extra || {},
        }
        if (hasStats) {
            Object.assign(row, { views: n(it.views), likes: n(it.likes), comments: n(it.comments), shares: n(it.shares), saves: n(it.saves), fetched_at: new Date().toISOString() })
        }
        const { error } = await db.from('post_metrics').upsert(row, { onConflict: 'user_id,platform,external_id' })
        if (error) errors.push(`${it.platform}/${it.externalId}: ${error.message}`)
        else { saved++; if (scriptId) linked++ }
    }
    return { received: items.length, saved, linked, errors }
}
