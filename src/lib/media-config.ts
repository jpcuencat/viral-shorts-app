import path from 'path'
import fs from 'fs'

/**
 * Configuración multiplataforma de binarios y parámetros de medios.
 * Orden de resolución: variable de entorno → binario incluido en el proyecto → binario del PATH del sistema.
 * Así funciona igual en Windows (carpetas ffmpeg/ y bin/ actuales) y en Linux/Docker (apt install ffmpeg).
 */
const isWin = process.platform === 'win32'
const exe = (name: string) => (isWin ? `${name}.exe` : name)

function resolveBinary(envVar: string, bundled: string, fallback: string): string {
    const fromEnv = process.env[envVar]
    if (fromEnv && fromEnv.trim()) return fromEnv.trim()
    if (fs.existsSync(bundled)) return bundled
    return fallback
}

export const FFMPEG_PATH = resolveBinary(
    'FFMPEG_PATH',
    path.join(process.cwd(), 'ffmpeg', 'bin', exe('ffmpeg')),
    'ffmpeg'
)

export const FFPROBE_PATH = resolveBinary(
    'FFPROBE_PATH',
    path.join(process.cwd(), 'ffmpeg', 'bin', exe('ffprobe')),
    'ffprobe'
)

export const YTDLP_PATH = resolveBinary(
    'YTDLP_PATH',
    path.join(process.cwd(), 'bin', exe('yt-dlp')),
    'yt-dlp'
)

/** Fuente para drawtext (solo se usa cuando no hay archivo de subtítulos). */
export const SUBTITLE_FONT_FILE =
    process.env.SUBTITLE_FONT_FILE ||
    (isWin ? 'C:/Windows/Fonts/arialbd.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')

/** Volumen de la música de fondo antes del ducking (0-1). */
export const MUSIC_VOLUME = Number(process.env.MUSIC_VOLUME || 0.12)

/** Sonoridad integrada objetivo del video final (LUFS). */
export const TARGET_LUFS = Number(process.env.TARGET_LUFS || -14)

/** Escapa una ruta para usarla dentro de un filtro de FFmpeg (C:/... → C\:/...). */
export function escapeFilterPath(p: string): string {
    return p.replace(/\\/g, '/').replace(/:/g, '\\:')
}
