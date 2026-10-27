import type { NextConfig } from "next";

// Carpetas de public/ donde la app escribe mientras corre. En producción Next solo sirve lo que había al
// construir, así que lo nuevo se sirve desde /api/media (solo si el archivo no existía en la imagen).
const RUNTIME_DIRS = ['output', 'ai-vault', 'custom-photos', 'custom-videos', 'hf-test', 'temp'];

const nextConfig: NextConfig = {
  // Acceso desde fuera por el túnel de Cloudflare (URL fija del dominio propio o *.trycloudflare.com)
  experimental: {
    serverActions: {
      allowedOrigins: ['*.trycloudflare.com', ...(process.env.PUBLIC_APP_URL ? [new URL(process.env.PUBLIC_APP_URL).host] : [])],
    },
  },
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: RUNTIME_DIRS.map(dir => ({ source: `/${dir}/:path*`, destination: `/api/media/${dir}/:path*` })),
    };
  },
};

export default nextConfig;
