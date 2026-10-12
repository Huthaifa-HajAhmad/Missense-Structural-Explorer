/**
 * main.ts — the agent: a person's own computer, lent to that person's own FoldX and P2Rank jobs
 * (plan WP-F2; the person's guide is doc/AGENT.md).
 *
 *   Double-click (the bundle's "Start Agent"): starts, sets up its tools, and opens its page in the browser.
 *   npm run agent                         the same, from the repository (developers)
 *   npm run agent -- --pair ABC-DEF --server https://… [--name "Lab PC"]   pair without the page
 *   npm run agent -- --headless           no page, no browser (unattended hosts; use AGENT_SERVER_URL + AGENT_TOKEN)
 *   npm run agent -- --no-browser         the page, but do not open a browser
 *
 * Environment: AGENT_SERVER_URL, AGENT_TOKEN (unattended), AGENT_MAX_RAM_GB (a memory cap the computer
 * reports), AGENT_PAUSE=1 (lend nothing), AGENT_FOLDX_SOURCE=team|guided, AGENT_HOME (its folder).
 */
import { spawn } from "child_process";
import { enterAgentHome } from "./state.ts";
import { AgentWorker } from "./worker.ts";
import { startSetupPage } from "./setup-page.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function openBrowser(url: string): void {
  // The URL is ours (127.0.0.1, a port, a base64url token): no shell parsing is involved on any platform.
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    // A missing opener (no xdg-open on a minimal Linux) arrives as an 'error' EVENT, not a throw; without
    // a listener it would end the agent. The address is printed, so this is not fatal.
    child.on("error", () => {});
    child.unref();
  } catch {
    /* no browser: the address is printed */
  }
}

async function main(): Promise<void> {
  // A background check that fails must be logged, not end the agent (Node's default for an unhandled rejection).
  process.on("unhandledRejection", (err: any) => console.error("[agent] Background task failed:", err?.message ?? err));
  enterAgentHome();
  const worker = new AgentWorker();
  worker.log(`Missense & Fold agent starting (${process.platform} ${process.arch}).`);

  const code = arg("pair");
  if (code) {
    const server = arg("server") ?? worker.state.serverUrl ?? process.env.AGENT_SERVER_URL;
    if (!server) {
      console.error("Give the workspace address with --server https://…");
      process.exit(2);
    }
    const problem = await worker.pair(server, code, arg("name") ?? worker.state.name);
    if (problem) {
      console.error(problem);
      process.exit(1);
    }
  }

  let close: (() => Promise<void>) | null = null;
  if (!flag("headless")) {
    const pageInfo = await startSetupPage(worker);
    close = pageInfo.close;
    console.log(`\nThis computer's page: ${pageInfo.url}\nKeep this window open while you lend the computer. Close it to stop.\n`);
    if (!flag("no-browser")) openBrowser(pageInfo.url);
  }

  const shutdown = async () => {
    worker.log("Stopping. A job in progress goes back to the shared server.");
    worker.stop();
    await close?.();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await worker.tools.refresh();
  void worker.tools.ensureP2Rank((l) => worker.log(l)).catch((err) => worker.log(`P2Rank setup failed: ${err?.message ?? err}`));
  await worker.run();
}

main().catch((err) => {
  console.error("The agent stopped:", err?.message ?? err);
  process.exit(1);
});
