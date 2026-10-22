/**
 * Se ejecuta una vez al arrancar el servidor de Next.
 * Inicia el worker de trabajos en segundo plano (generación de reels y tendencias) dentro del mismo proceso.
 * Para desactivarlo (por ejemplo, si algún día corre en un servidor aparte): EMBEDDED_WORKER=false
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return
    if (process.env.EMBEDDED_WORKER === 'false') return
    const { startWorker } = await import('./lib/jobs/worker')
    startWorker()
}
