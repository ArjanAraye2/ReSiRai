#!/bin/sh
docker exec postgresql psql -U django -d ArjanPeyman -c "CREATE USER resirai WITH PASSWORD 'R7s8R84ai-Clinic';"
docker exec postgresql psql -U django -d ArjanPeyman -c "CREATE DATABASE resirai OWNER resirai ENCODING 'UTF8';"
docker exec postgresql psql -U django -d ArjanPeyman -t -c "SELECT datname FROM pg_database WHERE datname='resirai';"
