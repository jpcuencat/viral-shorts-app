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
