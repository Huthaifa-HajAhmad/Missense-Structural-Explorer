"""Each deployed version's own page files, kept on the host so tabs opened on an earlier version still work.

A browser tab loads code-split files ("chunks") lazily. After a deploy, a tab opened on the previous
version still asks for that version's chunks; if they are gone the app reloads itself and the user
loses the analysis on screen. So every new container also serves the chunks of a few earlier versions.

Earlier, each new container received everything the old container served, including what that one had
received in turn. Nothing ever left, the set grew to 1.1 GB, and copying it outran the deploy's time
limit. Here each version's OWN files (read from its image, which holds nothing carried in) are stored
once, under its commit, and only the newest few versions are kept, so the size stays at a few builds
however many deploys there are.
"""
import json
from pathlib import Path
import shutil

KEEP_PREVIOUS = 5
# A whole build's assets are about 10 MB; the limit covers a slow disk, not a growing set.
COPY_TIMEOUT = 300


class AssetStore:
    """One folder per version (named by commit) plus order.json, oldest first."""

    def __init__(self, root):
        self.root = Path(root)
        self.order_file = self.root / "order.json"

    def path(self, commit):
        return self.root / commit

    def has(self, commit):
        return self.path(commit).is_dir()

    def order(self):
        return json.loads(self.order_file.read_text()) if self.order_file.exists() else []

    def _write_order(self, order):
        self.root.mkdir(parents=True, exist_ok=True)
        self.order_file.write_text(json.dumps(order))

    def record(self, commit):
        """Marks commit as the newest version."""
        self._write_order([c for c in self.order() if c != commit] + [commit])

    def previous(self, commit, count=KEEP_PREVIOUS):
        """The newest stored versions other than commit, oldest first."""
        return [c for c in self.order() if c != commit and self.has(c)][-count:]

    def prune(self, keep=KEEP_PREVIOUS + 1):
        order = self.order()
        for commit in order[:-keep]:
            shutil.rmtree(self.path(commit), ignore_errors=True)
        self._write_order(order[-keep:])


def save_build_assets(run, container, commit, store):
    """Stores the assets a version was built with, read from its image rather than its running copy."""
    image = run("inspect", "-f", "{{.Config.Image}}", container, capture=True).strip()
    scratch = f"mse-assets-{commit[:12]}"
    dest = store.path(commit)
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    run("rm", "-f", scratch, capture=True)
    run("create", "--name", scratch, image, capture=True)
    try:
        run("cp", f"{scratch}:/app/dist/assets/.", str(dest), timeout=COPY_TIMEOUT)
    finally:
        run("rm", "-f", scratch, capture=True)
    store.record(commit)


def retain_assets(run, runtime, old, old_commit, candidate, commit):
    """Gives the new container the page files of the last few versions.

    `run` calls the docker command line; `runtime` is the host folder for deploy state.
    """
    # The former single archive of everything ever served (1 GB by 2026-11-18) is no longer used.
    shutil.rmtree(Path(runtime) / "previous-assets", ignore_errors=True)
    store = AssetStore(Path(runtime) / "asset-generations")
    if old_commit and not store.has(old_commit):
        save_build_assets(run, old, old_commit, store)
    save_build_assets(run, candidate, commit, store)
    for previous in store.previous(commit):
        run("cp", f"{store.path(previous)}/.", f"{candidate}:/app/dist/assets", timeout=COPY_TIMEOUT)
    store.prune()
