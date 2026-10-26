import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { createClient } from '@/lib/supabase/server'
import { diagnoseHfVideo } from '@/services/hf-video'

export const maxDuration = 600

/**
 * Prueba la animación imagen → video con cada modelo (sesión requerida).
 * Body: { image: "/hf-test/archivo.jpg", prompt?: string }. Guarda los clips en public/hf-test/.
 * Consume créditos de Hugging Face.
 */
export async function POST(req: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const body = await req.json().catch(() => ({})) as { image?: string; prompt?: string }
    const rel = String(body.image || '')
    if (!/^\/hf-test\/[\w.-]+\.(jpg|jpeg|png)$/i.test(rel)) return NextResponse.json({ error: 'image debe ser /hf-test/<archivo>.jpg' }, { status: 400 })
    const dir = path.join(process.cwd(), 'public', 'hf-test')
    const imagePath = path.join(dir, path.basename(rel))
    const prompt = body.prompt?.trim() || 'Security staff stand guard at a football stadium tunnel at night after a match, crowd in the stands'
    const results = await diagnoseHfVideo(imagePath, prompt)
    const out = []
    for (const r of results) {
        let sample: string | undefined
        if (r.buffer) {
            const file = `${Date.now()}_${r.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.mp4`
            await fs.writeFile(path.join(dir, file), r.buffer)
            sample = `/hf-test/${file}`
        }
        const { buffer: _b, ...rest } = r
        out.push({ ...rest, sample })
    }
    return NextResponse.json({ results: out })
}
