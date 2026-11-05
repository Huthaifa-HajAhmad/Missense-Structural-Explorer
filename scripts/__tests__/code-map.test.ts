import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildCodeMap, OUT_DIR, staleTables } from "../code-map.ts";

let root: string;

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

const lines = (text: string): string[] => text.trimEnd().split("\n");

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "code-map-"));
  write(
    "server/express-config.ts",
    `import { apiRouter } from "./routes.ts";
export async function createExpressApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(compression());
  app.use("/api/v1", apiRouter);
  if (dev) {
    app.use(vite.middlewares);
  } else {
    app.get("*", spaShell);
  }
  app.use(errorHandler);
  return app;
}
`,
  );
  write(
    "server/routes.ts",
    `import { registerAll } from "./routes/index.ts";
export const apiRouter = express.Router();
apiRouter.use(authCheck);
registerAll(apiRouter, parser);
apiRouter.use((req, res) => res.end());
`,
  );
  write(
    "server/routes/index.ts",
    `import { registerA } from "./a.ts";
import { registerB } from "./b.ts";
import { docsRouter } from "./docs.ts";
export function registerAll(apiRouter, parser) {
  registerA(apiRouter);
  apiRouter.use(docsRouter);
  registerB(apiRouter, parser);
}
`,
  );
  write(
    "server/routes/a.ts",
    `const SUFFIXES = ["one", "two"] as const;
export function registerA(r) {
  r.get("/a", handleA);
  r.get(["/x", "/y"], limiter, async (req, res) => {});
  r.get(\`/t/\${suffix}\`, handleT);
  r.get("/admin/early", handleEarly);
  for (const suffix of SUFFIXES) {
    const guards = suffix === "two" ? [limiterTwo] : [];
    r.get(\`/loop/\${suffix}\`, ...guards, handleLoop);
  }
  for (const s of unknownList()) r.get(\`/dyn/\${s}\`, handleDyn);
  const cache = new Map();
  cache.get("/not-a-route");
}
`,
  );
  write("server/routes/docs.ts", `export const docsRouter = express.Router();\ndocsRouter.get("/docs", serveDocs);\n`);
  write(
    "server/routes/b.ts",
    `export function registerB(apiRouter, parser) {
  apiRouter.use("/admin", requireAdmin);
  apiRouter.post("/admin/users", parser, createUser);
}
`,
  );
  write("server/routes/a.test.ts", `import { registerA } from "./a.ts";\nimport type { x } from "./b.ts";\n`);
  write(
    "server/services/client.ts",
    `const u = "https://rest.example-api.org/v1"; const k = process.env.CLIENT_KEY; const d = "http://localhost:1";
const sql = \`CREATE TABLE IF NOT EXISTS users (id TEXT)\`; db.exec("create virtual table notes using fts5(a)");
`,
  );
  write("src/shared/types.ts", `import type { A } from "./other.ts";\nexport type B = A;\nexport interface C { x: B }\n`);
  write("src/index.ts", `export * from "./shared/types.ts";\nexport { client } from "./client.ts";\n`);
  write("src/client.ts", `export const client = import.meta.env.VITE_CLIENT_KEY;\n`);
  write("src/components/Panel.tsx", `export function Panel() { return null; }\n`);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const GLOBAL = "compression();authCheck";

