"""Tests for the store of each deployed version's own page files; no Docker required."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("asset_generations", Path(__file__).with_name("asset_generations.py"))
asset_generations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asset_generations)
AssetStore = asset_generations.AssetStore


def write(folder, files):
    folder.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (folder / name).write_text(text, encoding="utf-8")


class AssetStoreTests(unittest.TestCase):
    def test_previous_versions_are_the_newest_others_and_never_the_new_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = AssetStore(Path(tmp))
            for commit in ["c1", "c2", "c3"]:
                write(store.path(commit), {f"{commit}.js": ""})
                store.record(commit)
            self.assertEqual(store.previous("c3", count=2), ["c1", "c2"])
            self.assertEqual(store.previous("c3", count=1), ["c2"])

    def test_prune_keeps_only_the_newest_versions(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = AssetStore(Path(tmp))
            for commit in ["c1", "c2", "c3", "c4"]:
                write(store.path(commit), {f"{commit}.js": ""})
                store.record(commit)
            store.prune(keep=2)
            self.assertEqual(store.order(), ["c3", "c4"])
            self.assertFalse(store.path("c1").exists())
            self.assertTrue(store.path("c4").exists())

    def test_recording_a_version_again_moves_it_to_the_newest_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = AssetStore(Path(tmp))
            for commit in ["c1", "c2", "c1"]:
                store.record(commit)
            self.assertEqual(store.order(), ["c2", "c1"])


class RetainAssetsTests(unittest.TestCase):
    """Runs the deploy step against a fake docker that keeps one build file per image."""

    def fake_docker(self, images):
        calls, scratch = [], {}

        def run(*args, capture=False, timeout=60):
            calls.append(args)
            if args[0] == "inspect":
                return images[args[-1]]
            if args[0] == "create":
                scratch[args[2]] = args[3]
            if args[0] == "cp" and args[1].split(":")[0] in scratch:
                image = scratch[args[1].split(":")[0]]
                (Path(args[2]) / f"{image}.js").write_text("")
            return ""
        return run, calls

    def test_new_container_gets_earlier_builds_only_and_old_archive_is_removed(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime = Path(tmp)
            write(runtime / "previous-assets", {"stale.js": ""})
            run, calls = self.fake_docker({"blue": "img-old", "green": "img-new"})
            asset_generations.retain_assets(run, runtime, "blue", "old", "green", "new")
            store = AssetStore(runtime / "asset-generations")
            self.assertFalse((runtime / "previous-assets").exists())
            self.assertEqual(store.order(), ["old", "new"])
            self.assertEqual([p.name for p in store.path("old").iterdir()], ["img-old.js"])
            self.assertEqual([p.name for p in store.path("new").iterdir()], ["img-new.js"])
            into_new = [c for c in calls if c[0] == "cp" and c[2] == "green:/app/dist/assets"]
            self.assertEqual(into_new, [("cp", f"{store.path('old')}/.", "green:/app/dist/assets")])
            # Every scratch container made for reading an image is removed again.
            made = [c[2] for c in calls if c[0] == "create"]
            removed = [c[2] for c in calls if c[:2] == ("rm", "-f")]
            self.assertTrue(set(made) <= set(removed))

    def test_a_version_already_stored_is_not_read_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime = Path(tmp)
            store = AssetStore(runtime / "asset-generations")
            write(store.path("old"), {"img-old.js": ""})
            store.record("old")
            run, calls = self.fake_docker({"blue": "img-old", "green": "img-new"})
            asset_generations.retain_assets(run, runtime, "blue", "old", "green", "new")
            self.assertNotIn(("inspect", "-f", "{{.Config.Image}}", "blue"), calls)


if __name__ == "__main__":
    unittest.main()
