/**
 * Se ejecuta una vez al arrancar el servidor de Next.
 * Inicia el worker de trabajos en segundo plano (generación de reels y tendencias) dentro del mismo proceso.
 * Para desactivarlo (por ejemplo, si algún día corre en un servidor aparte): EMBEDDED_WORKER=false
 */
export async function register() {
    // El import va DENTRO de la condición para que solo se empaquete para el runtime de Node (no Edge)
    if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.EMBEDDED_WORKER !== 'false') {
        const { startWorker } = await import('./lib/jobs/worker')
        startWorker()
    }
}
