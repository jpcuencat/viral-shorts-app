import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { getAdminClient, hasAdminCredentials } from '@/lib/supabase/admin'

/**
 * Índice del vault de medios (imágenes IA y clips). Los ARCHIVOS siguen en public/ai-vault/;
 * el índice vive en la tabla vault_assets. Si no hay clave de servicio configurada, se usa el
 * archivo antiguo public/ai-vault/index.json como respaldo para que la app siga funcionando.
 */
export interface VaultEntry {
    fileName: string
    filePath: string
    mediaType?: 'image' | 'video'
    category: string
    subjectKey: string
    tags: string[]
    prompt: string
    createdAt: string
    personFree?: boolean
    clipCheck?: string
    clipCheckReason?: string
    sourceVideoId?: string
}

const VAULT_DIR = path.join(process.cwd(), 'public', 'ai-vault')
const LEGACY_INDEX = path.join(VAULT_DIR, 'index.json')

function fromRow(r: any): VaultEntry {
    return {
        fileName: r.file_name,
        filePath: path.join(VAULT_DIR, r.file_name),
        mediaType: r.media_type,
        category: r.category || '',
        subjectKey: r.subject_key || '',
        tags: r.tags || [],
        prompt: r.prompt || '',
        createdAt: r.created_at,
        personFree: Boolean(r.person_free),
        clipCheck: r.clip_check || undefined,
        clipCheckReason: r.clip_check_reason || undefined,
        sourceVideoId: r.source_video_id || undefined,
    }
}

function toRow(e: VaultEntry) {
    return {
        file_name: e.fileName,
        media_type: e.mediaType || (e.fileName.endsWith('.mp4') ? 'video' : 'image'),
        category: e.category,
        subject_key: e.subjectKey,
        tags: e.tags || [],
        prompt: e.prompt,
        person_free: Boolean(e.personFree),
        clip_check: e.clipCheck ?? null,
        clip_check_reason: e.clipCheckReason ?? null,
        source_video_id: e.sourceVideoId ?? null,
        created_at: e.createdAt || new Date().toISOString(),
    }
}

function patchToRow(patch: Partial<VaultEntry>) {
    const row: Record<string, unknown> = {}
    if (patch.clipCheck !== undefined) row.clip_check = patch.clipCheck
    if (patch.clipCheckReason !== undefined) row.clip_check_reason = patch.clipCheckReason
    if (patch.personFree !== undefined) row.person_free = patch.personFree
    if (patch.tags !== undefined) row.tags = patch.tags
    if (patch.prompt !== undefined) row.prompt = patch.prompt
    return row
}

async function readLegacy(): Promise<VaultEntry[]> {
    try {
        if (!fsSync.existsSync(LEGACY_INDEX)) return []
        const parsed = JSON.parse(await fs.readFile(LEGACY_INDEX, 'utf-8'))
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

async function writeLegacy(entries: VaultEntry[]) {
    await fs.mkdir(VAULT_DIR, { recursive: true })
    await fs.writeFile(LEGACY_INDEX, JSON.stringify(entries, null, 2), 'utf-8')
}

export const vaultStore = {
    async list(filter: { mediaType?: 'image' | 'video' } = {}): Promise<VaultEntry[]> {
        if (!hasAdminCredentials()) {
            const all = await readLegacy()
            return filter.mediaType
                ? all.filter(e => (e.mediaType || (e.fileName.endsWith('.mp4') ? 'video' : 'image')) === filter.mediaType)
                : all
        }
        let q = getAdminClient().from('vault_assets').select('*')
        if (filter.mediaType) q = q.eq('media_type', filter.mediaType)
        const { data, error } = await q
        if (error) throw new Error(`No se pudo leer el vault: ${error.message}`)
        return (data || []).map(fromRow)
    },

    async add(entry: VaultEntry): Promise<void> {
        if (!hasAdminCredentials()) {
            const all = await readLegacy()
            all.push(entry)
            await writeLegacy(all)
            return
        }
        const { error } = await getAdminClient().from('vault_assets').upsert(toRow(entry), { onConflict: 'file_name' })
        if (error) throw new Error(`No se pudo registrar en el vault: ${error.message}`)
    },

    async update(fileName: string, patch: Partial<VaultEntry>): Promise<void> {
        if (!hasAdminCredentials()) {
            const all = await readLegacy()
            const idx = all.findIndex(e => e.fileName === fileName)
            if (idx >= 0) {
                all[idx] = { ...all[idx], ...patch }
                await writeLegacy(all)
            }
            return
        }
        const { error } = await getAdminClient().from('vault_assets').update(patchToRow(patch)).eq('file_name', fileName)
        if (error) throw new Error(`No se pudo actualizar el vault: ${error.message}`)
    },
}
