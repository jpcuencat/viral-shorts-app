#!/usr/bin/env node
/**
 * Limpieza de medios generados.
 *
 *   npm run clean:media                 → simulación (no borra nada), muestra qué se borraría
 *   npm run clean:media -- --apply      → borra de verdad
 *
 * Opciones:
 *   --temp-hours=24     Borra archivos de public/temp con más de N horas (por defecto 24)
 *   --output-days=14    Borra final_*.mp4, scenes_* y manifest_* de public/output con más de N días
 *                       SOLO si no son el export_url actual de ningún reel.
 *                       Requiere SUPABASE_SERVICE_ROLE_KEY en .env.local; sin ella, output no se toca.
 */
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const args = Object.fromEntries(
    process.argv.slice(2).map(a => {
        const [k, v] = a.replace(/^--/, '').split('=')
        return [k, v ?? true]
    })
)
const APPLY = Boolean(args.apply)
const TEMP_HOURS = Number(args['temp-hours'] ?? 24)
const OUTPUT_DAYS = args['output-days'] !== undefined ? Number(args['output-days']) : null

const root = process.cwd()
const tempDir = path.join(root, 'public', 'temp')
const outputDir = path.join(root, 'public', 'output')
const now = Date.now()
let freed = 0
let count = 0

function sizeOf(p) {
    const st = fs.statSync(p)
    if (!st.isDirectory()) return st.size
    return fs.readdirSync(p).reduce((acc, f) => acc + sizeOf(path.join(p, f)), 0)
}

function remove(p) {
    const bytes = sizeOf(p)
    freed += bytes
    count++
    console.log(`${APPLY ? 'BORRADO ' : 'borraría'}  ${(bytes / 1048576).toFixed(1).padStart(8)} MB  ${path.relative(root, p)}`)
    if (APPLY) fs.rmSync(p, { recursive: true, force: true })
}

// Archivos de public/temp que siguen en uso por el editor de escenas (audio y subtítulos de cada escena)
const protectedTemp = new Set()
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let admin = null
if (supabaseUrl && serviceKey) {
    const { createClient } = await import('@supabase/supabase-js')
    admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const { data, error } = await admin.from('reel_scene_assets').select('audio_path, subtitle_path')
    if (error) {
        console.error('[temp] No se pudo leer el desglose de escenas de Supabase; por seguridad no se borra nada de temp.', error.message)
        process.exit(1)
    }
    for (const r of data || []) {
        if (r.audio_path) protectedTemp.add(path.basename(r.audio_path))
        if (r.subtitle_path) protectedTemp.add(path.basename(r.subtitle_path))
    }
}
// Manifiestos JSON antiguos (incluidos los ya importados *.migrated)
if (fs.existsSync(outputDir)) {
    for (const f of fs.readdirSync(outputDir)) {
        if (!/^manifest_.*\.json(\.migrated)?$/.test(f)) continue
        try {
            const entries = JSON.parse(fs.readFileSync(path.join(outputDir, f), 'utf-8'))
            for (const e of entries) {
                if (e.audioPath) protectedTemp.add(path.basename(e.audioPath))
                if (e.subtitlePath) protectedTemp.add(path.basename(e.subtitlePath))
            }
        } catch { /* manifest corrupto: se ignora */ }
    }
}

// 1. public/temp
if (fs.existsSync(tempDir)) {
    const limit = TEMP_HOURS * 3600 * 1000
    for (const f of fs.readdirSync(tempDir)) {
        if (protectedTemp.has(f)) continue
        const p = path.join(tempDir, f)
        if (now - fs.statSync(p).mtimeMs > limit) remove(p)
    }
    console.log(`(${protectedTemp.size} archivos de temp protegidos por manifests de escenas)`)
}

// 2. public/output (opcional, protegido por referencias en Supabase)
if (OUTPUT_DAYS !== null && fs.existsSync(outputDir)) {
    if (!admin) {
        console.warn('\n[output] Falta SUPABASE_SERVICE_ROLE_KEY: no se toca public/output por seguridad.')
    } else {
        const { data: reels, error } = await admin.from('reels').select('id, export_url')
        if (error) {
            console.error('[output] No se pudo leer reels:', error.message)
        } else {
            const keepFiles = new Set(reels.map(r => path.basename(r.export_url || '')).filter(Boolean))
            const reelIds = new Set(reels.map(r => r.id))
            const limit = OUTPUT_DAYS * 86400 * 1000
            for (const f of fs.readdirSync(outputDir)) {
                const p = path.join(outputDir, f)
                if (now - fs.statSync(p).mtimeMs <= limit) continue
                if (f.startsWith('final_') && !keepFiles.has(f)) remove(p)
                const m = f.match(/^(?:scenes_|manifest_)([0-9a-f-]{36})/)
                if (m && !reelIds.has(m[1])) remove(p)
            }
        }
    }
}

console.log(`\n${APPLY ? 'Liberado' : 'Se liberaría'}: ${(freed / 1048576).toFixed(1)} MB en ${count} elementos.`)
if (!APPLY && count > 0) console.log('Ejecuta con --apply para borrar.')
