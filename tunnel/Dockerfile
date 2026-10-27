# Túnel rápido de Cloudflare con vigilante: si el túnel pierde la conexión (p. ej. tras reiniciar o suspender
# el equipo, Cloudflare borra los túneles rápidos), se reinicia solo y obtiene una URL nueva que sí funciona.
FROM cloudflare/cloudflared:2024.12.2 AS cf

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=cf /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY run.sh /run.sh
RUN chmod +x /run.sh && sed -i 's/\r$//' /run.sh
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS http://127.0.0.1:2000/ready || exit 1
ENTRYPOINT ["/run.sh"]
