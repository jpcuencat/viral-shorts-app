# Guía de Configuración: YouTube Auto-Upload

Para que la aplicación suba videos automáticamente, necesitamos 2 cosas:
1.  Un archivo `client_secret.json` (Tu identidad de App).
2.  Un archivo `tokens.json` (Tu permiso de Usuario).

Sigue estos pasos EXACTAMENTE:

## Parte 1: Crear Credenciales en Google Cloud

1.  Ve a [Google Cloud Console](https://console.cloud.google.com/).
2.  Crea un **Nuevo Proyecto** (ej: "ViralShorts-Bot").
3.  En el menú lateral, ve a **APIs y Servicios > Biblioteca**.
    *   Busca "YouTube Data API v3" y dale a **Habilitar**.
4.  Ve a **APIs y Servicios > Pantalla de consentimiento de OAuth**.
    *   Elige **Externo**.
    *   Rellena: Nombre App ("ViralBot"), Email soporte (el tuyo).
    *   **IMPORTANTE**: En "Usuarios de prueba" (Test Users), AÑADE TU EMAIL de YouTube. Si no lo haces, dará error 403.
5.  Ve a **APIs y Servicios > Credenciales**.
    *   Dale a **Crear Credenciales > ID de cliente de OAuth**.
    *   Tipo de aplicación: **Aplicación de escritorio** (Desktop App).
    *   Nombre: "Node Client".
    *   Dale a Crear.
6.  En la ventana que sale (o en la lista), busca el icono de **Descargar (JSON)**.
7.  Descarga el archivo y **RENOMBRALO** a `client_secret.json`.
8.  Mueve ese archivo a la carpeta raíz de tu proyecto: `d:\Desarrollo\mundial\viral-shorts-app\client_secret.json`.

## Parte 2: Generar Tokens de Acceso

Una vez tengas el `client_secret.json` en la carpeta correcta:

1.  Abre la terminal en VS Code.
2.  Ejecuta este comando:
    ```bash
    node scripts/auth-youtube.js
    ```
3.  La terminal te mostrará un **Link**. Copialo y ábrelo en tu navegador.
4.  Inicia sesión con tu cuenta de YouTube (la que pusiste en Test Users).
5.  Google te dirá "Google no ha verificado esta aplicación". Dale a **Configuración avanzada > Ir a ViralBot (no seguro)**.
6.  Concede los permisos (Ver y administrar videos).
7.  Copia el **Código** que te dan.
8.  Pégalo en la terminal y dale a Enter.
9.  Se creará automáticamente un archivo `tokens.json`.

¡Listo! Ahora la app subirá videos automáticamente.
