#!/usr/bin/env python3
"""Health-gated OCI handover. Run under the host deployment flock; no third-party packages."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
PROXY = "missense-resolve-caddy"
SLOTS = ("missense-resolve-blue", "missense-resolve-green")

# A build exports the whole image again, and the same volume already holds two generations. On
# 2026-10-10 it filled up: every deploy died at the final unpack with ENOSPC *while CD reported
# success*, so production sat two revisions behind and nothing said so. This floor turns that
# eight-minutes-in failure-in-the-dark into an immediate, named refusal — and reclaims the
# rebuildable space first, so the common case (accumulated images) heals itself.
#
# 20 GiB is generous for one image export and small enough that a healthy host never reaches it;
# override with MSE_MIN_FREE_DISK_MB. MSE_DISK_PATH exists for tests and unusual mounts.
MIN_FREE_DISK_MB = 20 * 1024
DISK_PATH = os.environ.get("MSE_DISK_PATH", "/")


def min_free_disk_mb():
    raw = os.environ.get("MSE_MIN_FREE_DISK_MB", "").strip()
    return int(raw) if raw else MIN_FREE_DISK_MB


def free_disk_mb(path=DISK_PATH):
    return shutil.disk_usage(path).free // (1024 * 1024)


class Docker:
    def run(self, *args, capture=False, timeout=60, env=None):
        result = subprocess.run(["docker", *args], cwd=ROOT, check=True,
                                text=True, stdout=subprocess.PIPE if capture else None,
                                timeout=timeout, env=env)
        return result.stdout if capture else ""

    def inspect(self, name):
        return json.loads(self.run("inspect", name, capture=True))[0]

    def control(self, name, action=None, probe=False):
        # No tokens in command lines or output; the application checks the actual loopback peer.
        suffix = f"/{action}" if action else ("/?probe=true" if probe else "/")
        js = ("fetch('http://127.0.0.1:3000/internal/deployment" + suffix + "',"
              "{method:'" + ("POST" if action else "GET") + "',signal:AbortSignal.timeout(5000)})"
              ".then(async r=>{if(!r.ok)throw Error('control HTTP '+r.status);"
              "console.log(JSON.stringify(await r.json()))}).catch(e=>{console.error(e.message);process.exit(1)})")
        return json.loads(self.run("exec", name, "node", "-e", js, capture=True, timeout=10))

    def proxy_target(self):
        config = json.loads(self.run("exec", PROXY, "wget", "-qO-", "http://127.0.0.1:2019/config/", capture=True))
        targets = set()

        def walk(value):
            if isinstance(value, dict):
                if value.get("handler") == "reverse_proxy":
                    targets.update(u["dial"] for u in value.get("upstreams", []))
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)
        walk(config)
        allowed = {f"{name}:3000" for name in (*SLOTS, "missense-resolve-app")}
        if len(targets) != 1 or not targets.issubset(allowed):
            raise RuntimeError("Unexpected proxy topology; refusing to change it")
        return next(iter(targets)).split(":")[0]

    def switch(self, target):
        if target not in (*SLOTS, "missense-resolve-app"):
            raise ValueError("Invalid generation")
        template = (ROOT / "Caddyfile").read_text()
        if template.count("reverse_proxy missense-resolve-app:3000") != 1:
            raise RuntimeError("Caddyfile must contain exactly one application upstream")
        config = ROOT / "deploy/runtime/next.Caddyfile"
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text(template.replace("reverse_proxy missense-resolve-app:3000", f"reverse_proxy {target}:3000"))
        self.run("cp", str(config), f"{PROXY}:/data/mse-next.Caddyfile")
        self.run("exec", PROXY, "caddy", "validate", "--config", "/data/mse-next.Caddyfile", "--adapter", "caddyfile")
        self.run("exec", PROXY, "caddy", "reload", "--config", "/data/mse-next.Caddyfile", "--adapter", "caddyfile")
        if self.proxy_target() != target:
            raise RuntimeError("Proxy switch did not select the expected generation")

    def available_mb(self):
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
        raise RuntimeError("Cannot determine host memory headroom")

    def reclaim_build_space(self):
        # Only rebuildable, non-serving things: build cache and images no container references. This
        # driver always builds a fresh image and never runs an older one, so none of it is needed to
        # serve or to roll back. Failures are non-fatal — the headroom check below is the real gate.
        for args in (("builder", "prune", "-f"), ("image", "prune", "-a", "-f")):
            try:
                self.run(*args, capture=True, timeout=600)
            except subprocess.SubprocessError as error:
                print(f"[CD] reclaim ({' '.join(args)}) failed: {error}", flush=True)

    def ensure_build_headroom(self, commit):
        required = min_free_disk_mb()
        free = free_disk_mb()
        if free < required:
            print(f"[CD] {free} MiB free (< {required} MiB); reclaiming build cache and unused images", flush=True)
            self.reclaim_build_space()
            free = free_disk_mb()
        if free < required:
            raise RuntimeError(
                f"Only {free} MiB free on {DISK_PATH}; the image export needs about {required} MiB. "
                f"Free space on the host (or lower MSE_MIN_FREE_DISK_MB), then redeploy — the serving "
                f"generation is untouched."
            )
        return free

    def public_version(self):
        with urllib.request.urlopen("https://missense-resolve.duckdns.org/api/v1/version", timeout=10) as response:
            return json.load(response)["commit"]

    def start_candidate(self, name, commit):
        # Never stop a running leftover: it may still have a stream or worker from a failed drain.
        names = self.run("ps", "-a", "--format", "{{.Names}}", capture=True).splitlines()
        if name in names:
            if self.inspect(name)["State"]["Running"]:
                raise RuntimeError(f"{name} is still running; resolve the previous handover first")
            self.run("rm", name)
        # Refuse (after reclaiming) before the build starts: a build that fills the volume fails at
        # the very end, long after the CD runner has returned, and takes production's headroom with it.
        self.ensure_build_headroom(commit)
        env = dict(os.environ, APP_CONTAINER_NAME=name, APP_IMAGE=f"missense-resolve:oci-{commit}",
                   DEPLOYMENT_STANDBY="true", APP_MEMORY_LIMIT="4g", BUILD_COMMIT=commit)
        compose = ("compose", "-p", name, "-f", "deploy/docker-compose.oci.yml")
        self.run(*compose, "build", "missense-resolve-app", timeout=3600, env=env)
        if self.available_mb() < 5120:
            raise RuntimeError("Less than 5 GiB available for a 4 GiB standby and host reserve; deployment deferred")
        self.run(*compose, "up", "-d", "--no-deps", "--no-build", "missense-resolve-app", env=env)

    def retain_assets(self, old, candidate):
        # Lazy-loaded chunks from open tabs must survive a server revision change.
        archive = ROOT / "deploy/runtime/previous-assets"
        if archive.exists():
            shutil.rmtree(archive)
        archive.mkdir(parents=True)
        self.run("cp", f"{old}:/app/dist/assets/.", str(archive))
        self.run("cp", str(archive) + "/.", f"{candidate}:/app/dist/assets")
        shutil.rmtree(archive)


def drained(status):
    return (status.get("protocol") == 1 and status.get("paused") is True
            and all(status.get(key) == 0 for key in ("activeRequests", "activeJobs", "backgroundTasks")))


class Rollout:
    def __init__(self, docker, commit, readiness_timeout=600, drain_timeout=1800,
                 clock=time.monotonic, sleep=time.sleep, journal=None, restart=False):
        self.docker, self.commit = docker, commit
        # Hand over to a fresh generation of the SAME revision, so an edited .env.oci takes effect
        # (Compose reads it only when a container is created). Without this a same-revision run is a
        # no-op, and the only way to apply a setting was recreating the serving container by hand,
        # which skips the drain. The proxy switch is still verified through Caddy's admin config;
        # the public version check can only confirm the revision, which both generations share.
        self.restart = restart
        self.readiness_timeout, self.drain_timeout = readiness_timeout, drain_timeout
        self.clock, self.sleep = clock, sleep
        self.journal = journal or ROOT / "deploy/runtime/rollout.json"
        self.old = self.candidate = None
        self.switched = self.pause_issued = self.activation_issued = False

    def record(self, phase, **extra):
        state = dict(phase=phase, commit=self.commit, active=self.old, candidate=self.candidate,
                     timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        state.update(extra)
        self.journal.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.journal.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, indent=2) + "\n")
        temporary.replace(self.journal)
        print(f"[CD] {phase} commit={self.commit}", flush=True)

    def wait(self, name, predicate, seconds, probe=False):
        deadline = self.clock() + seconds
        while self.clock() < deadline:
            try:
                status = self.docker.control(name, probe=probe)
                if predicate(status):
                    return status
            except (subprocess.SubprocessError, ValueError):
                pass  # A starting process is not ready yet. The old generation still serves.
            if self.docker.available_mb() < 512:
                raise RuntimeError("Host memory reserve exhausted; refusing to continue handover")
            self.sleep(5)
        raise RuntimeError(f"{name} did not become ready or drain within {seconds}s")

    def execute(self):
        self.record("preflight")
        try:
            self.old = self.docker.proxy_target()
            status = self.docker.control(self.old)
            if status.get("protocol") != 1 or status.get("backend") != "sqlite" or status.get("paused") is not False:
                raise RuntimeError("Serving generation lacks an active SQLite handover protocol; complete the documented bootstrap first")
            command = self.docker.inspect(PROXY)["Config"]["Cmd"]
            if "--resume" not in command:
                raise RuntimeError("Caddy must start with --resume before automatic handovers; complete bootstrap first")
            running = self.docker.run("ps", "--format", "{{.Names}}", capture=True).splitlines()
            if "missense-resolve-tunnel" in running:
                raise RuntimeError("Migrate the tunnel origin to the stable proxy before enabling handovers")
        except Exception:
            self.record("refused")
            raise
        if status.get("commit") == self.commit and not self.restart:
            self.record("complete", active=self.old)
            print(f"[CD] DEPLOY_OK {self.commit} (already serving)", flush=True)
            return
        self.candidate = SLOTS[1] if self.old == SLOTS[0] else SLOTS[0]
        self.record("building")
        ownership_transferred = False
        try:
            self.docker.start_candidate(self.candidate, self.commit)
            self.docker.retain_assets(self.old, self.candidate)
            self.record("warming")
            self.wait(self.candidate, lambda s: s.get("protocol") == 1 and s.get("backend") == "sqlite"
                      and s.get("paused") is True and s.get("ready") is True and s.get("commit") == self.commit,
                      self.readiness_timeout, probe=True)
            self.record("switching")
            # Mark before calls: a successful action followed by a lost response is ambiguous.
            self.pause_issued = True
            self.docker.control(self.old, "pause")
            self.switched = True
            self.docker.switch(self.candidate)
            if self.docker.public_version() != self.commit:
                raise RuntimeError("Public proxy did not serve the expected candidate revision")
            self.record("draining")
            self.wait(self.old, drained, self.drain_timeout)
            self.record("activating")
            self.activation_issued = True
            result = self.docker.control(self.candidate, "resume")
            if result.get("paused") is not False:
                raise RuntimeError("Candidate did not acquire worker ownership")
            ownership_transferred = True
            self.docker.run("update", "--memory", "10g", "--memory-swap", "20g", self.candidate)
            self.docker.run("stop", "--time", "30", self.old)
            self.record("complete", active=self.candidate, retired=self.old)
            print(f"[CD] DEPLOY_OK {self.commit}", flush=True)
        except Exception:
            if ownership_transferred:
                # The old process may already be stopped. Keep the verified serving generation.
                self.record("cleanup_pending", active=self.candidate)
            else:
                self.rollback()
            raise

    def rollback(self):
        self.record("rolling_back")
        try:
            if self.switched:
                self.docker.switch(self.old)
            if self.activation_issued:
                # Never run both worker generations, even after a lost activation response.
                self.docker.control(self.candidate, "pause")
                self.wait(self.candidate, drained, self.drain_timeout)
            if self.pause_issued:
                self.docker.control(self.old, "resume")
            # Preserve streams accepted by the candidate before rollback. Never force-stop them.
            names = self.docker.run("ps", "--format", "{{.Names}}", capture=True).splitlines()
            if self.candidate in names:
                self.wait(self.candidate, drained, self.drain_timeout)
                self.docker.run("stop", "--time", "30", self.candidate)
            self.record("rolled_back")
        except Exception:
            self.record("needs_attention")
            print("[CD] Rollback could not safely drain; retained containers. Inspect deploy/runtime/rollout.json.", flush=True)
            raise


def main():
    import fcntl  # This driver is intentionally Linux-only; tests can exercise its state machine anywhere.
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--restart", action="store_true",
                        help="hand over even when this revision already serves, to apply an edited .env.oci")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        parser.error("--commit must be a full Git SHA")
    try:
        lock_path = Path.home() / ".mse-deploy.lock"
        inherited = os.environ.get("MSE_DEPLOY_LOCK_FD")
        if inherited:
            lock_fd = int(inherited)
            inherited_stat, target_stat = os.fstat(lock_fd), lock_path.stat()
            if (inherited_stat.st_dev, inherited_stat.st_ino) != (target_stat.st_dev, target_stat.st_ino):
                raise RuntimeError("Inherited deployment lock does not match the host lock")
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            run_verified_checkout(args.commit, args.restart)
        else:
            with lock_path.open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                run_verified_checkout(args.commit, args.restart)
    except Exception as error:
        print(f"[CD] DEPLOY_FAILED: {error}", flush=True)
        return 1
    return 0


def run_verified_checkout(commit, restart=False):
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if actual != commit:
        raise RuntimeError("Checkout revision does not match --commit; refusing a mislabeled image")
    subprocess.run(["git", "diff", "--quiet", "--exit-code"], cwd=ROOT, check=True)
    subprocess.run(["git", "diff", "--cached", "--quiet", "--exit-code"], cwd=ROOT, check=True)
    Rollout(Docker(), commit, restart=restart).execute()


if __name__ == "__main__":
    raise SystemExit(main())
