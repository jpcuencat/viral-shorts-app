# CI/CD a Docker local

```
push a master ──► CI (GitHub, Ubuntu): typecheck · next build · docker build
                    │ si pasa
                    ▼
                 Deploy local (runner en este PC): docker compose build + up → /api/health
                    │ sana → queda la versión nueva (http://localhost:3100)
                    └ falla → vuelve sola a la versión anterior (imagen viral-shorts-app:rollback)
```

## Despliegue manual (sin GitHub)

```bash
npm run deploy:local
```

Hace lo mismo que el CD: revisa tipos, guarda la versión actual para volver atrás, construye, levanta y
verifica `http://localhost:3100/api/health`. Si la nueva versión no responde sana en 3 minutos, restaura la anterior.

## Configuración del CD (una sola vez)

1. **Secreto `ENV_LOCAL`**: GitHub → repositorio → Settings → Secrets and variables → Actions → *New repository secret*.
   Nombre `ENV_LOCAL`, valor: el contenido completo de tu `.env.local`.
   (Opcional, para que el CI use tus valores reales al construir: `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.)
2. **Runner en este PC**: GitHub → Settings → Actions → Runners → *New self-hosted runner* → Windows.
   Sigue los comandos que muestra GitHub y, cuando `config.cmd` pregunte por etiquetas adicionales, escribe `docker-local`.
   Instálalo como servicio (`--runasservice`) o déjalo corriendo con `run.cmd`.
   Requisitos en el PC: Docker Desktop encendido, Node.js y Git.
3. Haz un push a `master` (o ejecuta *Deploy local (Docker)* a mano en la pestaña Actions).

## Notas

- Antes de usar la versión en Docker, detén `npm run dev:all`: los dos workers tomarían los mismos trabajos de reels.
- Los reels, el vault y los archivos subidos viven en volúmenes de Docker y se conservan entre despliegues.
- Estado de la app: `http://localhost:3100/api/health` (versión desplegada y conexión a la base de datos).
- Logs: `docker compose logs -f app`.

## Acceso desde fuera (túnel de Cloudflare)

```bash
npm run tunnel          # levanta el túnel y muestra la URL pública
npm run tunnel -- stop  # lo apaga
```

El túnel corre en su propio contenedor (`viral-shorts-tunnel`). Los despliegues (`deploy:local` y el CD) solo
recrean el contenedor `app`, así que **la URL no cambia al desplegar**.

| Modo | Cómo se activa | URL |
|---|---|---|
| Túnel rápido (por defecto) | Sin configurar nada | `https://xxxx.trycloudflare.com`. Gratis y sin cuenta. Se mantiene entre despliegues. Si se cae (al reiniciar o suspender el equipo Cloudflare borra los túneles rápidos), un vigilante lo reconecta solo en ~1 min con una URL nueva, que aparece en el Dashboard y en `/api/health`. |
| Túnel con nombre (URL fija) | `CLOUDFLARE_TUNNEL_TOKEN` y `PUBLIC_APP_URL` en `.env.local` | Siempre la misma (ej. `https://app.tudominio.com`). Requiere un dominio en Cloudflare. |

Configurar el túnel con nombre (gratis, una vez):
1. Agrega tu dominio a Cloudflare (plan Free).
2. Cloudflare Zero Trust → Networks → Tunnels → *Create a tunnel* → Cloudflared → nombre `viral-shorts`.
3. Copia el **token** que muestra y ponlo en `.env.local` como `CLOUDFLARE_TUNNEL_TOKEN=...` (y en el secreto `ENV_LOCAL` de GitHub).
4. En *Public Hostname*: subdominio `app`, tu dominio, servicio `HTTP` → `app:3000`.
5. En `.env.local`: `PUBLIC_APP_URL=https://app.tudominio.com`. Luego `npm run deploy:local` y `npm run tunnel`.

Notas: el inicio de sesión con correo y contraseña funciona por el túnel sin cambios. Si usas el enlace mágico por correo,
agrega la URL del túnel en Supabase → Authentication → URL Configuration → Redirect URLs.
