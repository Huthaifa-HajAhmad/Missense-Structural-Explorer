import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseSync, visitorKeys } from "oxc-parser";
import type { Argument, CallExpression, Expression, ForOfStatement, Function as FunctionNode, Node, Program } from "oxc-parser";

/**
 * The code map: small tables about this repository, written by a program instead of found by an agent.
 *
 * WHY THIS EXISTS
 * ---------------
 * An agent that must change code first rebuilds a picture of the repository by searching and reading
 * files: which route is served by which file, which test covers which module, which server file calls
 * which outside service. Those are facts the parser can state exactly, so they are computed here and
 * committed under `doc/code-map/`. The agent greps a table instead of re-deriving the answer, and a
 * person gets the same answer.
 *
 * HOW THE TABLES STAY TRUE
 * ------------------------
 * Every table is a pure function of the source tree: no dates, no commit ids, no line numbers (a line
 * number would change a row on every unrelated edit above it). A pull request regenerates the tables
 * with `npm run map`, and `npm run lint` runs `--check`, which fails when a committed table differs
 * from what the tree produces. So a table is never older than the branch that holds it. There is no
 * CI bot and no token with write access. The tables describe the files git tracks (stage a new file
 * with `git add` before `npm run map`), because those are the files CI sees.
 *
 * WHAT THE ROUTE TABLES COVER
 * ---------------------------
 * One walk starts in the function that builds the Express app and follows, in source order, every
 * `app.use`, `app.get` and so on, every `register*(app)` call it hands the app to, and the routers it
 * mounts (`app.use("/api/v1", apiRouter)`). Order matters in Express: a guard only covers the routes
 * registered after it, so each route lists exactly the guards that were registered before it.
 *
 * Anything the walk cannot follow is a PROBLEM and fails the run: a route whose path is not text, the
 * router handed to code the map cannot read, a router method it does not know (`.route()`), a function
 * that builds a router. A route is never silently left out. `scripts/__tests__/code-map.test.ts` also
 * compares the table with the real Express router.
 *
 * WHAT THE TABLES DO NOT CLAIM
 * ----------------------------
 *   - A route or guard inside an `if`, a conditional expression or a loop it cannot unroll is marked
 *     `conditional`. The map does not know which side runs.
 *   - test-map-*.csv lists DIRECT importers only. A module reached through a barrel file or a test
 *     helper shows no test here even if one exercises it. End-to-end tests (`tests/*.e2e.ts`) drive the
 *     running app and import no source module, so they are not mapped.
 *   - external-apis.csv sees hosts written as plain strings. A host built at run time from a variable
 *     does not appear; env-keys.csv is the clue for those (which file reads which setting).
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT_DIR = "doc/code-map";

const SOURCE_ROOTS = ["server", "src"];
const IGNORED_DIRS = new Set(["node_modules", "dist", "scratch", "temp_jobs", ".git"]);
const ROUTE_METHODS = new Set(["get", "post", "put", "delete", "patch", "all", "head", "options"]);
/** `app` methods that set up the app and register nothing the map should list. */
const NON_ROUTING_METHODS = new Set(["set", "disable", "enable", "listen", "engine"]);
/** Statements whose children may or may not run. */
const CONDITIONAL_NODES = new Set(["IfStatement", "ConditionalExpression", "LogicalExpression", "SwitchStatement", "ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement"]);
/** A table above this size is no longer a cheap lookup. The run fails so the growth is a decision. */
const MAX_TABLE_BYTES = 150_000;

