"""
Stops a production deploy when the model server tests failed for the commit being deployed.

`cd.yml` starts a deploy when "Continuous Integration" passes. That workflow does not run the Python tests of the model server
(they need torch and large model files), so those tests have their own workflow, `sidecar.yml`, which runs only when a file the
model server uses changes. Without this check, a commit whose model server tests failed could still reach production.

What the check does with the runs of `sidecar.yml` for the deployed commit:

  - no run          the commit changed nothing those tests cover, so there is nothing to wait for: deploy
  - passed          deploy
  - still running   wait a little, then decide again. If it never finishes in time, stop (do not guess)
  - anything else   stop: failed, cancelled, timed out or never started

A manual deploy does not use this check (`cd.yml` skips it), so an older commit can still be put back on purpose.

Usage: GH_TOKEN=... GITHUB_REPOSITORY=owner/name DEPLOY_SHA=<commit> python3 deploy/model_server_gate.py
"""
import json
import os
import subprocess
import sys
import time

WORKFLOW = "sidecar.yml"
POLL_SECONDS = 20
WAIT_SECONDS = 600
# Results that mean "the tests did not fail". GitHub reports a run that was skipped by its own rules as `skipped`.
PASSED = {"success", "skipped", "neutral"}


def decide(runs):
    """Return ("deploy" | "wait" | "stop", reason) for the runs of the model server workflow on one commit."""
    if not runs:
        return "deploy", f"{WORKFLOW} did not run for this commit, so it changed nothing the model server tests cover."
    newest = max(runs, key=lambda run: run["created_at"])
    if newest["status"] != "completed":
        return "wait", f"{WORKFLOW} is still {newest['status']}."
    if newest["conclusion"] in PASSED:
        return "deploy", f"{WORKFLOW} finished with: {newest['conclusion']}."
    return "stop", f"{WORKFLOW} finished with: {newest['conclusion']}. See {newest['html_url']}"


def fetch_runs(repository, sha):
    """The runs of the model server workflow for one commit, as GitHub reports them. Raises if the request fails."""
    answer = subprocess.run(
        ["gh", "api", f"repos/{repository}/actions/workflows/{WORKFLOW}/runs", "-X", "GET", "-f", f"head_sha={sha}", "-f", "event=push", "-f", "per_page=10"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(answer.stdout)["workflow_runs"]


def check(get_runs, sleep=time.sleep, wait_seconds=WAIT_SECONDS, poll_seconds=POLL_SECONDS):
    """Return (True, reason) when the deploy may go on, (False, reason) when it must stop."""
    waited = 0
    while True:
        verdict, reason = decide(get_runs())
        if verdict == "deploy":
            return True, reason
        if verdict == "stop":
            return False, reason
        if waited >= wait_seconds:
            return False, f"{reason} It did not finish in {wait_seconds} seconds. Run this deploy again when it has finished."
        sleep(poll_seconds)
        waited += poll_seconds


def main():
    repository, sha = os.environ["GITHUB_REPOSITORY"], os.environ["DEPLOY_SHA"]

    def get_runs():
        # One failed request is not a reason to stop a deploy; three in a row is, because an unchecked gate is no gate.
        for attempt in range(3):
            try:
                return fetch_runs(repository, sha)
            except (subprocess.CalledProcessError, json.JSONDecodeError, KeyError):
                if attempt == 2:
                    raise
                time.sleep(5)

    try:
        allowed, reason = check(get_runs)
    except (subprocess.CalledProcessError, json.JSONDecodeError, KeyError) as error:
        print(f"::error::Could not read the model server test results from GitHub ({error}). Run this deploy again.")
        return 1
    if allowed:
        print(f"[CD] Model server tests: {reason}")
        return 0
    print(f"::error::Not deploying {sha}. {reason}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