describe("code map on a small tree", () => {
  it("lists every route with its full path and every guard that was registered before it", () => {
    const map = buildCodeMap(root);
    expect(map.problems).toEqual([]);
    expect(lines(map.files["routes.csv"])).toEqual([
      "method,path,middleware,handler,file,conditional",
      `GET,*,compression();vite.middlewares?,spaShell,server/express-config.ts,yes`,
      `GET,/api/v1/a,${GLOBAL},handleA,server/routes/a.ts,`,
      `GET,/api/v1/admin/early,${GLOBAL},handleEarly,server/routes/a.ts,`,
      `GET,/api/v1/docs,${GLOBAL},serveDocs,server/routes/docs.ts,`,
      `GET,/api/v1/dyn/{s},${GLOBAL},handleDyn,server/routes/a.ts,yes`,
      `GET,/api/v1/loop/one,${GLOBAL},handleLoop,server/routes/a.ts,`,
      `GET,/api/v1/loop/two,${GLOBAL};limiterTwo,handleLoop,server/routes/a.ts,`,
      `GET,/api/v1/t/{suffix},${GLOBAL},handleT,server/routes/a.ts,`,
      `GET,/api/v1/x,${GLOBAL};limiter,inline,server/routes/a.ts,`,
      `GET,/api/v1/y,${GLOBAL};limiter,inline,server/routes/a.ts,`,
      `POST,/api/v1/admin/users,${GLOBAL};requireAdmin;parser,createUser,server/routes/b.ts,`,
    ]);
  });

  it("applies a path-scoped guard only to routes registered after it", () => {
    const rows = lines(buildCodeMap(root).files["routes.csv"]);
    expect(rows.find((r) => r.startsWith("GET,/api/v1/admin/early"))).not.toContain("requireAdmin");
    expect(rows.find((r) => r.startsWith("POST,/api/v1/admin/users"))).toContain("requireAdmin");
  });

  it("lists app, API and path-scoped guards in the order they were added, marking the conditional one", () => {
    expect(lines(buildCodeMap(root).files["middleware.csv"])).toEqual([
      "order,scope,middleware,file,conditional",
      "001,*,compression(),server/express-config.ts,",
      "002,/api/v1,authCheck,server/routes.ts,",
      "003,/api/v1/admin,requireAdmin,server/routes/b.ts,",
      "004,/api/v1,inline,server/routes.ts,",
      "005,*,vite.middlewares,server/express-config.ts,yes",
      "006,*,errorHandler,server/express-config.ts,",
    ]);
  });

  it("maps each module to the tests that import it, with its kind, ignoring type-only imports", () => {
    const { files } = buildCodeMap(root);
    const server = lines(files["test-map-server.csv"]);
    expect(server).toContain("server/routes/a.ts,server,server/routes/a.test.ts");
    expect(server).toContain("server/routes/b.ts,server,");
    expect(lines(files["test-map-src.csv"])).toEqual([
      "source,kind,direct_tests",
      "src/client.ts,client,",
      "src/components/Panel.tsx,component,",
      "src/index.ts,barrel,",
      "src/shared/types.ts,types,",
    ]);
  });

  it("lists outside hosts, environment variables (server and client) and created tables, skipping localhost", () => {
    const { files } = buildCodeMap(root);
    expect(lines(files["external-apis.csv"])).toEqual(["host,file", "rest.example-api.org,server/services/client.ts"]);
    expect(lines(files["env-keys.csv"])).toEqual(["key,file", "CLIENT_KEY,server/services/client.ts", "VITE_CLIENT_KEY,src/client.ts"]);
    expect(lines(files["db-tables.csv"])).toEqual(["table,file", "notes,server/services/client.ts", "users,server/services/client.ts"]);
  });

  it("reports a stale, missing or no-longer-produced table by name", () => {
    const map = buildCodeMap(root);
    expect(staleTables(root, map)).toHaveLength(Object.keys(map.files).length);
    for (const [name, text] of Object.entries(map.files)) write(`${OUT_DIR}/${name}`, text);
    expect(staleTables(root, map)).toEqual([]);
    write(`${OUT_DIR}/routes.csv`, "old\n");
    write(`${OUT_DIR}/test-map.csv`, "left over from an older version\n");
    expect(staleTables(root, map)).toEqual(["routes.csv", "test-map.csv"]);
  });
});

describe("code map in a git repository", () => {
  it("maps the files git tracks, not stray local files, and picks up a new file once it is staged", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "code-map-git-"));
    const git = (...args: string[]): void => void execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    const put = (file: string): void => {
      fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      fs.writeFileSync(path.join(repo, file), "export const x = 1;\n");
    };
    git("init", "-q");
    fs.mkdirSync(path.join(repo, "server"));
    fs.writeFileSync(path.join(repo, "server/express-config.ts"), "export function createExpressApp() { const app = express(); }\n");
    put("server/kept.ts");
    git("add", "server/kept.ts");
    put("server/stray.ts");
    const sources = (): string[] => lines(buildCodeMap(repo).files["test-map-server.csv"]).slice(1).map((r) => r.split(",")[0]);
    git("add", "server/express-config.ts");
    expect(sources()).toEqual(["server/express-config.ts", "server/kept.ts"]);
    git("add", "server/stray.ts");
    expect(sources()).toEqual(["server/express-config.ts", "server/kept.ts", "server/stray.ts"]);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});