/** The function that builds the Express app, and the name it gives the app inside. Overridable for tests. */
export interface AppEntry {
  file: string;
  function: string;
  app: string;
}
const DEFAULT_ENTRY: AppEntry = { file: "server/express-config.ts", function: "createExpressApp", app: "app" };

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function csv(header: string[], rows: string[][]): string {
  const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const sorted = rows.map((r) => r.map(cell).join(",")).sort(byCodeUnit);
  return [header.join(","), ...sorted].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Files and parsing
// ---------------------------------------------------------------------------

const isTestFile = (file: string): boolean => /\.(test|spec)\.tsx?$/.test(file);
const isTestSupport = (file: string): boolean => /(^|\/)(__tests__|tests)\//.test(file);

class Project {
  readonly files: string[];
  private readonly fileSet: Set<string>;
  private readonly programs = new Map<string, Program>();

  constructor(readonly root: string) {
    // The files git tracks, because those are the files CI sees. A scratch file or another person's
    // unfinished work in the same folder must not change the tables a pull request commits. A new
    // file appears once it is staged (`git add`). Without a git repository the folders are walked.
    const tracked = spawnSync("git", ["ls-files", "-z", "--", ...SOURCE_ROOTS], { cwd: root, encoding: "utf-8" });
    const found: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) visit(rel);
        else found.push(rel);
      }
    };
    if (tracked.status === 0) found.push(...tracked.stdout.split("\0").filter((f) => fs.existsSync(path.join(root, f))));
    else for (const sourceRoot of SOURCE_ROOTS) if (fs.existsSync(path.join(root, sourceRoot))) visit(sourceRoot);
    this.files = found.filter((f) => /\.tsx?$/.test(f)).sort(byCodeUnit);
    this.fileSet = new Set(this.files);
  }

  program(file: string): Program {
    const cached = this.programs.get(file);
    if (cached) return cached;
    const parsed = parseSync(file, fs.readFileSync(path.join(this.root, file), "utf-8"));
    if (parsed.errors.length > 0) throw new Error(`code-map: cannot parse ${file}: ${parsed.errors[0].message}`);
    this.programs.set(file, parsed.program);
    return parsed.program;
  }

  /** The repository file an import specifier points to, or null for a package or a non-source file. */
  resolve(fromFile: string, specifier: string): string | null {
    const base = specifier.startsWith("@/")
      ? specifier.slice(2)
      : specifier.startsWith(".")
        ? path.posix.join(path.posix.dirname(fromFile), specifier)
        : null;
    if (base === null) return null;
    return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => this.fileSet.has(c)) ?? null;
  }
}

/** Every child node, in source order. The parser's own list of child keys keeps this correct for TS syntax. */
function children(node: Node): Node[] {
  const out: Node[] = [];
  const record = node as unknown as Record<string, unknown>;
  for (const key of visitorKeys[node.type] ?? []) {
    const value = record[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item && typeof item === "object" && "type" in item) out.push(item as Node);
    }
  }
  return out;
}

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

function stringOf(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked ?? null;
  return null;
}

/** Where a name imported into `file` comes from: the repository file and the name it exports. */
function importedBinding(project: Project, file: string, local: string): { file: string; name: string } | null {
  for (const stmt of project.program(file).body) {
    if (stmt.type !== "ImportDeclaration") continue;
    for (const spec of stmt.specifiers) {
      if (spec.local.name !== local) continue;
      const from = project.resolve(file, stmt.source.value);
      if (!from) return null;
      const name = spec.type !== "ImportSpecifier" ? local : spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
      return { file: from, name };
    }
  }
  return null;
}

/** A top-level function by name, declared in the file itself or imported from another repository file. */
function findFunction(project: Project, file: string, name: string): { file: string; fn: FunctionNode } | null {
  const declared = (f: string, n: string): FunctionNode | null => {
    for (const stmt of project.program(f).body) {
      const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
      if (decl?.type === "FunctionDeclaration" && decl.id?.name === n) return decl;
    }
    return null;
  };
  const local = declared(file, name);
  if (local) return { file, fn: local };
  const target = importedBinding(project, file, name);
  const fn = target ? declared(target.file, target.name) : null;
  return target && fn ? { file: target.file, fn } : null;
}

// ---------------------------------------------------------------------------
// routes.csv and middleware.csv
// ---------------------------------------------------------------------------

