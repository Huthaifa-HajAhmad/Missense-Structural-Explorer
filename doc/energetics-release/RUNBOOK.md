# Energetics runbook (one page)

For the team running Missense & Fold on the OCI VM (`ubuntu@<vm>`, app checkout `/home/ubuntu/Missense-Structural-Explorer`).
Production runs as `missense-resolve-blue` or `-green` behind `missense-resolve-caddy`. Read-only checks first; never
`docker restart` an app container (it keeps the old settings and skips the safe handover).

## 1. Is it healthy?

| Check | Command | Healthy |
| --- | --- | --- |
| Serving revision | `curl -s https://<host>/api/v1/version` | the commit you expect |
| App answers | `curl -s -o /dev/null -w '%{http_code} %{time_total}\n' https://<host>/api/v1/health` | `200`, well under 1 s |
| Queue held? | `docker logs --since 10m <app> 2>&1 \| grep -c "High memory pressure"` | `0`; otherwise the panel says "on hold: the server is short of memory" |
| Model server | `docker logs --since 30m <app> 2>&1 \| grep -i "Sidecar Supervisor"` | no repeated "probe failed" strikes |
| Deploy journal | `cat deploy/runtime/rollout.json` | phase `complete`; `needs_attention` means stop and read `deploy/ROLLOUT.md` |

Engine outcomes, read-only: `sqlite3 -readonly "file:data/shared_state.sqlite?mode=ro"` on `biophysical_jobs`
(`result.energetics`, `data.remoteJobs`) and `job_telemetry`. DynaMut2 and DDMut final states are only in
`logs/audit.jsonl` (`DYNAMUT2_POLL` / `DDMUT_POLL`, last event per `jobId`); see `doc/STATE_MACHINES.md` 6c.
Final state per BioSig job, counted:

```bash
python3 -c "import json,collections; last={}; [last.__setitem__((e['action'],e.get('jobId')),e.get('status')+('/'+e['reason'] if e.get('reason') else '')) for e in map(json.loads,open('logs/audit.jsonl')) if e.get('action') in ('DYNAMUT2_POLL','DDMUT_POLL')]; print(collections.Counter((a,s) for (a,_),s in last.items()))"
```

## 2. An outside service is down

What users see, and what to do. No restart is needed for any of these; the other engines keep working.

| Down | Panel shows | Action |
| --- | --- | --- |
| BioSig (DynaMut2, DDMut) | "Provider busy … can be retried later"; a late answer still arrives while the page listens (5 min) | Wait; users press **Retry DynaMut2**. Check `https://biosig.lab.uq.edu.au` from the VM. |
| EBI (ProtVar; also PDBe structure lookup) | ProtVar "Provider error"; with no cached structure, new variants fall back to the AlphaFold model | Wait. ProtVar is reference-only and never changes the verdict. |
| Model server (ThermoMPNN, StabilityOracle) | "Provider busy" or "The local model service could not be reached … can be retried later" | ThermoMPNN: **Retry ThermoMPNN**. StabilityOracle: run the analysis again after 15 min (it reruns beside the cached FoldX value). If it stays down, see 3. |
| User's own connection | "Lost contact with the server … reload the page in a few minutes" | Reload; the server kept the job and serves its result. |

## 3. Restart the model server or the app

The sidecar supervisor restarts the model server by itself after 3 failed health probes. If it does not
recover, hand over to a fresh generation of the same revision (drains running jobs first):

```bash
cd /home/ubuntu/Missense-Structural-Explorer && python3 deploy/rollout.py --restart --commit "$(git rev-parse HEAD)"
```

## 4. Roll back a deploy

Revert the change on `main` (a revert PR) and let Continuous Deployment roll it out; the handover is the same
as any deploy. The host log `~/mse-deploy-<commit>-*.log` ends with `DEPLOY_OK` or `DEPLOY_FAILED`; a failed
deploy rolls itself back. Never run `rollout.py` on a checkout with local changes: it refuses, by design.

## 5. Test something without touching production

Start the separate test container from an image (`scripts/energetics_live/start-test.sh <image>`; port 3100 on
the VM only), create test users with `setup-users.mjs`, then use `run.mjs` (cases), `load.sh` (5 accounts),
`outage.sh` (one dependency cut at a time) and `retry.mjs`. Never run these against production.
