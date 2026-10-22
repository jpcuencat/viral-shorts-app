// Arranca Next (sin worker embebido) y el worker independiente con recarga automática.
// Uso: npm run dev:all   (Ctrl+C detiene ambos)
import { spawn } from 'child_process'

const isWin = process.platform === 'win32'
const npm = isWin ? 'npm.cmd' : 'npm'
const procs = [
    spawn(npm, ['run', 'dev'], { stdio: 'inherit', shell: isWin, env: { ...process.env, EMBEDDED_WORKER: 'false' } }),
    spawn(npm, ['run', 'worker'], { stdio: 'inherit', shell: isWin, env: { ...process.env } }),
]
const stop = () => { for (const p of procs) { try { p.kill() } catch { /* ya terminó */ } } process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', code => { if (code && code !== 0) console.error(`[dev:all] Un proceso terminó con código ${code}`) })