interface UseEntry {
  scopes: string[];
  middleware: string;
  file: string;
  conditional: boolean;
}
interface RouteEntry {
  method: string;
  path: string;
  middleware: string[];
  handler: string;
  file: string;
  conditional: boolean;
  /** The `use` entries that were registered before this route and cover its path. */
  uses: UseEntry[];
}
interface RouteContext {
  project: Project;
  uses: UseEntry[];
  routes: RouteEntry[];
  problems: string[];
  visited: Set<string>;
}
/** What is known about the code around the node being scanned. */
interface ScanState {
  conditional: boolean;
  /** Loop variables with the value of the pass being scanned. */
  vars: Map<string, string>;
  /** `const` values declared in the loop body, so a guard list built there can be read. */
  consts: Map<string, Expression>;
}

function nameOf(arg: Argument): string {
  if (arg.type === "SpreadElement") return `...${nameOf(arg.argument)}`;
  if (arg.type === "Identifier") return arg.name;
  if (arg.type === "MemberExpression" && !arg.computed && arg.object.type === "Identifier") return `${arg.object.name}.${arg.property.name}`;
  if (arg.type === "CallExpression") {
    const callee = nameOf(arg.callee);
    return callee === "inline" ? callee : `${callee}()`;
  }
  return "inline";
}

/**
 * The path text of a route or `use` call. A template such as `/a/${name}` takes the loop value when
 * `name` is a loop variable that was unrolled, and otherwise stays the pattern `/a/{name}`.
 */
function pathsOf(arg: Argument | undefined, vars: Map<string, string>): string[] | null {
  if (arg?.type === "TemplateLiteral") {
    const parts = arg.quasis.map((q, i) => {
      const expr = arg.expressions[i];
      const inserted = expr ? (expr.type === "Identifier" ? (vars.get(expr.name) ?? `{${expr.name}}`) : "{expr}") : "";
      return (q.value.cooked ?? "") + inserted;
    });
    return [parts.join("")];
  }
  const one = stringOf(arg);
  if (one !== null) return [one];
  if (arg?.type !== "ArrayExpression") return null;
  const all = arg.elements.map((e) => stringOf(e ?? undefined));
  return all.every((p): p is string => p !== null) ? all : null;
}

const joinPath = (prefix: string, p: string): string => (prefix === "" ? p : prefix + (p.startsWith("/") ? p : `/${p}`));
const covers = (scope: string, full: string): boolean => scope === "" || full === scope || full.startsWith(scope.endsWith("/") ? scope : `${scope}/`);

/** The guard names an expression such as `suffix === "x" ? [limiter] : []` gives for this loop pass, or null if it cannot be read. */
function guardNames(expr: Expression, vars: Map<string, string>): string[] | null {
  if (expr.type === "ArrayExpression") return expr.elements.map((e) => (e ? nameOf(e) : "inline"));
  if (expr.type !== "ConditionalExpression" || expr.test.type !== "BinaryExpression" || !["===", "=="].includes(expr.test.operator)) return null;
  const { left, right } = expr.test;
  const variable = left.type === "Identifier" ? left : right.type === "Identifier" ? right : null;
  const expected = stringOf(left.type === "Identifier" ? right : left);
  const value = variable ? vars.get(variable.name) : undefined;
  if (value === undefined || expected === null) return null;
  return guardNames(value === expected ? expr.consequent : expr.alternate, vars);
}

/** Names of the middleware arguments, reading a spread such as `...guards` when its list is built from the loop value. */
function middlewareNames(args: Argument[], state: ScanState): string[] {
  return args.flatMap((arg) => {
    const list = arg.type === "SpreadElement" && arg.argument.type === "Identifier" ? state.consts.get(arg.argument.name) : undefined;
    return (list && guardNames(list, state.vars)) ?? [nameOf(arg)];
  });
}

