import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID as uuidv4 } from 'crypto'
import { createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { createClient } from '@/lib/supabase/server'

const MAX_UPLOAD_MB = Number(process.env.UPLOAD_MAX_MB || 500)
const ALLOWED_EXT = ['.mp4', '.mov', '.webm', '.m4v']
const ALLOWED_MIME = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']
// Fotos limpias para una escena (se guardan en public/custom-photos)
const PHOTO_MAX_MB = 25
const PHOTO_EXT = ['.jpg', '.jpeg', '.png', '.webp']
const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp']

export async function POST(req: NextRequest) {
    try {
        // 1. Sesión y tamaño ANTES de leer el cuerpo (esta ruta no pasa por el middleware)
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }

        const declaredSize = Number(req.headers.get('content-length') || 0)
        if (declaredSize > (MAX_UPLOAD_MB + 1) * 1024 * 1024) {
            return NextResponse.json({ error: `El archivo supera el límite de ${MAX_UPLOAD_MB} MB` }, { status: 413 })
        }

        const formData = await req.formData()
        const file = formData.get('file') as File | null

        if (!file) {
            return NextResponse.json({ error: 'No video file provided' }, { status: 400 })
        }

        const ext = path.extname(file.name || '').toLowerCase()
        const isPhoto = PHOTO_EXT.includes(ext)
        if (isPhoto) {
            if (file.type && !PHOTO_MIME.includes(file.type)) {
                return NextResponse.json({ error: `Formato de foto no permitido. Usa: ${PHOTO_EXT.join(', ')}` }, { status: 415 })
            }
            if (file.size > PHOTO_MAX_MB * 1024 * 1024) {
                return NextResponse.json({ error: `La foto supera el límite de ${PHOTO_MAX_MB} MB` }, { status: 413 })
            }
        } else {
            if (!ALLOWED_EXT.includes(ext) || (file.type && !ALLOWED_MIME.includes(file.type))) {
                return NextResponse.json({ error: `Formato no permitido. Usa video (${ALLOWED_EXT.join(', ')}) o foto (${PHOTO_EXT.join(', ')})` }, { status: 415 })
            }
            if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
                return NextResponse.json({ error: `El archivo supera el límite de ${MAX_UPLOAD_MB} MB` }, { status: 413 })
            }
        }

        const folder = isPhoto ? 'custom-photos' : 'custom-videos'
        const customDir = path.join(process.cwd(), 'public', folder)
        await fs.mkdir(customDir, { recursive: true })

        const safeOriginal = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)
        const fileName = `custom_${uuidv4().slice(0, 8)}_${safeOriginal}`
        const filePath = path.join(customDir, fileName)

        // 2. Guardar en disco por partes (sin cargar todo el video en un único Buffer)
        await pipeline(Readable.fromWeb(file.stream() as any), createWriteStream(filePath))

        return NextResponse.json({
            success: true,
            fileName,
            mediaType: isPhoto ? 'photo' : 'video',
            publicPath: `/${folder}/${fileName}`
        })
    } catch (error: any) {
        console.error('[UploadVideo] Error saving custom video:', error)
        return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
    }
}
