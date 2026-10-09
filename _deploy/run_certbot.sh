#!/bin/sh
certbot --nginx -d resirai.ir --non-interactive --agree-tos -m arjanaraye@yahoo.com --redirect 2>&1 | tail -8
