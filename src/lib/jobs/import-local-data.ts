import fs from 'fs'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Importa UNA vez a Supabase los datos que antes vivían en archivos locales y renombra cada archivo
 * a *.migrated para no repetir la importación. Es idempotente: si se interrumpe, se puede repetir.
 *  - public/ai-vault/index.json         → vault_assets
 *  - public/output/manifest_<reel>.json → reel_scene_assets
 *  - data/social-publications.json      → publications  } ambos se asignan SOLO al usuario de
 *  - data/social-config.json            → app_settings  } LOCAL_DATA_OWNER_EMAIL (.env.local)
 */
const root = process.cwd()

function readJson<T>(file: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
    } catch {
        return null
    }
}

function markMigrated(file: string) {
    try {
        fs.renameSync(file, `${file}.migrated`)
    } catch (err: any) {
        console.warn(`[Import] No se pudo renombrar ${path.basename(file)}:`, err?.message || err)
    }
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
    for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size))
}

/** Busca el id del usuario dueño de los datos locales (LOCAL_DATA_OWNER_EMAIL). */
async function resolveOwnerId(db: SupabaseClient): Promise<string | null> {
    const email = (process.env.LOCAL_DATA_OWNER_EMAIL || '').trim().toLowerCase()
    if (!email) return null
    for (let page = 1; page <= 10; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw new Error(`No se pudo buscar el usuario ${email}: ${error.message}`)
        const found = data.users.find(u => (u.email || '').toLowerCase() === email)
        if (found) return found.id
        if (data.users.length < 200) break
    }
    return null
}

