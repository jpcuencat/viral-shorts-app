#!/bin/sh
# Vigilante del túnel rápido: arranca cloudflared y, si /ready no responde durante ~1 minuto, lo reinicia.
TARGET="${TUNNEL_TARGET:-http://app:3000}"
while true; do
  echo "[tunnel] Iniciando túnel rápido hacia $TARGET"
  cloudflared tunnel --no-autoupdate --metrics 0.0.0.0:2000 --url "$TARGET" &
  PID=$!
  STARTED=$(date +%s)
  FAILS=0
  while kill -0 "$PID" 2>/dev/null; do
    sleep 15
    if curl -fsS -o /dev/null http://127.0.0.1:2000/ready; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
    fi
    AGE=$(( $(date +%s) - STARTED ))
    if [ "$AGE" -gt 90 ] && [ "$FAILS" -ge 4 ]; then
      echo "[tunnel] Sin conexión con Cloudflare hace ~1 min: reiniciando para obtener una URL nueva"
      kill "$PID" 2>/dev/null
      sleep 5
      kill -9 "$PID" 2>/dev/null
    fi
  done
  wait "$PID" 2>/dev/null
  sleep 3
done
