// Arranca Next (sin worker embebido) y el worker independiente con recarga automática.
// Uso: npm run dev:all   (Ctrl+C detiene ambos)
import { spawn } from 'child_process'

// Comando completo como una sola cadena (sin lista de argumentos) para evitar el aviso DEP0190 en Windows
const procs = [
    spawn('npm run dev', { stdio: 'inherit', shell: true, env: { ...process.env, EMBEDDED_WORKER: 'false' } }),
    spawn('npm run worker', { stdio: 'inherit', shell: true, env: { ...process.env } }),
]
const stop = () => { for (const p of procs) { try { p.kill() } catch { /* ya terminó */ } } process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', code => { if (code && code !== 0) console.error(`[dev:all] Un proceso terminó con código ${code}`) })
