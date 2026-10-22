import path from 'path'
import fs from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { FFMPEG_PATH, CARD_FONT_BOLD, CARD_FONT_REGULAR, CHANNEL_BRAND, escapeFilterPath } from '@/lib/media-config'

const execFileAsync = promisify(execFile)

/**
 * TARJETAS INFORMATIVAS 1080x1920 para noticias y personas reales.
 * Diseño propio del canal generado con FFmpeg: no inventa imágenes, solo muestra datos verificables
 * (titular, dato clave, lugar, fecha y fuente). La franja inferior (y > 1380) queda libre para los subtítulos.
 */
export interface NewsCardInput {
    kicker?: string
    headline: string
    detail?: string
    location?: string
    dateLabel?: string
    sourceLabel?: string
    /** Imagen o video del propio reel para usar como fondo desenfocado (coherencia visual). */
    backgroundMedia?: string
    variant?: number
}

const W = 1080
const H = 1920
const MARGIN_X = 70
const SAFE_BOTTOM = 1370 // debajo van los subtítulos

const PALETTES = [
    { c0: '0x0B1220', c1: '0x1E1B4B', kicker: '0xE11D48' }, // azul noche / índigo, rojo
    { c0: '0x111827', c1: '0x7F1D1D', kicker: '0xDC2626' }, // grafito / vino
    { c0: '0x042F2E', c1: '0x0F172A', kicker: '0x0EA5E9' }, // petróleo / azul
]
const ACCENT = '0xFACC15' // amarillo (igual que el resaltado de los subtítulos)

/** Corta un texto en líneas de hasta `maxChars` caracteres; recorta con "…" si supera `maxLines`. */
export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
    const words = (text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    const lines: string[] = []
    let current = ''
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word
        if (candidate.length <= maxChars) {
            current = candidate
        } else {
            if (current) lines.push(current)
            current = word.length > maxChars ? word.slice(0, maxChars - 1) + '…' : word
        }
    }
    if (current) lines.push(current)
    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines)
        kept[maxLines - 1] = kept[maxLines - 1].replace(/[\s,.;:]*$/, '') + '…'
        return kept
    }
    return lines
}

class CardService {
    // En public/output (no en temp) para que la limpieza de temporales no las borre: el editor de escenas las reutiliza
    private tempDir = path.join(process.cwd(), 'public', 'output', 'cards')

    async renderNewsCard(input: NewsCardInput): Promise<string> {
        await fs.mkdir(this.tempDir, { recursive: true })
        const id = randomUUID().slice(0, 8)
        const outPath = path.join(this.tempDir, `card_${id}.jpg`)
        const palette = PALETTES[Math.abs(input.variant || 0) % PALETTES.length]
        const textFiles: string[] = []

        const writeText = async (name: string, content: string) => {
            const file = path.join(this.tempDir, `card_${id}_${name}.txt`)
            await fs.writeFile(file, content, 'utf-8')
            textFiles.push(file)
            return escapeFilterPath(file)
        }
        const bold = escapeFilterPath(CARD_FONT_BOLD)
        const regular = escapeFilterPath(CARD_FONT_REGULAR)

        // --- Titular: el tamaño se reduce hasta que entra completo en 4 líneas como máximo ---
        // Ancho medio estimado de una MAYÚSCULA en negrita ≈ 0.72 × tamaño (conservador para Arial y DejaVu)
        const headline = (input.headline || '').trim().toUpperCase()
        const usableW = W - 2 * MARGIN_X
        let hSize = 60
        let hLines: string[] = []
        for (const size of [96, 88, 80, 72, 66, 60]) {
            const cpl = Math.floor(usableW / (size * 0.72))
            const lines = wrapLines(headline, cpl, 99)
            hSize = size
            hLines = lines
            if (lines.length <= 4 && lines.every(l => l.length <= cpl)) break
        }
        if (hLines.length > 5) hLines = wrapLines(headline, Math.floor(usableW / (hSize * 0.72)), 5)
        // Alto real de cada línea en drawtext ≈ 1.17 × tamaño (ascendente + descendente) + interlineado
        const hSpacing = Math.round(hSize * 0.12)
        const hStep = Math.round(hSize * 1.17) + hSpacing

        // Texto normal en minúsculas ≈ 0.56 × tamaño por carácter
        const detailLines = input.detail ? wrapLines(input.detail, Math.floor(usableW / (50 * 0.56)), 5) : []
        const dSize = 50
        const dSpacing = Math.round(dSize * 0.22)
        const dStep = Math.round(dSize * 1.17) + dSpacing

        // Etiqueta corta, cortada por palabras (nunca a mitad de palabra)
        const kicker = wrapLines((input.kicker || 'ÚLTIMA HORA').toUpperCase(), 22, 1)[0].replace(/…$/, '')
        const kickerY = 210
        const kickerW = Math.min(W - 2 * MARGIN_X, Math.round(kicker.length * 42 * 0.74 + 64))

        const headlineY = 350
        const headlineBottom = headlineY + hLines.length * hStep - hSpacing
        const accentY = headlineBottom + 26
        const detailY = accentY + 46
        const detailBottom = detailY + detailLines.length * dStep - dSpacing

        const footer = [input.location, input.dateLabel].filter(Boolean).join('  ·  ').toUpperCase()
        const footerY = Math.max(detailBottom + 60, 1180)
        const sourceY = Math.min(footerY + 70, SAFE_BOTTOM - 40)

        // --- Fondo: medio del propio reel desenfocado, o degradado de marca ---
        const args: string[] = ['-y']
        let base: string
        if (input.backgroundMedia) {
            const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(input.backgroundMedia)
            if (isVideo) args.push('-ss', '1.5')
            args.push('-i', input.backgroundMedia)
            base = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=32,eq=brightness=-0.32:saturation=0.75,format=rgb24`
        } else {
            args.push('-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=${palette.c0}:c1=${palette.c1}:x0=0:y0=0:x1=${W}:y1=${H}:nb_colors=2`)
            base = `[0:v]format=rgb24`
        }

