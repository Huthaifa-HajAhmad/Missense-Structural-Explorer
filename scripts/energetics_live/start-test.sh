#!/bin/sh
# (Re)starts the energetics test container from a given image, keeping its data folder.
# Production's settings file is read but AUTH_MODE, the setup secret and the port are the test's own.
#   sh start-test.sh <image>
set -eu
T=/home/ubuntu/energetics-test; P=/home/ubuntu/Missense-Structural-Explorer; IMG=$1
docker rm -f energetics-test >/dev/null 2>&1 || true
docker run -d --name energetics-test --env-file $P/.env.oci \
  -e NODE_ENV=production -e PORT=3000 -e AUTH_MODE=accounts -e ADMIN_SETUP_SECRET="$(cat $T/admin_secret)" \
  -e DEPLOYMENT_STANDBY=false -e THERMOMPNN_PROVIDER=local -e REDIS_URL= -e PREWARM_FOLDX_ENABLED=false \
  -e BUILD_COMMIT="$(echo "$IMG" | sed 's/.*cand-//')" -e PUBLIC_BASE_URL=http://127.0.0.1:3101 \
  -p 127.0.0.1:3100:3000 --memory 5g \
  -v $T/data:/app/data -v $P/data/df_rasp_gnomad_clinvar.sqlite:/app/data/df_rasp_gnomad_clinvar.sqlite:ro \
  -v $P/tools/foldx:/app/tools/foldx:ro -v $P/tools/foldx_linux:/app/tools/foldx_linux:ro \
  -v $P/tools/thermompnn:/app/tools/thermompnn:ro -v $P/tools/model_server_app:/app/tools/model_server_app:ro \
  -v $T/logs:/app/logs -v missense_resolve_hf_cache:/root/.cache/huggingface "$IMG" >/dev/null
for i in $(seq 1 40); do [ "$(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3100/api/v1/health)" = 200 ] && break; sleep 5; done
curl -s http://127.0.0.1:3100/api/v1/version; echo