/** The string list a name stands for, when it is a top-level `const NAME = ["a", "b"]` here or in an imported file. */
function stringArray(project: Project, file: string, name: string): string[] | null {
  const find = (f: string, n: string): string[] | null => {
    for (const stmt of project.program(f).body) {
      const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
      if (decl?.type !== "VariableDeclaration") continue;
      for (const d of decl.declarations) {
        if (d.id.type !== "Identifier" || d.id.name !== n) continue;
        let init = d.init;
        while (init?.type === "TSAsExpression" || init?.type === "TSSatisfiesExpression") init = init.expression;
        if (init?.type !== "ArrayExpression") return null;
        const values = init.elements.map((e) => stringOf(e ?? undefined));
        return values.every((v): v is string => v !== null) ? values : null;
      }
    }
    return null;
  };
  const target = importedBinding(project, file, name);
  return find(file, name) ?? (target ? find(target.file, target.name) : null);
}

/** `for (const x of NAMES)` where NAMES is a known string list: the variable and its values. */
function unrolledLoop(project: Project, file: string, loop: ForOfStatement): { variable: string; values: string[] } | null {
  const decl = loop.left;
  if (decl.type !== "VariableDeclaration" || decl.declarations.length !== 1 || decl.declarations[0].id.type !== "Identifier") return null;
  if (loop.right.type !== "Identifier") return null;
  const values = stringArray(project, file, loop.right.name);
  return values ? { variable: decl.declarations[0].id.name, values } : null;
}

function constsOf(body: Node): Map<string, Expression> {
  const consts = new Map<string, Expression>();
  if (body.type !== "BlockStatement") return consts;
  for (const stmt of body.body) {
    if (stmt.type !== "VariableDeclaration" || stmt.kind !== "const") continue;
    for (const d of stmt.declarations) if (d.id.type === "Identifier" && d.init) consts.set(d.id.name, d.init);
  }
  return consts;
}

/** True when `name` is a top-level `export const name = express.Router()` (or `Router()`) in `file`. */
function isRouterVariable(project: Project, file: string, name: string): boolean {
  for (const stmt of project.program(file).body) {
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (decl?.type !== "VariableDeclaration") continue;
    for (const d of decl.declarations) {
      if (d.id.type !== "Identifier" || d.id.name !== name || d.init?.type !== "CallExpression") continue;
      const c = d.init.callee;
      if ((c.type === "Identifier" && c.name === "Router") || (c.type === "MemberExpression" && !c.computed && c.property.name === "Router")) return true;
    }
  }
  return false;
}

/** True when the function named `name` calls `Router()` or `express.Router()`, that is, it builds a router. */
function buildsRouter(project: Project, file: string, name: string): boolean {
  const found = findFunction(project, file, name);
  let builds = false;
  if (found?.fn.body) {
    walk(found.fn.body, (node) => {
      if (node.type !== "CallExpression") return;
      const c = node.callee;
      if ((c.type === "Identifier" && c.name === "Router") || (c.type === "MemberExpression" && !c.computed && c.property.name === "Router")) builds = true;
    });
  }
  return builds;
}

function collectRoutes(ctx: RouteContext, file: string, router: string, body: Node, prefix: string, conditional: boolean): void {
  const scan = (node: Node, state: ScanState): void => {
    if (node.type === "CallExpression" && handleCall(ctx, file, router, prefix, node, state)) return;
    if (node.type === "ForOfStatement") {
      const loop = unrolledLoop(ctx.project, file, node);
      if (loop) {
        const consts = constsOf(node.body);
        for (const value of loop.values) scan(node.body, { ...state, vars: new Map(state.vars).set(loop.variable, value), consts });
        return;
      }
    }
    const next = CONDITIONAL_NODES.has(node.type) ? { ...state, conditional: true } : state;
    for (const child of children(node)) scan(child, next);
  };
  scan(body, { conditional, vars: new Map(), consts: new Map() });
}

