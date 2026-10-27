/**
 * Dirección pública con la que se entra a la app desde fuera:
 *  - túnel con nombre: PUBLIC_APP_URL (fija)
 *  - túnel rápido: se pregunta al contenedor del túnel cuál es su URL activa y si está conectado
 */
export interface PublicAccess { url: string; connected: boolean; mode: 'fijo' | 'rapido' }

export async function getPublicAccess(): Promise<PublicAccess | null> {
    if (process.env.PUBLIC_APP_URL) return { url: process.env.PUBLIC_APP_URL, connected: true, mode: 'fijo' }
    const base = process.env.TUNNEL_METRICS_URL
    if (!base) return null
    try {
        const [q, r] = await Promise.all([
            fetch(`${base}/quicktunnel`, { signal: AbortSignal.timeout(1500), cache: 'no-store' }).then(x => x.json()).catch(() => null),
            fetch(`${base}/ready`, { signal: AbortSignal.timeout(1500), cache: 'no-store' }).catch(() => null),
        ])
        if (!q?.hostname) return null
        return { url: `https://${q.hostname}`, connected: Boolean(r?.ok), mode: 'rapido' }
    } catch {
        return null
    }
}
