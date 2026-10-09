#!/bin/sh
# منتظر انتشار delegation از .ir میماند، بعد SSL میگیرد.
LOG=/root/resirai-cert.log
i=0
while [ $i -lt 120 ]; do
  if dig +short NS resirai.ir @8.8.8.8 | grep -q cloudflare; then
    echo "$(date) — DNS propagated; running certbot" >> "$LOG"
    # www ممکن است کمی دیرتر منتشر شود؛ فقط resirai.ir برای گواهیِ بهم کافی است
    # و www بعداً با گواهی گسترده پوشش 데이터 میشود.
    certbot --nginx -d resirai.ir -d www.resirai.ir --non-interactive --agree-tos -m arjanaraye@yahoo.com --redirect --expand >> "$LOG" 2>&1 ||
    certbot --nginx -d resirai.ir --non-interactive --agree-tos -m arjanaraye@yahoo.com --redirect >> "$LOG" 2>&1
    echo "$(date) — certbot done (exit $?)" >> "$LOG"
    exit 0
  fi
  i=$((i+1))
  sleep 300
done
echo "$(date) — timeout after 10h" >> "$LOG"