/** Returns true when the call is a router operation that was handled (so its handler bodies are not scanned). */
function handleCall(ctx: RouteContext, file: string, router: string, prefix: string, call: CallExpression, state: ScanState): boolean {
  const callee = call.callee;
  const handsOverRouter = call.arguments.some((a) => a.type === "Identifier" && a.name === router);

  if (callee.type === "MemberExpression" && !callee.computed) {
    if (callee.object.type === "Identifier" && callee.object.name === router) {
      const method = callee.property.name;
      if (method === "use") {
        addUse(ctx, file, router, prefix, call, state);
        return true;
      }
      if (ROUTE_METHODS.has(method)) {
        // One argument is a settings read such as `app.get("env")`, not a route.
        if (call.arguments.length < 2) return false;
        const paths = pathsOf(call.arguments[0], state.vars);
        if (!paths) {
          ctx.problems.push(`${file}: ${router}.${method}(...) has a path that is not a plain string, so the route cannot be listed`);
          return true;
        }
        const middleware = middlewareNames(call.arguments.slice(1, -1), state);
        const handler = nameOf(call.arguments[call.arguments.length - 1]);
        for (const p of paths) {
          const full = joinPath(prefix, p);
          ctx.routes.push({
            method: method.toUpperCase(),
            path: full,
            middleware,
            handler,
            file,
            conditional: state.conditional,
            uses: ctx.uses.filter((u) => u.scopes.some((s) => covers(s, full))),
          });
        }
        return true;
      }
      if (NON_ROUTING_METHODS.has(method)) return false;
      ctx.problems.push(`${file}: ${router}.${method}(...) is a router call the map does not follow`);
      return true;
    }
    if (handsOverRouter) {
      ctx.problems.push(`${file}: the router is passed to a method call, which the map does not follow`);
      return true;
    }
    return false;
  }

  if (callee.type === "Identifier" && handsOverRouter) {
    const index = call.arguments.findIndex((a) => a.type === "Identifier" && a.name === router);
    const target = findFunction(ctx.project, file, callee.name);
    const param = target?.fn.params[index];
    if (!target || !target.fn.body || param?.type !== "Identifier") {
      ctx.problems.push(`${file}: ${callee.name}(${router}, ...) hands the router to code the map cannot follow`);
      return true;
    }
    const key = `${target.file}#${callee.name}#${param.name}#${prefix}`;
    if (!ctx.visited.has(key)) {
      ctx.visited.add(key);
      collectRoutes(ctx, target.file, param.name, target.fn.body, prefix, state.conditional);
    }
    return true;
  }
  return false;
}

function addUse(ctx: RouteContext, file: string, router: string, prefix: string, call: CallExpression, state: ScanState): void {
  const scoped = pathsOf(call.arguments[0], state.vars);
  const rest = scoped ? call.arguments.slice(1) : call.arguments;
  const scopes = (scoped ?? [""]).map((s) => (s === "" ? prefix : joinPath(prefix, s)));
  for (const arg of rest) {
    const mounted = arg.type === "Identifier" ? importedBinding(ctx.project, file, arg.name) : null;
    if (mounted && isRouterVariable(ctx.project, mounted.file, mounted.name)) {
      if (scopes.length !== 1) {
        ctx.problems.push(`${file}: a sub-router is mounted on several paths, which the map does not follow`);
        continue;
      }
      collectRoutes(ctx, mounted.file, mounted.name, ctx.project.program(mounted.file), scopes[0], state.conditional);
      continue;
    }
    if (arg.type === "CallExpression" && arg.callee.type === "Identifier" && buildsRouter(ctx.project, file, arg.callee.name)) {
      ctx.problems.push(`${file}: ${router}.use(${arg.callee.name}()) mounts a router built by a function, which the map does not follow`);
      continue;
    }
    ctx.uses.push({ scopes, middleware: nameOf(arg), file, conditional: state.conditional });
  }
}

