import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { createClient } from '@/lib/supabase/server'
import { diagnoseHfChain } from '@/services/hf-image'

export const maxDuration = 300

/**
 * Prueba la cadena de modelos de imagen de Hugging Face (sesión requerida).
 * Guarda una muestra por modelo en public/hf-test/ para comparar calidad.
 * Cada llamada consume créditos de Hugging Face (unos pocos centavos por la cadena completa).
 */
export async function POST(req: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const body = await req.json().catch(() => ({})) as { prompt?: string }
    const prompt = body.prompt?.trim() ||
        'Vertical 9:16 documentary photograph of a crowded football stadium tunnel at night in Rio de Janeiro, security staff and broken seats, dramatic floodlights'
    const results = await diagnoseHfChain(prompt)
    const dir = path.join(process.cwd(), 'public', 'hf-test')
    await fs.mkdir(dir, { recursive: true })
    const out = []
    for (const r of results) {
        let file: string | undefined
        if (r.buffer) {
            file = `${Date.now()}_${r.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.jpg`
            await fs.writeFile(path.join(dir, file), r.buffer)
        }
        const { buffer: _b, ...rest } = r
        out.push({ ...rest, sample: file ? `/hf-test/${file}` : undefined })
    }
    return NextResponse.json({ prompt, results: out })
}
