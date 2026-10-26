import type { NextConfig } from "next";

// Carpetas de public/ donde la app escribe mientras corre. En producción Next solo sirve lo que había al
// construir, así que lo nuevo se sirve desde /api/media (solo si el archivo no existía en la imagen).
const RUNTIME_DIRS = ['output', 'ai-vault', 'custom-photos', 'custom-videos', 'hf-test', 'temp'];

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: RUNTIME_DIRS.map(dir => ({ source: `/${dir}/:path*`, destination: `/api/media/${dir}/:path*` })),
    };
  },
};

export default nextConfig;
