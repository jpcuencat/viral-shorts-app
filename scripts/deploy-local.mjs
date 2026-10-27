#!/usr/bin/env node
// Despliegue continuo a Docker local, con verificación de salud y vuelta atrás automática.
// Uso:  npm run deploy:local            (desde la carpeta del proyecto)
//       lo ejecuta también el job "deploy-local" de GitHub Actions en el runner de este equipo.
// Variables opcionales: ENV_FILE (por defecto .env.local), APP_VERSION (por defecto el commit actual),
//                       HEALTH_URL (por defecto http://localhost:3100/api/health), HEALTH_TIMEOUT_S (180), SKIP_CHECKS=1
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const CONTAINER = 'viral-shorts-app'
const IMAGE = 'viral-shorts-app'
const ENV_FILE = process.env.ENV_FILE || '.env.local'
const HEALTH_URL = process.env.HEALTH_URL || 'http://localhost:3100/api/health'
const HEALTH_TIMEOUT_S = Number(process.env.HEALTH_TIMEOUT_S || 180)
const isWin = process.platform === 'win32'

const log = msg => console.log(`[deploy] ${msg}`)
function run(cmd, args, env = {}) {
    const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env }, shell: isWin && cmd === 'npm' })
    if (r.status !== 0) throw new Error(`Falló: ${cmd} ${args.join(' ')} (código ${r.status})`)
}
function out(cmd, args) {
    const r = spawnSync(cmd, args, { encoding: 'utf8' })
    return r.status === 0 ? (r.stdout || '').trim() : ''
}
const compose = (args, env) => run('docker', ['compose', '--env-file', ENV_FILE, ...args], env)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitHealthy(version) {
    const until = Date.now() + HEALTH_TIMEOUT_S * 1000
    let last = ''
    while (Date.now() < until) {
        try {
            const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(8000) })
            const j = await res.json().catch(() => ({}))
            last = JSON.stringify(j)
            if (res.ok && j.ok && j.version === version) return true
        } catch (e) {
            last = String(e?.message || e)
        }
        await sleep(3000)
    }
    log(`La app no respondió sana a tiempo. Última respuesta: ${last}`)
    return false
}

/** URL pública del túnel, si está corriendo (no se toca en el despliegue). */
async function publicUrl() {
    if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL
    try {
        const r = await fetch('http://127.0.0.1:2000/quicktunnel', { signal: AbortSignal.timeout(3000) })
        const j = await r.json()
        return j.hostname ? `https://${j.hostname}` : ''
    } catch { return '' }
}

async function main() {
    if (!fs.existsSync(ENV_FILE)) throw new Error(`No existe ${ENV_FILE} (variables de entorno de la app)`)
    if (!out('docker', ['version', '--format', '{{.Server.Version}}'])) throw new Error('Docker no está corriendo')

    const sha = out('git', ['rev-parse', '--short', 'HEAD']) || 'local'
    const dirty = out('git', ['status', '--porcelain', '--untracked-files=no']) ? '-dirty' : ''
    const version = process.env.APP_VERSION || `${sha}${dirty}`
    log(`Versión a desplegar: ${version}`)

    // 1. Revisiones rápidas (solo si hay dependencias instaladas; en CI ya pasaron antes)
    if (!process.env.SKIP_CHECKS && fs.existsSync('node_modules')) {
        log('Revisando tipos (npm run typecheck)…')
        run('npm', ['run', 'typecheck'])
    }

    // 2. Guardar la imagen que está corriendo para poder volver atrás
    const currentImageId = out('docker', ['inspect', '--format', '{{.Image}}', CONTAINER])
    if (currentImageId) {
        run('docker', ['tag', currentImageId, `${IMAGE}:rollback`])
        log(`Versión anterior guardada como ${IMAGE}:rollback`)
    }

    // 3. Construir y levantar la nueva versión
    log('Construyendo la imagen…')
    compose(['build', 'app'], { APP_VERSION: version })
    log('Levantando el contenedor…')
    compose(['up', '-d', '--no-build', '--no-deps', 'app'], { APP_VERSION: version })

    // 4. Verificar salud; si falla, volver a la versión anterior
    log(`Esperando que ${HEALTH_URL} responda con la versión ${version}…`)
    if (await waitHealthy(version)) {
        run('docker', ['tag', `${IMAGE}:${version}`, `${IMAGE}:latest`])
        spawnSync('docker', ['image', 'prune', '-f'], { stdio: 'ignore' })
        log(`✅ Desplegado ${version} en http://localhost:3100`)
        const pub = await publicUrl()
        if (pub) log(`🌐 Desde fuera (mismo túnel de siempre): ${pub}`)
        return
    }
    spawnSync('docker', ['compose', '--env-file', ENV_FILE, 'logs', '--tail', '80', 'app'], { stdio: 'inherit' })
    if (currentImageId) {
        log('↩ Volviendo a la versión anterior…')
        compose(['up', '-d', '--no-build', '--no-deps', 'app'], { APP_VERSION: 'rollback' })
        const back = await waitHealthy('rollback')
        log(back ? 'La versión anterior quedó funcionando.' : '⚠ La versión anterior tampoco respondió: revisa `docker compose logs app`.')
    }
    throw new Error(`El despliegue de ${version} no pasó la verificación de salud`)
}

main().catch(err => {
    console.error(`[deploy] ❌ ${err.message}`)
    process.exit(1)
})
