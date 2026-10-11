/**
 * tool-bundles.ts — the team's FoldX bundle, as the admin uploaded it (plan decision 6, WP-F2).
 *
 * FoldX is licensed software. The owner's position (decision 6) is research use within a small team, so by
 * default the admin uploads the licensed zip ONCE per platform and every paired computer installs it with no
 * action from its owner. The owner can revoke at any time: the stored bundle is deleted, the version
 * changes to "none", and each computer erases its copy at its next contact.
 *
 * Layout, OUTSIDE the web root and never derived from a request (the platform is checked against an
 * allow-list before it becomes a path segment):
 *
 *   <TOOL_BUNDLES_DIR>/foldx/manifest.json           {generation, platforms:{win32:{version,sha256,…}}}
 *   <TOOL_BUNDLES_DIR>/foldx/<platform>/<version>.zip
 *
 * `generation` only ever increases (each upload and each revoke), so a version number is never reused: a
 * computer that sees a different number than the one it installed acts on it, whatever the change was.
 * The manifest is written by rename, so a reader sees the old one or the new one, never half of either.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { isFoldxPlatform, type FoldxPlatform } from "./foldx-archive.ts";

export interface FoldxBundleInfo {
  platform: FoldxPlatform;
  /** The bundle's version as computers see it: the generation at upload, as a string. */
  version: string;
  sha256: string;
  sizeBytes: number;
  /** The FoldX program's own file name inside the zip (it carries the build's date). */
  binaryName: string;
  /** The build's last working day, from its name, when it has one. */
  expiry: string | null;
  uploadedBy: string;
  uploadedAt: number;
  /** When the uploading admin confirmed the licence permits sharing it with the team. */
  licenceConfirmedAt: number;
}

interface Manifest {
  generation: number;
  platforms: Partial<Record<FoldxPlatform, FoldxBundleInfo>>;
}

export function toolBundlesDir(): string {
  if (process.env.TOOL_BUNDLES_DIR) return process.env.TOOL_BUNDLES_DIR;
  return path.join(process.cwd(), "data", "tool-bundles");
}

function foldxDir(): string {
  return path.join(toolBundlesDir(), "foldx");
}

function manifestPath(): string {
  return path.join(foldxDir(), "manifest.json");
}

function readManifest(): Manifest {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(), "utf8"));
    if (parsed && typeof parsed.generation === "number" && parsed.platforms && typeof parsed.platforms === "object") return parsed;
  } catch {
    /* none yet, or unreadable: no bundle */
  }
  return { generation: 0, platforms: {} };
}

function writeManifest(m: Manifest): void {
  fs.mkdirSync(foldxDir(), { recursive: true });
  const tmp = `${manifestPath()}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2));
  fs.renameSync(tmp, manifestPath());
}

/** The bundle a computer on `platform` should have, or null for none (never uploaded, or revoked). */
export function foldxBundleFor(platform: string): FoldxBundleInfo | null {
  if (!isFoldxPlatform(platform)) return null;
  const info = readManifest().platforms[platform];
  if (!info) return null;
  // A manifest entry without its file (a restore that missed the zip) is treated as no bundle.
  return fs.existsSync(foldxBundlePath(info)) ? info : null;
}

/** What the admin page lists: one row per platform with a bundle. */
export function listFoldxBundles(): FoldxBundleInfo[] {
  const m = readManifest();
  return Object.values(m.platforms).filter((b): b is FoldxBundleInfo => Boolean(b) && fs.existsSync(foldxBundlePath(b!)));
}

/** Server-chosen path of a bundle's zip. Never built from request text other than the allow-listed platform. */
export function foldxBundlePath(info: Pick<FoldxBundleInfo, "platform" | "version">): string {
  if (!isFoldxPlatform(info.platform) || !/^\d+$/.test(info.version)) throw new Error("Invalid bundle reference.");
  return path.join(foldxDir(), info.platform, `${info.version}.zip`);
}

/**
 * Store a checked zip as the new bundle for `platform`. `tempFile` is moved, not copied. Older versions of
 * that platform are deleted. Returns the new entry.
 */
export function storeFoldxBundle(input: {
  platform: FoldxPlatform;
  tempFile: string;
  sha256: string;
  sizeBytes: number;
  binaryName: string;
  expiry: string | null;
  uploadedBy: string;
  now: number;
}): FoldxBundleInfo {
  const m = readManifest();
  const version = String(m.generation + 1);
  const info: FoldxBundleInfo = {
    platform: input.platform,
    version,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    binaryName: input.binaryName,
    expiry: input.expiry,
    uploadedBy: input.uploadedBy,
    uploadedAt: input.now,
    licenceConfirmedAt: input.now,
  };
  const target = foldxBundlePath(info);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(input.tempFile, target);
  writeManifest({ generation: m.generation + 1, platforms: { ...m.platforms, [input.platform]: info } });
  // Only the current version of this platform is kept.
  for (const f of fs.readdirSync(path.dirname(target))) {
    if (f !== `${version}.zip`) fs.rmSync(path.join(path.dirname(target), f), { force: true, recursive: true });
  }
  return info;
}

/**
 * Remove FoldX from the team: delete every stored bundle and move the generation on, so each computer's
 * installed version no longer matches and it erases its copy. Returns how many platforms had a bundle.
 */
export function revokeFoldxBundles(): number {
  const m = readManifest();
  const had = Object.keys(m.platforms).length;
  for (const p of ["win32", "linux", "darwin"] as const) {
    fs.rmSync(path.join(foldxDir(), p), { recursive: true, force: true });
  }
  writeManifest({ generation: m.generation + 1, platforms: {} });
  return had;
}

/** A private temp path for an upload in progress, inside the bundles folder (same disk, so the move is a rename). */
export function newUploadTempPath(): string {
  const dir = path.join(foldxDir(), ".uploads");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.zip`);
}
