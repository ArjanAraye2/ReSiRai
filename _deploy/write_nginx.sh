#!/bin/sh
# ReSiRai.ir nginx site (root via docker bind-mount)
B=/root/resirai-nginx-backup-$(date +%Y%m%d-%H%M%S)
mkdir -p /host$B
cp /host/etc/nginx/sites-enabled/* /host$B/ 2>/dev/null || true
cp /host/etc/nginx/nginx.conf /host$B/nginx.conf

cat > /host/etc/nginx/sites-available/resirai.ir <<'NGX'
server {
    listen 80;
    listen [::]:80;
    server_name resirai.ir www.resirai.ir;

    client_max_body_size 1024m;

    location / {
        include proxy_params;
        proxy_pass http://127.0.0.1:5075;
    }
}
NGX
ln -sf /etc/nginx/sites-available/resirai.ir /host/etc/nginx/sites-enabled/resirai.ir
echo "=== written ==="
ls -la /host/etc/nginx/sites-enabled/resirai.ir