function routeTables(project: Project, entry: AppEntry, problems: string[]): { routes: string; middleware: string } {
  const routeHeader = ["method", "path", "middleware", "handler", "file", "conditional"];
  const middlewareHeader = ["order", "scope", "middleware", "file", "conditional"];
  const found = findFunction(project, entry.file, entry.function);
  if (!found?.fn.body) {
    problems.push(`${entry.file}: function ${entry.function} not found, so no routes can be listed`);
    return { routes: csv(routeHeader, []), middleware: csv(middlewareHeader, []) };
  }
  const ctx: RouteContext = { project, uses: [], routes: [], problems, visited: new Set() };
  collectRoutes(ctx, entry.file, entry.app, found.fn.body, "", false);

  const flagged = (u: UseEntry): string => u.middleware + (u.conditional ? "?" : "");
  const routeRows = ctx.routes.map((r) => [r.method, r.path, [...r.uses.map(flagged), ...r.middleware].join(";"), r.handler, r.file, r.conditional ? "yes" : ""]);
  const middlewareRows = ctx.uses.map((u, i) => [String(i + 1).padStart(3, "0"), u.scopes.map((s) => s || "*").join("|"), u.middleware, u.file, u.conditional ? "yes" : ""]);
  return { routes: csv(routeHeader, routeRows), middleware: csv(middlewareHeader, middlewareRows) };
}

// ---------------------------------------------------------------------------
// test maps
// ---------------------------------------------------------------------------

/**
 * What a source file is, so that "no direct test" is read correctly: a barrel only re-exports and a
 * types file has nothing to run.
 */
function kindOf(project: Project, file: string): string {
  const body = project.program(file).body.filter((s) => s.type !== "ImportDeclaration");
  const reExport = (s: Node): boolean => s.type === "ExportAllDeclaration" || (s.type === "ExportNamedDeclaration" && s.source !== null && s.declaration === null);
  const typeOnly = (s: Node): boolean => {
    const decl = s.type === "ExportNamedDeclaration" ? (s.exportKind === "type" ? s : s.declaration) : s;
    return decl === null || decl.type === "ExportNamedDeclaration" || decl.type === "TSTypeAliasDeclaration" || decl.type === "TSInterfaceDeclaration";
  };
  if (body.length > 0 && body.every(reExport)) return "barrel";
  if (body.length > 0 && body.every(typeOnly)) return "types";
  if (file.startsWith("server/")) return "server";
  return file.startsWith("src/components/") && file.endsWith(".tsx") ? "component" : "client";
}

function testRows(project: Project): string[][] {
  const sources = project.files.filter((f) => !isTestFile(f) && !isTestSupport(f));
  const tests = new Map<string, string[]>(sources.map((s) => [s, []]));
  for (const test of project.files.filter(isTestFile)) {
    walk(project.program(test), (node) => {
      let specifier: string | null = null;
      if (node.type === "ImportDeclaration" && node.importKind !== "type") specifier = node.source.value;
      else if ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.exportKind !== "type") specifier = node.source?.value ?? null;
      else if (node.type === "ImportExpression") specifier = stringOf(node.source);
      const target = specifier === null ? null : project.resolve(test, specifier);
      const list = target ? tests.get(target) : undefined;
      if (list && !list.includes(test)) list.push(test);
    });
  }
  return sources.map((source) => [source, kindOf(project, source), (tests.get(source) ?? []).sort(byCodeUnit).join(";")]);
}

// ---------------------------------------------------------------------------
// external-apis.csv, env-keys.csv, db-tables.csv
// ---------------------------------------------------------------------------

const EXAMPLE_HOST = /(^localhost$|\.(example|invalid|test|local)$)/;
const HOST = /https?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const TABLE = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)/gi;

/**
 * Per source file: hosts written as plain strings and database tables created (server only), and
 * environment variables read (`process.env.X` on the server, `import.meta.env.X` in the client).
 */
function referenceTables(project: Project): { apis: string; env: string; db: string } {
  const apis: string[][] = [];
  const env: string[][] = [];
  const db: string[][] = [];
  for (const file of project.files) {
    if (isTestFile(file) || isTestSupport(file)) continue;
    const onServer = file.startsWith("server/");
    const hosts = new Set<string>();
    const keys = new Set<string>();
    const tables = new Set<string>();
    walk(project.program(file), (node) => {
      const text = node.type === "TemplateElement" ? node.value.cooked : stringOf(node);
      if (onServer && text) {
        for (const m of text.matchAll(HOST)) if (!EXAMPLE_HOST.test(m[1].toLowerCase())) hosts.add(m[1].toLowerCase());
        for (const m of text.matchAll(TABLE)) tables.add(m[1]);
      }
      if (node.type !== "MemberExpression" || node.object.type !== "MemberExpression") return;
      const base = node.object;
      const isEnv =
        !base.computed &&
        base.property.name === "env" &&
        ((base.object.type === "Identifier" && base.object.name === "process") || base.object.type === "MetaProperty");
      const key = isEnv ? (node.computed ? stringOf(node.property) : node.property.name) : null;
      if (key) keys.add(key);
    });
    for (const host of hosts) apis.push([host, file]);
    for (const key of keys) env.push([key, file]);
    for (const table of tables) db.push([table, file]);
  }
  return { apis: csv(["host", "file"], apis), env: csv(["key", "file"], env), db: csv(["table", "file"], db) };
}

