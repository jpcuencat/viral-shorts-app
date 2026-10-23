/**
 * Worker de trabajos como proceso independiente (para desarrollo).
 * `npm run worker` lo ejecuta con `tsx watch`: se reinicia solo al cambiar el código del pipeline,
 * sin reiniciar Next. Se usa junto con `next dev` y EMBEDDED_WORKER=false (ver `npm run dev:all`).
 */
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd(), true)

async function main() {
    const { installFileLog } = await import('./lib/logging/file-log')
    installFileLog()
    const { startWorker } = await import('./lib/jobs/worker')
    console.log('[WorkerProcess] Worker independiente iniciado (recarga automática al cambiar el código)')
    startWorker()
}

main().catch(err => {
    console.error('[WorkerProcess] Error al iniciar:', err)
    process.exit(1)
})
