/**
 * setup-page.ts — the agent's own small web page, for people who never open a terminal (decision 7).
 *
 * The agent opens it in the default browser at start. Three steps: connect to the workspace (type the
 * six-character code from "Connect my computer" in the app), tools (set up by themselves; FoldX can be
 * dropped in as a zip when the workspace has not shared it), ready (Pause / Disconnect).
 *
 * It is a server on this computer, so it is locked down:
 *   - it listens on 127.0.0.1 only, and refuses any connection that is not from this machine;
 *   - every request must name it by its own address (`Host: 127.0.0.1:<port>`): a web page elsewhere that
 *     points a DNS name at 127.0.0.1 (DNS rebinding) is refused;
 *   - the page needs the one-time token in its URL, and every action needs that token in a header, which a
 *     page on another site can neither read nor send, so no other site can pair, pause or upload.
 */
import http from "http";
import crypto from "crypto";
import type { AddressInfo } from "net";
import type { AgentWorker } from "./worker.ts";
import { MAX_ARCHIVE_BYTES } from "../services/infra/foldx-archive.ts";

export interface SetupPage {
  url: string;
  port: number;
  close(): Promise<void>;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const text = type === "application/json" ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    "content-type": `${type}; charset=utf-8`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(text);
}

async function readBody(req: http.IncomingMessage, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Exposed for tests: the request gate, before any route. */
export function gate(req: http.IncomingMessage, port: number, token: string): "ok" | "forbidden" {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return "forbidden";
  const host = (req.headers.host ?? "").toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return "forbidden";
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const presented = url.pathname === "/" ? url.searchParams.get("t") : (req.headers["x-setup-token"] as string | undefined);
  if (!presented || presented.length !== token.length || !crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(token))) return "forbidden";
  return "ok";
}