// ---------------------------------------------------------------------------
// Build and check
// ---------------------------------------------------------------------------

export interface CodeMap {
  /** File name inside `doc/code-map/` to its full text. */
  files: Record<string, string>;
  /** Anything the map could not follow. A non-empty list means the map is not trustworthy. */
  problems: string[];
}

export function buildCodeMap(root: string = REPO_ROOT, entry: AppEntry = DEFAULT_ENTRY): CodeMap {
  const project = new Project(root);
  const problems: string[] = [];
  const { routes, middleware } = routeTables(project, entry, problems);
  const tests = testRows(project);
  const testHeader = ["source", "kind", "direct_tests"];
  const references = referenceTables(project);
  const files: Record<string, string> = {
    "routes.csv": routes,
    "middleware.csv": middleware,
    "test-map-server.csv": csv(testHeader, tests.filter((r) => r[0].startsWith("server/"))),
    "test-map-src.csv": csv(testHeader, tests.filter((r) => r[0].startsWith("src/"))),
    "external-apis.csv": references.apis,
    "env-keys.csv": references.env,
    "db-tables.csv": references.db,
  };
  for (const [name, text] of Object.entries(files)) {
    if (Buffer.byteLength(text) > MAX_TABLE_BYTES) {
      problems.push(`${name} is ${Buffer.byteLength(text)} bytes, over the ${MAX_TABLE_BYTES} byte limit for a table an agent greps. Split it or raise MAX_TABLE_BYTES on purpose.`);
    }
  }
  return { files, problems };
}

/** The tables that differ from what the tree produces: missing, changed, or committed but no longer produced. */
export function staleTables(root: string, map: CodeMap): string[] {
  const dir = path.join(root, OUT_DIR);
  const differing = Object.entries(map.files)
    .filter(([name, text]) => {
      const file = path.join(dir, name);
      return !fs.existsSync(file) || fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n") !== text;
    })
    .map(([name]) => name);
  const orphans = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".csv") && !(n in map.files)) : [];
  return [...differing, ...orphans];
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  const map = buildCodeMap();
  if (map.problems.length > 0) {
    console.error(`\x1b[31m✖ Code map: ${map.problems.length} problem(s)\x1b[0m`);
    for (const p of map.problems) console.error(`  ${p}`);
    process.exit(1);
  }
  if (process.argv.includes("--check")) {
    const stale = staleTables(REPO_ROOT, map);
    if (stale.length === 0) {
      console.log("\x1b[32m✔ Code map is up to date.\x1b[0m");
      process.exit(0);
    }
    console.error(`\x1b[31m✖ Code map is out of date: ${stale.join(", ")}. Run \`npm run map\` and commit doc/code-map/.\x1b[0m`);
    process.exit(1);
  }
  fs.mkdirSync(path.join(REPO_ROOT, OUT_DIR), { recursive: true });
  for (const name of staleTables(REPO_ROOT, map).filter((n) => !(n in map.files))) fs.rmSync(path.join(REPO_ROOT, OUT_DIR, name));
  for (const [name, text] of Object.entries(map.files)) {
    fs.writeFileSync(path.join(REPO_ROOT, OUT_DIR, name), text);
    console.log(`${OUT_DIR}/${name}: ${text.split("\n").length - 2} rows, ${Buffer.byteLength(text)} bytes`);
  }
}