export async function importLocalData(db: SupabaseClient): Promise<void> {
    // 1. Vault
    const vaultIndex = path.join(root, 'public', 'ai-vault', 'index.json')
    if (fs.existsSync(vaultIndex)) {
        const entries = readJson<any[]>(vaultIndex) || []
        const rows = entries.filter(e => e?.fileName).map(e => ({
            file_name: e.fileName,
            media_type: e.mediaType || (String(e.fileName).endsWith('.mp4') ? 'video' : 'image'),
            category: e.category ?? null,
            subject_key: e.subjectKey ?? null,
            tags: Array.isArray(e.tags) ? e.tags : [],
            prompt: e.prompt ?? null,
            person_free: Boolean(e.personFree),
            clip_check: e.clipCheck ?? null,
            clip_check_reason: e.clipCheckReason ?? null,
            source_video_id: e.sourceVideoId ?? null,
            created_at: e.createdAt || new Date().toISOString(),
        }))
        await chunked(rows, 200, async chunk => {
            const { error } = await db.from('vault_assets').upsert(chunk, { onConflict: 'file_name', ignoreDuplicates: true })
            if (error) throw new Error(`vault_assets: ${error.message}`)
        })
        markMigrated(vaultIndex)
        console.log(`[Import] Vault: ${rows.length} registros importados.`)
    }

    // Dueños de los reels (para asignar publicaciones y escenas)
    const { data: reels, error: reelsError } = await db.from('reels').select('id, user_id')
    if (reelsError) throw new Error(`reels: ${reelsError.message}`)
    const reelOwner = new Map<string, string>((reels || []).filter(r => r.user_id).map(r => [r.id, r.user_id]))

    // 2. Manifiestos de escenas
    const outputDir = path.join(root, 'public', 'output')
    if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir).filter(f => /^manifest_[0-9a-f-]{36}\.json$/.test(f))
        let imported = 0
        for (const f of files) {
            const reelId = f.slice('manifest_'.length, -'.json'.length)
            const file = path.join(outputDir, f)
            if (!reelOwner.has(reelId)) {
                markMigrated(file) // el reel ya no existe: no hay a quién asignarlo
                continue
            }
            const scenes = readJson<any[]>(file) || []
            const rows = scenes.map(s => ({
                reel_id: reelId,
                scene_index: s.sceneIndex,
                text: s.text ?? null,
                caption: s.caption ?? null,
                audio_path: s.audioPath ?? null,
                image_path: s.imagePath ?? null,
                public_media_url: s.publicMediaUrl ?? null,
                subtitle_path: s.subtitlePath ?? null,
                video_start_time: Number(s.videoStartTime) || 0,
                duration: Number(s.duration) || 0,
                subject_key: s.subjectKey ?? null,
                scene_tags: Array.isArray(s.sceneTags) ? s.sceneTags : [],
                hf_prompt: s.hfPrompt ?? null,
                yt_search_query: s.ytSearchQuery ?? null,
                source_label: s.sourceLabel ?? null,
                real_person: Boolean(s.realPerson),
                person_free_prompt: s.personFreePrompt ?? null,
            }))
            if (rows.length > 0) {
                const { error } = await db.from('reel_scene_assets').upsert(rows, { onConflict: 'reel_id,scene_index', ignoreDuplicates: true })
                if (error) throw new Error(`reel_scene_assets (${reelId}): ${error.message}`)
            }
            markMigrated(file)
            imported++
        }
        if (files.length > 0) console.log(`[Import] Escenas: ${imported} reel(s) importados.`)
    }

    // 3. Publicaciones
    const pubsFile = path.join(root, 'data', 'social-publications.json')
    const cfgFile = path.join(root, 'data', 'social-config.json')
    const pendingUserData = fs.existsSync(pubsFile) || fs.existsSync(cfgFile)
    const ownerId = pendingUserData ? await resolveOwnerId(db) : null
    if (pendingUserData && !ownerId) {
        console.warn(
            '[Import] Publicaciones y ajustes del webhook NO importados: define LOCAL_DATA_OWNER_EMAIL en .env.local ' +
            'con el correo de una cuenta existente y reinicia el servidor.'
        )
        return
    }

    if (ownerId && fs.existsSync(pubsFile)) {
        const pubs = readJson<any[]>(pubsFile) || []
        const rows = pubs
            .filter(p => p?.id)
            .map(p => ({
                user_id: ownerId,
                reel_id: reelOwner.has(p.reelId) ? p.reelId : null,
                script_id: reelOwner.has(p.reelId) ? (p.scriptId || null) : null,
                title: p.title || 'Sin título',
                video_url: p.videoUrl || null,
                platforms: ['webhook'],
                results: Array.isArray(p.results) ? p.results : [],
                scheduled_at: p.scheduledAt || null,
                legacy_id: p.id,
                created_at: p.createdAt || new Date().toISOString(),
            }))
        if (rows.length > 0) {
            const { error } = await db.from('publications').upsert(rows, { onConflict: 'legacy_id', ignoreDuplicates: true })
            if (error) throw new Error(`publications: ${error.message}`)
        }
        markMigrated(pubsFile)
        console.log(`[Import] Publicaciones: ${rows.length} importadas para ${process.env.LOCAL_DATA_OWNER_EMAIL}.`)
    }

    // 4. Ajustes del webhook
    if (ownerId && fs.existsSync(cfgFile)) {
        const cfg = readJson<any>(cfgFile) || {}
        const rows = [ownerId].map(userId => ({
            user_id: userId,
            webhook_url: cfg.webhookUrl || null,
            webhook_secret: cfg.webhookSecret || null,
            public_base_url: cfg.publicBaseUrl || null,
            default_hashtags: cfg.defaultHashtags || null,
        }))
        if (rows.length > 0) {
            const { error } = await db.from('app_settings').upsert(rows, { onConflict: 'user_id', ignoreDuplicates: true })
            if (error) throw new Error(`app_settings: ${error.message}`)
        }
        markMigrated(cfgFile)
        console.log(`[Import] Ajustes del webhook asignados a ${process.env.LOCAL_DATA_OWNER_EMAIL}.`)
    }
}
