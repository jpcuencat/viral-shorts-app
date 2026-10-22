import fs from 'fs'
import path from 'path'
import util from 'util'

/**
 * Copia la salida de consola del servidor (worker incluido) a logs/server.log, para poder revisar
 * la ejecución sin copiar la terminal. Rota a server.1.log al superar LOG_MAX_MB (5 MB por defecto).
 * Desactivar con FILE_LOG=false.
 */
const g = globalThis as unknown as { __fileLogInstalled?: boolean }

export function installFileLog() {
    if (g.__fileLogInstalled || process.env.FILE_LOG === 'false') return
    g.__fileLogInstalled = true

    const dir = path.join(process.cwd(), 'logs')
    const file = path.join(dir, 'server.log')
    const maxBytes = (Number(process.env.LOG_MAX_MB) || 5) * 1024 * 1024
    try { fs.mkdirSync(dir, { recursive: true }) } catch { return }

    const write = (level: string, args: unknown[]) => {
        try {
            const line = `${new Date().toISOString()} ${level} ${util.format(...args)}\n`
            try {
                if (fs.statSync(file).size > maxBytes) fs.renameSync(file, path.join(dir, 'server.1.log'))
            } catch { /* aún no existe */ }
            fs.appendFileSync(file, line)
        } catch { /* nunca romper la app por el log */ }
    }

    for (const level of ['log', 'info', 'warn', 'error'] as const) {
        const original = console[level].bind(console)
        console[level] = (...args: unknown[]) => {
            original(...args)
            write(level.toUpperCase().padEnd(5), args)
        }
    }
    console.log(`[FileLog] Registro del servidor en ${file}`)
}
