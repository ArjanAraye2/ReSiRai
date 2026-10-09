#!/bin/bash
set -e
docker cp /tmp/resirai-sql pg_qr 2>/dev/null || true
docker cp /tmp/resirai-sql postgresql:/tmp/resirai-sql
docker exec postgresql psql -U django -d resirai -f /tmp/resirai-sql
rm -f /tmp/resirai-sql /tmp/resirai-cdb
