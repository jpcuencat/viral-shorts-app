# Flujo n8n: Viral Shorts → YouTube · Instagram · TikTok

Archivo: `viral-shorts-publish.workflow.json` (n8n local en http://localhost:5678).

## 1. Importar
n8n → **Workflows → ⋯ → Import from File** → elige el JSON.

## 2. Configurar
- **Nodo "Validar y preparar"** → bloque `CONFIG` al inicio del código: secreto del webhook, redes activas y tokens de Instagram y TikTok.
- **Nodos "YouTube: subir Short" y "YouTube: eliminar Short"** → crea o elige la credencial *YouTube OAuth2 API* con la cuenta del **canal nuevo**.
  - En Google Cloud: API "YouTube Data API v3" activa; cliente OAuth tipo *Web* con la URI de redirección `http://localhost:5678/rest/oauth2-credential/callback`.
  - Al conectar, elige el canal nuevo (no el principal de la cuenta).
- **Instagram** (cuenta profesional vinculada a una página de Facebook): app de Meta con *Instagram API (Facebook Login)*, permisos `instagram_basic`, `instagram_content_publish`, `pages_show_list`. Usa un token de larga duración o de *usuario del sistema* (no caduca). El video se sube como archivo: no hace falta URL pública.
- **TikTok**: app en developers.tiktok.com con *Content Posting API* (scope `video.upload`; `video.publish` para publicar directo). Obtén una vez el `refresh_token` (OAuth) y pégalo en `CONFIG`; el flujo lo renueva y guarda solo.
  - `TIKTOK_MODE: 'inbox'` → el video llega a tus borradores de TikTok (funciona sin auditoría).
  - `TIKTOK_MODE: 'direct'` → publica directo; sin auditoría TikTok solo permite `SELF_ONLY` (privado).

## 3. Activar y conectar la app
1. Activa el flujo (interruptor **Active**). La URL de producción es `http://localhost:5678/webhook/viral-shorts-publish`.
2. En la app → **Redes Sociales**: pega esa URL en *Webhook de n8n* y el mismo secreto que pusiste en `CONFIG.WEBHOOK_SECRET`.
3. Pulsa **Probar conexión**: es un evento de prueba, no publica nada (ver n8n → Executions).

## Notas
- n8n debe estar encendido para publicar y para las publicaciones programadas (espera hasta la hora indicada).
- `DRY_RUN: true` en `CONFIG` permite probar todo el flujo sin publicar.
- Cada red es independiente: si una falla, las otras siguen. El detalle queda en n8n → Executions.
