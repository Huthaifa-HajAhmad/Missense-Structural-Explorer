#!/bin/sh
# Cuts one outside dependency of the TEST container at a time and runs a fresh case through it.
# Firewall rules match only the test container's address, so production is not affected. The trap
# removes every rule and resumes the model server even when a step fails.
#
#   sh outage.sh            (run on the VM; needs passwordless sudo for iptables)
set -eu
T=/home/ubuntu/energetics-test
IMG=$(docker inspect -f '{{.Config.Image}}' energetics-test)
SRC=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' energetics-test)
EBI=$(getent ahostsv4 www.ebi.ac.uk | awk '{print $1}' | sort -u)
cd $T/run

block() { for ip in $1; do sudo -n iptables -I DOCKER-USER -s "$SRC" -d "$ip" -j REJECT; done; echo "[$(date -u +%T)] blocked $1"; }
unblock() { for ip in $1; do while sudo -n iptables -D DOCKER-USER -s "$SRC" -d "$ip" -j REJECT 2>/dev/null; do :; done; done; echo "[$(date -u +%T)] unblocked $1"; }
model_pid() { docker exec energetics-test sh -c "pgrep -f tools/model_server.py | head -1"; }
cleanup() { unblock "$EBI"; p=$(model_pid || true); [ -n "$p" ] && docker exec energetics-test kill -CONT "$p" || true; }
trap cleanup EXIT

case_file() { echo "[{\"name\":\"$1\",\"uniprotId\":\"P49789\",\"mutation\":\"$2\",\"pdbFile\":\"/pdb/1FIT.pdb\",\"user\":$3}]" > outage-$4.json; }
harness() {  # $1 label; runs detached, returns the container name
  docker rm -f "h-$1" >/dev/null 2>&1 || true
  docker run -d --name "h-$1" --network host -v $T/run:/w -v $T/pdb:/pdb:ro -w /w --entrypoint node "$IMG" \
    run.mjs --base http://127.0.0.1:3100 --cases "outage-$1.json" --users users.json --out "outage-$1.jsonl" >/dev/null
  echo "h-$1"
}
retry() {  # $1 tool, $2 mutation, $3 user
  docker run --rm --network host -v $T/run:/w -v $T/pdb:/pdb:ro -w /w --entrypoint node "$IMG" \
    retry.mjs --base http://127.0.0.1:3100 --users users.json --user "$3" --tool "$1" --pdbFile /pdb/1FIT.pdb --mutation "$2"
}
rm -f outage-*.jsonl

echo "== C: www.ebi.ac.uk (ProtVar) unreachable; structure supplied, so no structure fetch needs it"
case_file "outage C: EBI blocked, FHIT E132A" EA132A 3 C
block "$EBI"; docker wait "$(harness C)" >/dev/null; unblock "$EBI"

echo "== D: model server paused (process kept, not killed)"
case_file "outage D: model server paused, FHIT S131A" SA131A 4 D
p=$(model_pid); docker exec energetics-test kill -STOP "$p"; echo "[$(date -u +%T)] paused model server pid $p"
docker wait "$(harness D)" >/dev/null
docker exec energetics-test kill -CONT "$p"; echo "[$(date -u +%T)] resumed pid $p; now running: $(model_pid)"
sleep 20
echo "-- D retry after resume"; retry thermompnn SA131A 4
docker logs --since 40m energetics-test 2>&1 | grep -i -E "supervisor|sidecar.*(restart|unhealthy|dead)" | tail -5 || true
