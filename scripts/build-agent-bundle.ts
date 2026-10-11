/**
 * build-agent-bundle.ts — the double-click zip a team member downloads (plan WP-F2, decision 7).
 *
 *   npm run build:agent-bundle                       this machine's platform
 *   npm run build:agent-bundle -- --platform win32-x64   (also linux-x64, linux-arm64, darwin-x64, darwin-arm64)
 *
 * Inside the zip, one folder:
 *   node/            a portable Node.js runtime (open source, redistributable; pinned version and SHA-256)
 *   agent.cjs        the agent, bundled by `npm run build:agent` (the same code the server runs)
 *   Start Agent.cmd / start-agent.command / start-agent.sh   the one file a person double-clicks
 *   README.txt       three steps in plain words
 *
 * Nothing is installed system-wide. Output: dist/agent-bundle/MissenseAgent-<platform>.zip
 */
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import JSZip from "jszip";

const NODE_VERSION = "v22.23.3";
/** From https://nodejs.org/dist/v22.23.3/SHASUMS256.txt. Bump with NODE_VERSION. */
const NODE_BUILDS: Record<string, { file: string; sha256: string; exe: string }> = {
  "win32-x64": { file: `node-${NODE_VERSION}-win-x64.zip`, sha256: "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71", exe: "node.exe" },
  "linux-x64": { file: `node-${NODE_VERSION}-linux-x64.tar.gz`, sha256: "1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af", exe: "bin/node" },
  "linux-arm64": { file: `node-${NODE_VERSION}-linux-arm64.tar.gz`, sha256: "5ced2d48d1d7198739b7f86804de0171aefb6823b684b12341d3321afc3cb0b2", exe: "bin/node" },
  "darwin-x64": { file: `node-${NODE_VERSION}-darwin-x64.tar.gz`, sha256: "8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8", exe: "bin/node" },
  "darwin-arm64": { file: `node-${NODE_VERSION}-darwin-arm64.tar.gz`, sha256: "23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53", exe: "bin/node" },
};

const README = `Missense & Fold — lend this computer to your own jobs
=====================================================

Your FoldX and pocket-detection jobs can run on this computer instead of the
shared server, usually much faster. Only your own jobs ever run here.

1. Unzip this folder anywhere (for example, your Documents folder).
2. Double-click "Start Agent" (Windows), "start-agent.command" (macOS) or
   "start-agent.sh" (Linux). A page opens in your browser.
3. In Missense & Fold, open Settings -> Account and press "Connect my computer".
   Type the code it shows into the page. That's all.

The first start downloads Java and P2Rank (about 350 MB, once). If your lab
shares FoldX, it is set up automatically; otherwise the page asks you to drop
in the FoldX zip you downloaded from foldxsuite.crg.eu.

Keep the black window open while you lend the computer; close it to stop.
Pause and Disconnect are on the page. Everything the agent keeps is in one
folder: %LOCALAPPDATA%\\MissenseAgent (Windows) or ~/.missense-agent.

More help: doc/AGENT.md in the Missense & Fold repository, or ask your
workspace admin.
`;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<void> {
  const platform = arg("platform") ?? `${process.platform}-${process.arch}`;
  const build = NODE_BUILDS[platform];
  if (!build) throw new Error(`Unknown platform ${platform}. Use one of: ${Object.keys(NODE_BUILDS).join(", ")}`);
  const agent = path.join("dist", "agent", "agent.cjs");
  if (!fs.existsSync(agent)) throw new Error("dist/agent/agent.cjs is missing: run `npm run build:agent` first.");

  const cacheDir = path.join("dist", "agent-bundle", ".node-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const archive = path.join(cacheDir, build.file);
  if (!fs.existsSync(archive)) {
    console.log(`Downloading ${build.file}…`);
    const res = await fetch(`https://nodejs.org/dist/${NODE_VERSION}/${build.file}`);
    if (!res.ok) throw new Error(`Node download failed: HTTP ${res.status}`);
    fs.writeFileSync(archive, new Uint8Array(await res.arrayBuffer()));
  }
  const got = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  if (got !== build.sha256) {
    fs.rmSync(archive, { force: true });
    throw new Error(`${build.file} does not match its pinned SHA-256; it was deleted. Do not build from it.`);
  }

  // The node executable out of the official archive.
  let nodeBytes: Buffer;
  const inner = build.file.replace(/\.(zip|tar\.gz)$/, "");
  if (build.file.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(fs.readFileSync(archive));
    const entry = zip.file(`${inner}/${build.exe}`);
    if (!entry) throw new Error(`${build.exe} not found in ${build.file}`);
    nodeBytes = await entry.async("nodebuffer");
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-node-"));
    const r = spawnSync("tar", ["-xzf", archive, "-C", tmp, `${inner}/${build.exe}`], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("tar could not unpack the Node archive");
    nodeBytes = fs.readFileSync(path.join(tmp, inner, build.exe));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const isWin = platform.startsWith("win32");
  const folder = "MissenseAgent";
  const zip = new JSZip();
  const exec = { unixPermissions: 0o755 };
  zip.file(`${folder}/node/${isWin ? "node.exe" : "node"}`, nodeBytes, exec);
  zip.file(`${folder}/agent.cjs`, fs.readFileSync(agent));
  zip.file(`${folder}/README.txt`, isWin ? README.replace(/\n/g, "\r\n") : README);
  if (isWin) {
    zip.file(
      `${folder}/Start Agent.cmd`,
      ['@echo off', 'title Missense & Fold agent', '"%~dp0node\\node.exe" "%~dp0agent.cjs" %*', 'if errorlevel 1 pause', ''].join("\r\n"),
    );
  } else {
    const sh = ['#!/bin/sh', 'cd "$(dirname "$0")"', 'exec ./node/node ./agent.cjs "$@"', ''].join("\n");
    zip.file(`${folder}/${platform.startsWith("darwin") ? "start-agent.command" : "start-agent.sh"}`, sh, exec);
  }
  const out = path.join("dist", "agent-bundle", `MissenseAgent-${platform}.zip`);
  fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE", compressionOptions: { level: 9 } }));
  console.log(`Wrote ${out} (${Math.round(fs.statSync(out).size / 1048576)} MB).`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