        const filters: string[] = [base]
        // Panel oscuro detrás del texto (legibilidad sobre cualquier fondo)
        filters.push(`drawbox=x=${MARGIN_X - 30}:y=${headlineY - 40}:w=${W - 2 * (MARGIN_X - 30)}:h=${Math.max(detailBottom, headlineBottom) - headlineY + 90}:color=black@0.28:t=fill`)
        // Marca del canal
        filters.push(`drawbox=x=${MARGIN_X}:y=112:w=12:h=44:color=${ACCENT}:t=fill`)
        filters.push(`drawtext=fontfile='${bold}':textfile='${await writeText('brand', CHANNEL_BRAND)}':fontsize=40:fontcolor=white@0.92:x=${MARGIN_X + 28}:y=114`)
        // Etiqueta (kicker)
        filters.push(`drawbox=x=${MARGIN_X}:y=${kickerY}:w=${kickerW}:h=78:color=${palette.kicker}:t=fill`)
        filters.push(`drawtext=fontfile='${bold}':textfile='${await writeText('kicker', kicker)}':fontsize=42:fontcolor=white:x=${MARGIN_X + 32}:y=${kickerY + 18}`)
        // Titular
        filters.push(`drawtext=fontfile='${bold}':textfile='${await writeText('headline', hLines.join('\n'))}':fontsize=${hSize}:fontcolor=white:line_spacing=${hSpacing}:x=${MARGIN_X}:y=${headlineY}:shadowcolor=black@0.6:shadowx=3:shadowy=3`)
        // Barra de acento
        filters.push(`drawbox=x=${MARGIN_X}:y=${accentY}:w=170:h=10:color=${ACCENT}:t=fill`)
        // Dato clave
        if (detailLines.length > 0) {
            filters.push(`drawtext=fontfile='${regular}':textfile='${await writeText('detail', detailLines.join('\n'))}':fontsize=${dSize}:fontcolor=0xE2E8F0:line_spacing=${dSpacing}:x=${MARGIN_X}:y=${detailY}`)
        }
        // Lugar · fecha
        if (footer) {
            filters.push(`drawtext=fontfile='${bold}':textfile='${await writeText('footer', footer)}':fontsize=40:fontcolor=${ACCENT}:x=${MARGIN_X}:y=${footerY}`)
        }
        // Fuente
        if (input.sourceLabel) {
            filters.push(`drawtext=fontfile='${regular}':textfile='${await writeText('source', `Fuente: ${input.sourceLabel}`.slice(0, 60))}':fontsize=34:fontcolor=0x94A3B8:x=${MARGIN_X}:y=${sourceY}`)
        }

        args.push('-filter_complex', filters.join(','), '-frames:v', '1', '-q:v', '2', outPath)

        try {
            await execFileAsync(FFMPEG_PATH, args, { timeout: 30000 })
        } finally {
            await Promise.all(textFiles.map(f => fs.unlink(f).catch(() => { })))
        }
        return outPath
    }
}

export const cardService = new CardService()