export async function startSetupPage(worker: AgentWorker, port = Number(process.env.AGENT_PAGE_PORT) || 0): Promise<SetupPage> {
  const token = crypto.randomBytes(24).toString("base64url");
  let boundPort = 0;
  const server = http.createServer(async (req, res) => {
    try {
      if (gate(req, boundPort, token) !== "ok") return send(res, 403, "This page only opens from the link the agent gave you.", "text/plain");
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${boundPort}`);
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, page(token), "text/html");
      if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, worker.view());
      if (req.method !== "POST") return send(res, 404, { error: "Not found." });

      if (url.pathname === "/api/foldx") {
        const body = await readBody(req, MAX_ARCHIVE_BYTES);
        if (!body) return send(res, 413, { error: "That file is larger than any FoldX download." });
        const problem = await worker.tools.installGuidedFoldx(new Uint8Array(body), (l) => worker.log(l));
        return send(res, problem ? 422 : 200, problem ? { error: problem } : { ok: true });
      }
      const raw = await readBody(req, 64 * 1024);
      let json: any = {};
      try { json = raw && raw.length ? JSON.parse(raw.toString("utf8")) : {}; } catch { return send(res, 400, { error: "Bad request." }); }
      switch (url.pathname) {
        case "/api/pair": {
          const problem = await worker.pair(String(json.serverUrl ?? ""), String(json.code ?? ""), String(json.name ?? ""));
          return send(res, problem ? 422 : 200, problem ? { error: problem } : { ok: true });
        }
        case "/api/pause":
          worker.setPaused(Boolean(json.paused));
          return send(res, 200, { ok: true });
        case "/api/disconnect":
          await worker.disconnect();
          return send(res, 200, { ok: true });
        case "/api/retry-tools":
          void worker.tools.ensureP2Rank((l) => worker.log(l)).then(() => worker.tools.refresh());
          return send(res, 200, { ok: true });
        default:
          return send(res, 404, { error: "Not found." });
      }
    } catch (err: any) {
      worker.log(`Setup page error: ${err?.message ?? err}`);
      if (!res.headersSent) send(res, 500, { error: "Something went wrong on this page. Close it and start the agent again." });
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  boundPort = (server.address() as AddressInfo).port;
  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/?t=${token}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function page(token: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Missense &amp; Fold — this computer</title>
<style>
  :root { color-scheme: light dark; --fg:#1d232b; --muted:#5b6673; --line:#d9dee4; --bg:#f7f8fa; --card:#fff; --ok:#1f7a4d; --warn:#9a5b00; --bad:#b42318; --accent:#2457c5; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e7eaee; --muted:#9aa5b1; --line:#323a44; --bg:#14181d; --card:#1b2027; --accent:#7aa2f7; } }
  * { box-sizing: border-box; }
  body { margin:0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--fg); background:var(--bg); }
  main { max-width: 640px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 0 0 8px; }
  p { margin: 0 0 10px; } .muted { color: var(--muted); }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin: 16px 0; }
  label { display:block; font-weight:600; margin: 10px 0 4px; }
  input { width:100%; padding: 9px 10px; font: inherit; border:1px solid var(--line); border-radius:6px; background:transparent; color:inherit; }
  input.code { font-size: 22px; letter-spacing: 4px; text-transform: uppercase; max-width: 200px; }
  button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; margin-right: 8px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .row { display:flex; justify-content:space-between; gap:12px; padding: 6px 0; border-top: 1px solid var(--line); } .row:first-of-type { border-top: 0; }
  .ready { color: var(--ok); } .attention { color: var(--warn); } .failed { color: var(--bad); }
  #drop { border: 2px dashed var(--line); border-radius: 8px; padding: 18px; text-align: center; margin-top: 10px; }
  #drop.over { border-color: var(--accent); }
  .err { color: var(--bad); } pre { white-space: pre-wrap; font-size: 12px; color: var(--muted); max-height: 180px; overflow:auto; }
  [hidden] { display: none !important; }
</style></head>
<body><main>
  <h1>Lend this computer to your jobs</h1>
  <p class="muted">Your FoldX and pocket jobs can run here instead of on the shared server — usually much faster. Only your own jobs run here.</p>
  <div id="status" role="status" aria-live="polite"></div>

  <section id="connect" hidden>
    <h2>1. Connect to your workspace</h2>
    <p>In Missense &amp; Fold, open <b>Settings → Account</b> and press <b>Connect my computer</b>. Type the code it shows here.</p>
    <form id="pairForm">
      <label for="server">Workspace address</label>
      <input id="server" required value="https://missense-resolve.duckdns.org" autocomplete="url">
      <label for="code">Code</label>
      <input id="code" class="code" required maxlength="7" autocomplete="one-time-code" placeholder="ABC-DEF">
      <label for="name">Name for this computer</label>
      <input id="name" maxlength="60">
      <p style="margin-top:14px"><button class="primary" type="submit">Connect</button></p>
      <p id="pairError" class="err" role="alert"></p>
    </form>
  </section>

  <section id="tools" hidden>
    <h2>2. Tools</h2>
    <div id="toolRows"></div>
    <div id="foldxDrop" hidden>
      <p id="foldxWhy"></p>
      <div id="drop">Drop the FoldX zip you downloaded here, or <button type="button" id="choose">Choose file</button>
        <input type="file" id="file" accept=".zip,application/zip" hidden></div>
      <p id="dropError" class="err" role="alert"></p>
    </div>
    <p id="teamNote" class="muted" hidden>FoldX is provided by your lab for research use only.</p>
  </section>

  <section id="ready" hidden>
    <h2>3. Ready</h2>
    <p id="readyText"></p>
    <p><button id="pause" type="button"></button><button id="disconnect" type="button">Disconnect</button></p>
  </section>

  <details><summary class="muted">Activity</summary><pre id="log"></pre></details>
</main>
<script>
const T = ${JSON.stringify(token)};
const $ = (id) => document.getElementById(id);
async function api(path, body, raw) {
  const opts = { method: body === undefined && !raw ? "GET" : "POST", headers: { "x-setup-token": T } };
  if (raw) { opts.body = raw; opts.headers["content-type"] = "application/zip"; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["content-type"] = "application/json"; }
  const r = await fetch(path, opts); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}
const STATE = { ready: "Ready", installing: "Setting up", missing: "Not set up", failed: "Not working" };
function render(s) {
  const paired = !["unpaired", "revoked"].includes(s.connection);
  $("connect").hidden = paired; $("tools").hidden = !paired; $("ready").hidden = !paired;
  const words = { connecting: "Connecting…", connected: "Connected" + (s.ownerName ? " for " + s.ownerName : "") + ".", offline: s.lastError || "Offline.", revoked: s.lastError, outdated: s.lastError, unpaired: "Not connected yet." };
  $("status").textContent = words[s.connection] || "";
  if ($("name").value === "") $("name").value = s.name;
  const t = s.tools, rows = [["FoldX", t.foldx], ["Pocket detection (P2Rank)", t.p2rank]];
  $("toolRows").innerHTML = "";
  for (const [label, r] of rows) {
    const div = document.createElement("div"); div.className = "row";
    const cls = r.state === "ready" ? "ready" : r.state === "failed" ? "failed" : "attention";
    const left = document.createElement("span"); left.textContent = label;
    const right = document.createElement("span"); right.className = cls;
    right.textContent = STATE[r.state] + (r.version ? " · " + r.version : "") + (r.detail ? " — " + r.detail : "");
    div.append(left, right); $("toolRows").append(div);
  }
  const needFoldx = t.foldx.state === "missing" || t.foldx.state === "failed";
  $("foldxDrop").hidden = !needFoldx;
  $("foldxWhy").textContent = needFoldx ? (t.foldx.detail || "") : "";
  $("teamNote").hidden = s.foldxSource !== "team";
  const runs = [t.foldx.state === "ready" ? "FoldX" : null, t.p2rank.state === "ready" ? "pocket" : null].filter(Boolean);
  $("readyText").textContent = s.paused ? "Paused: your jobs run on the shared server until you resume."
    : s.job ? "Working on one of your " + (s.job.type === "foldx" ? "FoldX" : "pocket") + " jobs" + (s.job.phase ? " (" + s.job.phase + ")" : "") + "."
    : runs.length ? "Ready: lending this computer to your own " + runs.join(" and ") + " jobs. You can close this page; the agent keeps running." : "Waiting for the tools above.";
  $("pause").textContent = s.paused ? "Resume" : "Pause";
  $("pause").dataset.paused = s.paused ? "1" : "";
  $("log").textContent = s.log.join("\\n");
}
async function tick() { try { render(await api("/api/state")); } catch (e) { $("status").textContent = "The agent has stopped. Start it again to continue."; } }
$("pairForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("pairError").textContent = "";
  try { await api("/api/pair", { serverUrl: $("server").value, code: $("code").value, name: $("name").value }); tick(); }
  catch (err) { $("pairError").textContent = err.message; }
});
$("pause").addEventListener("click", async () => { await api("/api/pause", { paused: !$("pause").dataset.paused }); tick(); });
$("disconnect").addEventListener("click", async () => { if (confirm("Disconnect this computer from your workspace?")) { await api("/api/disconnect", {}); tick(); } });
async function upload(file) {
  $("dropError").textContent = "Checking the zip…";
  try { await api("/api/foldx", undefined, file); $("dropError").textContent = ""; tick(); }
  catch (err) { $("dropError").textContent = err.message; }
}
$("choose").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => { if ($("file").files[0]) upload($("file").files[0]); });
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
tick(); setInterval(tick, 2000);
</script></body></html>`;
}