describe("code map failures are loud", () => {
  const problemsFor = (registerA: string): string[] => {
    write("server/routes/a.ts", registerA);
    return buildCodeMap(root).problems;
  };

  it("reports a route whose path is not text, and a router handed to code it cannot follow", () => {
    const problems = problemsFor(`export function registerA(r) {\n  r.get(somePath, h);\n  vanish(r);\n}\n`);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("path that is not a plain string");
    expect(problems[1]).toContain("vanish(r, ...)");
  });

  it("reports router shapes it does not follow: .route(), a router given to a method, a router built by a function", () => {
    write("server/routes/factory.ts", `export function makeRouter() { return express.Router(); }\n`);
    const problems = problemsFor(
      `import { makeRouter } from "./factory.ts";\nexport function registerA(r) {\n  r.route("/x").get(h);\n  helpers.mount(r);\n  r.use(makeRouter());\n}\n`,
    );
    expect(problems).toEqual([
      expect.stringContaining("r.route(...) is a router call the map does not follow"),
      expect.stringContaining("the router is passed to a method call"),
      expect.stringContaining("r.use(makeRouter()) mounts a router built by a function"),
    ]);
  });

  it("reports a missing app function instead of printing an empty route table", () => {
    write("server/express-config.ts", `export {};\n`);
    expect(buildCodeMap(root).problems[0]).toContain("function createExpressApp not found");
  });
});

describe("code map on this repository", () => {
  afterEach(() => vi.unstubAllEnvs());

  type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> }; name: string; handle: { stack?: Layer[] }; regexp: { source: string; fast_slash?: boolean } };
  /** `METHOD path` for every route on a layer. A route on every HTTP method (`app.all`) is `ALL`. */
  const routeKeys = (layer: Layer, prefix = ""): string[] => {
    const methods = Object.keys(layer.route!.methods).length > 20 ? ["ALL"] : Object.keys(layer.route!.methods).map((m) => m.toUpperCase());
    return [layer.route!.path].flat().flatMap((p) => methods.map((m) => `${m} ${prefix}${p}`));
  };
  const listed = (routes: string): string[][] => lines(routes).slice(1).map((row) => row.split(","));

  it("has no problems, and lists exactly the API routes the real Express router registers", async () => {
    const map = buildCodeMap();
    expect(map.problems).toEqual([]);

    const { apiRouter } = await import("../../server/routes.ts");
    const runtime: string[] = [];
    const visit = (stack: Layer[]): void => {
      for (const layer of stack) {
        if (layer.route) runtime.push(...routeKeys(layer, "/api/v1"));
        else if (layer.name === "router") {
          // A sub-router mounted without a path. A mount with a path would need its prefix added here.
          expect(layer.regexp.fast_slash).toBe(true);
          visit(layer.handle.stack ?? []);
        }
      }
    };
    visit((apiRouter as unknown as { stack: Layer[] }).stack);

    const table = listed(map.files["routes.csv"]).filter(([, p]) => p.startsWith("/api/v1/")).map(([m, p]) => `${m} ${p}`);
    expect(table.sort()).toEqual(runtime.sort());
  }, 60_000);

  it("lists the app's own guards and routes in the order the real production app registers them", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_API_TOKEN", "k9Zq3vX8mLw2Rt7YpN4sB6hJcD1fGa0E");
    vi.stubEnv("APP_SESSION_SECRET", "Qw8rT5yU2iO9pA3sD6fG1hJ4kL7zX0cV");
    vi.resetModules();
    const { createExpressApp } = await import("../../server/express-config.ts");
    const app = await createExpressApp();
    const stack = (app as unknown as { _router: { stack: Layer[] } })._router.stack.filter((l) => !["query", "expressInit", "router"].includes(l.name));

    const map = buildCodeMap();
    const appRoutes = listed(map.files["routes.csv"]).filter(([, p]) => !p.startsWith("/api/v1/"));
    expect(stack.filter((l) => l.route).flatMap((l) => routeKeys(l)).sort()).toEqual(appRoutes.map(([m, p]) => `${m} ${p}`).sort());

    // Every guard row either is the next guard the app really has, or is marked conditional (it is
    // registered only in development, or only in production, and this run is production).
    const scopeOf = (l: Layer): string => (l.regexp.fast_slash ? "*" : l.regexp.source.replace(/^\^/, "").replace(/\\\/\?\(\?=.*$/, "").replace(/\\\//g, "/"));
    const real = stack.filter((l) => !l.route);
    let next = 0;
    for (const [, scope, name, , conditional] of listed(map.files["middleware.csv"]).filter(([, s]) => !s.startsWith("/api/v1"))) {
      const layer = real[next];
      const plain = /^\w+$/.test(name) && name !== "inline";
      if (layer && scopeOf(layer) === scope && (!plain || layer.name === name)) next++;
      else expect(conditional, `${name} (${scope}) is not the app's next guard, so it must be conditional`).toBe("yes");
    }
    expect(next, "guards the app has that the table does not list").toBe(real.length);
  }, 60_000);
});
