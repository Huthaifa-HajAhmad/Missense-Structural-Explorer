#!/bin/sh
# Runs one load case file against the test container while sampling /health and the container's
# memory, then prints restart and out-of-memory counts. Usage: load.sh <cases.json> <label>
set -e
T=/home/ubuntu/energetics-test; IMG=$(docker inspect -f '{{.Config.Image}}' energetics-test); CASES=$1; LABEL=$2
rm -f $T/run/$LABEL.done
docker inspect -f 'before restarts={{.RestartCount}} oom={{.State.OOMKilled}}' energetics-test
docker rm -f health-$LABEL harness-$LABEL >/dev/null 2>&1 || true
docker run -d --name health-$LABEL --network host -v $T/run:/w -w /w --entrypoint node $IMG \
  health.mjs --base http://127.0.0.1:3100 --seconds 7200 --interval 2 --until-file $LABEL.done --out $LABEL-health.json >/dev/null
( while [ ! -f $T/run/$LABEL.done ]; do docker stats --no-stream --format '{{.MemUsage}} {{.CPUPerc}}' energetics-test missense-resolve-blue | tr '\n' ' '; echo; sleep 10; done ) > $T/run/$LABEL-stats.txt &
docker run --name harness-$LABEL --network host -v $T/run:/w -v $T/pdb:/pdb:ro -w /w --entrypoint node $IMG \
  run.mjs --base http://127.0.0.1:3100 --cases $CASES --users users.json --parallel --out $LABEL.jsonl >/dev/null
touch $T/run/$LABEL.done
docker wait health-$LABEL >/dev/null; docker logs health-$LABEL
docker rm -f health-$LABEL harness-$LABEL >/dev/null
docker inspect -f 'after restarts={{.RestartCount}} oom={{.State.OOMKilled}}' energetics-test
