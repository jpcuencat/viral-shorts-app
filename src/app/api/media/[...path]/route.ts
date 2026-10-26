import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'

/**
 * Sirve los archivos que la app crea mientras corre (reels, vault, fotos y videos subidos).
 * En producción (`next start`, Docker) Next solo sirve lo que estaba en `public/` al construir la imagen;
 * next.config.ts redirige aquí las rutas /output, /ai-vault, etc. cuando el archivo no estaba en la imagen.
 * Soporta Range para que los videos se puedan reproducir y adelantar.
 */
const ALLOWED = new Set(['output', 'ai-vault', 'custom-photos', 'custom-videos', 'hf-test', 'temp', 'music', 'backgrounds'])
const TYPES: Record<string, string> = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
    '.ass': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
    const parts = (await ctx.params).path || []
    if (parts.length < 2 || !ALLOWED.has(parts[0]) || parts.some(p => p === '..' || p.includes('\0'))) {
        return new Response('No encontrado', { status: 404 })
    }
    const root = path.join(process.cwd(), 'public')
    const file = path.join(root, ...parts)
    if (!file.startsWith(root + path.sep)) return new Response('No encontrado', { status: 404 })
    let stat: fs.Stats
    try { stat = fs.statSync(file) } catch { return new Response('No encontrado', { status: 404 }) }
    if (!stat.isFile()) return new Response('No encontrado', { status: 404 })

    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
    const range = req.headers.get('range')
    const m = range && /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
        const start = m[1] ? parseInt(m[1], 10) : Math.max(0, stat.size - parseInt(m[2] || '0', 10))
        const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1
        if (start >= stat.size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
        const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream
        return new Response(stream, { status: 206, headers: {
            'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
        } })
    }
    const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream
    return new Response(stream, { headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' } })
}
