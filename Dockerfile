# Viral Shorts App en un contenedor Linux: Next.js (producción) + worker de reels, con ffmpeg, yt-dlp y deno.
# Las variables NEXT_PUBLIC_* se incrustan al construir (por eso van como build args).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# ffmpeg para el render, fuentes para subtítulos y tarjetas, curl/ca para descargas
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
# yt-dlp (binario autónomo) y deno (YouTube exige un motor de JavaScript para descargar)
RUN curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
 && chmod +x /usr/local/bin/yt-dlp
COPY --from=denoland/deno:bin-2.1.4 /deno /usr/local/bin/deno
COPY --from=build /app ./
# Carpetas donde la app escribe (se montan como volúmenes en docker-compose)
RUN mkdir -p public/output public/ai-vault public/temp public/custom-photos public/custom-videos public/hf-test logs data
EXPOSE 3000
CMD ["npm", "start"]
