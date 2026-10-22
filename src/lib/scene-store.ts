import fs from 'fs'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Desglose de una escena de un reel (para el editor de escenas y re-renderizados parciales). */
export interface SceneManifestEntry {
    sceneIndex: number
    text: string
    caption: string
    audioPath: string
    imagePath: string
    publicMediaUrl: string
    subtitlePath: string
    videoStartTime: number
    duration: number
    subjectKey: string
    sceneTags: string[]
    hfPrompt: string
    ytSearchQuery: string
    sourceLabel: string
    /** La escena muestra a una persona real identificable (nunca se le genera cara con IA). */
    realPerson?: boolean
    /** Prompt IA alternativo sin personas identificables para esa escena. */
    personFreePrompt?: string
}

function toRow(reelId: string, e: SceneManifestEntry) {
    return {
        reel_id: reelId,
        scene_index: e.sceneIndex,
        text: e.text,
        caption: e.caption,
        audio_path: e.audioPath,
        image_path: e.imagePath,
        public_media_url: e.publicMediaUrl,
        subtitle_path: e.subtitlePath,
        video_start_time: e.videoStartTime || 0,
        duration: e.duration || 0,
        subject_key: e.subjectKey,
        scene_tags: e.sceneTags || [],
        hf_prompt: e.hfPrompt,
        yt_search_query: e.ytSearchQuery,
        source_label: e.sourceLabel,
        real_person: Boolean(e.realPerson),
        person_free_prompt: e.personFreePrompt ?? null,
        updated_at: new Date().toISOString(),
    }
}

function fromRow(r: any): SceneManifestEntry {
    return {
        sceneIndex: r.scene_index,
        text: r.text || '',
        caption: r.caption || '',
        audioPath: r.audio_path || '',
        imagePath: r.image_path || '',
        publicMediaUrl: r.public_media_url || '',
        subtitlePath: r.subtitle_path || '',
        videoStartTime: Number(r.video_start_time) || 0,
        duration: Number(r.duration) || 0,
        subjectKey: r.subject_key || '',
        sceneTags: r.scene_tags || [],
        hfPrompt: r.hf_prompt || '',
        ytSearchQuery: r.yt_search_query || '',
        sourceLabel: r.source_label || '',
        realPerson: Boolean(r.real_person),
        personFreePrompt: r.person_free_prompt || undefined,
    }
}

/** Guarda (reemplaza) el desglose completo de escenas de un reel. */
export async function saveSceneManifest(db: SupabaseClient, reelId: string, entries: SceneManifestEntry[]): Promise<void> {
    if (entries.length > 0) {
        const { error } = await db
            .from('reel_scene_assets')
            .upsert(entries.map(e => toRow(reelId, e)), { onConflict: 'reel_id,scene_index' })
        if (error) throw new Error(`No se pudo guardar el desglose de escenas: ${error.message}`)
    }
    // Quitar escenas sobrantes de una generación anterior más larga
    await db.from('reel_scene_assets').delete().eq('reel_id', reelId).gte('scene_index', entries.length)
}

/** Lee el desglose de escenas de un reel (con respaldo al JSON antiguo de public/output si aún no se importó). */
export async function getSceneManifest(db: SupabaseClient, reelId: string): Promise<SceneManifestEntry[]> {
    const { data, error } = await db
        .from('reel_scene_assets')
        .select('*')
        .eq('reel_id', reelId)
        .order('scene_index', { ascending: true })
    if (!error && data && data.length > 0) return data.map(fromRow)

    const legacy = path.join(process.cwd(), 'public', 'output', `manifest_${reelId}.json`)
    try {
        if (fs.existsSync(legacy)) return JSON.parse(fs.readFileSync(legacy, 'utf-8'))
    } catch { /* ignorar */ }
    return []
}
