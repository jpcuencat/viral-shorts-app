#!/usr/bin/env node
// Levanta el túnel de Cloudflare para probar la app desde fuera y muestra la URL pública.
//   npm run tunnel          → arranca (o deja como está si ya corre) y muestra la URL
//   npm run tunnel -- stop  → apaga el túnel
// Con CLOUDFLARE_TUNNEL_TOKEN en .env.local usa el túnel con nombre (URL fija, PUBLIC_APP_URL);
// sin token usa un túnel rápido de trycloudflare.com (gratis; cambia solo si se reinicia el contenedor del túnel).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const ENV_FILE = process.env.ENV_FILE || '.env.local'
const env = Object.fromEntries((fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '').split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]))
const named = Boolean(env.CLOUDFLARE_TUNNEL_TOKEN)
const service = named ? 'tunnel-fijo' : 'tunnel-rapido'
const dc = args => spawnSync('docker', ['compose', '--env-file', ENV_FILE, '--profile', service, ...args], { stdio: 'inherit' })
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
    if (process.argv.includes('stop')) {
        spawnSync('docker', ['rm', '-f', 'viral-shorts-tunnel'], { stdio: 'inherit' })
        console.log('[tunnel] Túnel apagado.')
        return
    }
    // Si ya existe un túnel del otro tipo, se reemplaza; si es el mismo, NO se recrea (la URL se mantiene)
    const running = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.service"}}', 'viral-shorts-tunnel'], { encoding: 'utf8' }).stdout?.trim()
    if (running && running !== service) spawnSync('docker', ['rm', '-f', 'viral-shorts-tunnel'], { stdio: 'inherit' })
    const r = dc(['up', '-d', '--no-recreate', service])
    if (r.status !== 0) process.exit(1)

    if (named) {
        console.log(`[tunnel] Túnel con nombre activo. URL fija: ${env.PUBLIC_APP_URL || '(pon PUBLIC_APP_URL en .env.local, ej. https://app.tudominio.com)'}`)
        return
    }
    for (let i = 0; i < 20; i++) {
        try {
            const j = await (await fetch('http://127.0.0.1:2000/quicktunnel', { signal: AbortSignal.timeout(3000) })).json()
            if (j.hostname) {
                console.log(`[tunnel] 🌐 App desde fuera: https://${j.hostname}`)
                console.log('[tunnel] Esta URL se mantiene en los despliegues; cambia solo si se reinicia el contenedor del túnel.')
                return
            }
        } catch { /* aún arrancando */ }
        await sleep(2000)
    }
    console.log('[tunnel] El túnel arrancó pero aún no hay URL. Revisa: docker logs viral-shorts-tunnel')
}
main()
