/**
 * foldx-archive.ts — is this zip a usable FoldX for that platform, and if so, install it.
 *
 * Shared by both ends of FoldX distribution (plan WP-F2):
 *   - the server, when an admin uploads the team bundle (`PUT /admin/tools/foldx/:platform`), so a wrong
 *     or incomplete zip is refused at upload instead of breaking every computer that downloads it;
 *   - the agent, when it installs the team bundle or a person drops the zip they downloaded themselves.
 *
 * People are not expected to know what is inside a FoldX download, so the checks look at CONTENT, not at
 * names: the program is recognised by its executable header (Windows PE, Linux ELF, macOS Mach-O), which
 * is what makes "this looks like the Linux build; this computer needs the Windows one" a reliable sentence.
 * FoldX also needs its parameter files beside it: the `molecules` folder and `rotabase.txt`
 * (`foldx/runner.ts` refuses to run without them).
 *
 * Installing never uses a path from the archive: files are written under names this module chooses
 * (the program's own base name, checked; `molecules/<file>` base names, checked), so an entry like
 * `../../x` cannot write outside the install folder. Sizes are bounded against zip bombs.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import JSZip from "jszip";
import { foldxBuildExpired, foldxBuildExpiry } from "./host-probe.ts";

export type FoldxPlatform = "win32" | "linux" | "darwin";
export const FOLDX_PLATFORMS: readonly FoldxPlatform[] = ["win32", "linux", "darwin"];

export function isFoldxPlatform(value: unknown): value is FoldxPlatform {
  return typeof value === "string" && (FOLDX_PLATFORMS as readonly string[]).includes(value);
}

export const PLATFORM_LABEL: Record<FoldxPlatform, string> = { win32: "Windows", linux: "Linux", darwin: "macOS" };

/** A FoldX download is tens of megabytes; these bounds leave room and stop a zip bomb. */
export const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 5000;

type BinaryKind = FoldxPlatform | "unknown";

/** What kind of program these bytes start: Windows PE, Linux ELF, macOS Mach-O. */
export function executableKind(head: Uint8Array): BinaryKind {
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return "win32"; // "MZ"
  if (head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return "linux"; // ELF
  if (head.length >= 4) {
    const magic = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return "darwin";
  }
  return "unknown";
}

const NOT_PROGRAM = /\.(txt|zip|json|md|pdf|html?|cmd|bat|ps1|sh|py|pdb|cfg|ini|log|dat)$/i;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._\-+]{0,120}$/;

export interface FoldxArchivePlan {
  /** Base name the program is installed under (from the archive, checked against SAFE_NAME). */
  binaryName: string;
  binaryEntry: string;
  rotabaseEntry: string;
  /** `molecules/<file>` entries, keyed by the base name they are installed under. */
  moleculeEntries: Map<string, string>;
  /** YYYY-MM-DD from the program's name, when it carries one (academic builds do). */
  expiry: string | null;
}

export type FoldxArchiveCheck = { ok: true; plan: FoldxArchivePlan; zip: JSZip } | { ok: false; problem: string };

const COMPLETE_ZIP = "Use the complete zip you downloaded from foldxsuite.crg.eu, without unpacking or changing it.";

/**
 * Check a zip for `platform`. Reader-facing problems, one sentence each, in the order a person can act on.
 * `now` decides whether the build's own date has passed.
 */
export async function checkFoldxArchive(bytes: Uint8Array, platform: FoldxPlatform, now = Date.now()): Promise<FoldxArchiveCheck> {
  if (bytes.length > MAX_ARCHIVE_BYTES) return { ok: false, problem: `This file is larger than ${Math.round(MAX_ARCHIVE_BYTES / 1048576)} MB, which no FoldX download is.` };
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { ok: false, problem: "This file is not a zip archive. Choose the FoldX .zip file itself." };

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  } catch {
    return { ok: false, problem: "This zip archive is damaged and cannot be opened. Download it again." };
  }

  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > MAX_ENTRIES) return { ok: false, problem: "This zip holds far more files than a FoldX download. " + COMPLETE_ZIP };
  let unpacked = 0;
  for (const f of files) unpacked += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  if (unpacked > MAX_UNPACKED_BYTES) return { ok: false, problem: "This zip unpacks to more than 1 GB, which no FoldX download does." };

  // Every candidate program, recognised by its header rather than its name.
  const found: { entry: string; name: string; kind: BinaryKind }[] = [];
  for (const f of files) {
    const name = path.posix.basename(f.name.replace(/\\/g, "/"));
    if (!/^foldx/i.test(name) || NOT_PROGRAM.test(name) || name.startsWith("._")) continue;
    const head = await readHead(f);
    found.push({ entry: f.name, name, kind: executableKind(head) });
  }
  const programs = found.filter((c) => c.kind !== "unknown");
  if (programs.length === 0) {
    return { ok: false, problem: "This zip does not contain the FoldX program. Choose the FoldX zip you downloaded from foldxsuite.crg.eu." };
  }
  const match = programs.find((c) => c.kind === platform);
  if (!match) {
    const other = programs[0].kind as FoldxPlatform;
    return { ok: false, problem: `This looks like the ${PLATFORM_LABEL[other]} build of FoldX; this computer needs the ${PLATFORM_LABEL[platform]} one.` };
  }
  if (!SAFE_NAME.test(match.name)) return { ok: false, problem: "The FoldX program in this zip has an unusual file name. " + COMPLETE_ZIP };

  const moleculeEntries = new Map<string, string>();
  let rotabaseEntry: string | null = null;
  for (const f of files) {
    const parts = f.name.replace(/\\/g, "/").split("/").filter(Boolean);
    const base = parts[parts.length - 1] ?? "";
    if (base.toLowerCase() === "rotabase.txt" && !rotabaseEntry) rotabaseEntry = f.name;
    const mi = parts.findIndex((p) => p.toLowerCase() === "molecules");
    if (mi >= 0 && mi === parts.length - 2 && SAFE_NAME.test(base)) moleculeEntries.set(base, f.name);
  }
  if (moleculeEntries.size === 0) return { ok: false, problem: "The FoldX parameter files are missing (the molecules folder). " + COMPLETE_ZIP };
  if (!rotabaseEntry) return { ok: false, problem: "The FoldX file rotabase.txt is missing. " + COMPLETE_ZIP };

  const expiry = foldxBuildExpiry(match.name);
  if (expiry && foldxBuildExpired(expiry, now)) {
    return { ok: false, problem: `This FoldX build stopped working on ${expiry}. Download the current build from foldxsuite.crg.eu.` };
  }
  return { ok: true, zip, plan: { binaryName: match.name, binaryEntry: match.entry, rotabaseEntry, moleculeEntries, expiry } };
}

async function readHead(file: JSZip.JSZipObject): Promise<Uint8Array> {
  // The whole entry is decompressed to read four bytes; programs are a few tens of MB, so this is fine.
  const data = await file.async("uint8array");
  return data.subarray(0, 4);
}

/**
 * Write a checked archive into `destDir` (replacing what is there) as the flat layout FoldX's runner
 * reads: `<program>`, `rotabase.txt`, `molecules/*`. Atomic from the reader's side: the new folder is
 * written beside the old one and swapped in by rename. Returns the program's full path.
 */
export async function installFoldxArchive(check: Extract<FoldxArchiveCheck, { ok: true }>, destDir: string): Promise<string> {
  const { zip, plan } = check;
  const staging = `${destDir}.installing-${crypto.randomBytes(4).toString("hex")}`;
  await fs.promises.rm(staging, { recursive: true, force: true });
  await fs.promises.mkdir(path.join(staging, "molecules"), { recursive: true });
  try {
    const binaryPath = path.join(staging, plan.binaryName);
    await fs.promises.writeFile(binaryPath, await zip.file(plan.binaryEntry)!.async("nodebuffer"));
    if (process.platform !== "win32") await fs.promises.chmod(binaryPath, 0o755);
    await fs.promises.writeFile(path.join(staging, "rotabase.txt"), await zip.file(plan.rotabaseEntry)!.async("nodebuffer"));
    for (const [name, entry] of plan.moleculeEntries) {
      await fs.promises.writeFile(path.join(staging, "molecules", name), await zip.file(entry)!.async("nodebuffer"));
    }
    const old = `${destDir}.old-${crypto.randomBytes(4).toString("hex")}`;
    const hadOld = fs.existsSync(destDir);
    if (hadOld) await fs.promises.rename(destDir, old);
    await fs.promises.rename(staging, destDir);
    if (hadOld) await fs.promises.rm(old, { recursive: true, force: true });
    return path.join(destDir, plan.binaryName);
  } catch (err) {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}
