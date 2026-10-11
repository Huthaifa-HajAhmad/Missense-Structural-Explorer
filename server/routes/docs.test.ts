import { describe, it, expect } from "vitest";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { docsRouter } from "./docs.ts";
import { generateOpenApiSpec } from "../services/openapi.ts";


describe("OpenAPI & Documentation Routes", () => {
  it("should generate a valid OpenAPI 3.1.0 specification object", () => {
    const spec = generateOpenApiSpec();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Missense Structural Explorer API");
    expect(spec.paths["/translate-variant"]).toBeDefined();
    expect(spec.paths["/analyze-variant"]).toBeDefined();
    expect(spec.paths["/generate-mutant"]).toBeDefined();
    expect(spec.paths["/my-jobs"]).toBeDefined();
    expect(spec.components.securitySchemes.SessionAuth).toBeDefined();
    expect(spec.components.securitySchemes.SessionCookie).toBeDefined();
  });

  /**
   * The spec once listed `/biophysical-analysis`, `/find-pocket` and `/align-sequences`, none of which
   * the server has ever registered, while the account, job and admin routes were missing entirely. An
   * agent reading the spec got 404s for the first and could not discover the second. Both directions
   * are now checked against the route source.
   */
  describe("matches the registered routes", () => {
    const routesDir = path.join(__dirname);
    const sourceFiles = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return sourceFiles(full);
        return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [full] : [];
      });
    const routePattern = /\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`]*)["'`]/g;
    /** `METHOD /path/{param}` for every route registered in these files. */
    const registered = (files: string[]): Set<string> => {
      const out = new Set<string>();
      for (const file of files) {
        for (const m of fs.readFileSync(file, "utf8").matchAll(routePattern)) {
          out.add(`${m[1].toUpperCase()} ${m[2].replace(/:([A-Za-z]+)/g, "{$1}")}`);
        }
      }
      return out;
    };
    const documented = (): Set<string> => {
      const out = new Set<string>();
      for (const [p, ops] of Object.entries(generateOpenApiSpec().paths as Record<string, object>)) {
        for (const method of Object.keys(ops)) out.add(`${method.toUpperCase()} ${p}`);
      }
      return out;
    };

    it("documents no route the server does not register", () => {
      const all = registered(sourceFiles(routesDir));
      const fictional = [...documented()].filter((op) => !all.has(op));
      expect(fictional, "documented in openapi but not registered by any route file").toEqual([]);
    });

    it("documents every account, admin and job route", () => {
      const accountRoutes = registered([path.join(routesDir, "auth.ts"), path.join(routesDir, "admin.ts")]);
      const jobRoutes = [...registered([path.join(routesDir, "biophysics", "polling.ts")])].filter((op) => / \/(my-jobs|jobs\/)/.test(op));
      const docs = documented();
      const missing = [...accountRoutes, ...jobRoutes].filter((op) => !docs.has(op));
      expect(jobRoutes.length).toBeGreaterThan(0);
      expect(missing, "registered but missing from server/services/infra/openapi-compute.ts").toEqual([]);
    });
  });

  /**
   * The gate used to assert only that PATHS exist, so a field could be added to a schema, promised
   * in the docs and then removed — or documented on the request while the response quietly carried
   * it — with nothing failing. The genome-build trail is the case that motivated this: it travels on
   * the analysis RESULT (which is what a report reads), and an agent reading the spec saw it only as
   * an input.
   */
  it("documents the genome-build trail on the analysis RESPONSE, not only the request", () => {
    const spec = generateOpenApiSpec() as any;
    const analyze200 = spec.paths["/analyze-variant"].post.responses["200"].content["application/json"].schema;
    const props: Record<string, any> = analyze200.properties ?? {};

    for (const field of ["assembly", "resolvedAssembly", "liftedGenomicCoordinates", "coordinateLift"]) {
      expect(props[field], `${field} must be documented on the analyze-variant 200 schema`).toBeDefined();
    }

    // The request documents the FACTS it accepts …
    const analyzeRequest = spec.paths["/analyze-variant"].post.requestBody.content["application/json"].schema;
    const requestProps: Record<string, any> = analyzeRequest.properties ?? {};
    expect(requestProps["assembly"]).toBeDefined();
    expect(requestProps["genomicCoordinates"]).toBeDefined();
    expect(requestProps["liftedGenomicCoordinates"]).toBeDefined();
    expect(requestProps["resolvedAssembly"]).toBeDefined();
    // … and marks the decision record as derived, because the route does not accept it from a caller.
    expect(requestProps["coordinateLift"]?.readOnly).toBe(true);
  });

  it("should serve OpenAPI JSON and HTML documentation via Express router", async () => {
    const app = express();
    app.use(docsRouter);

    const specRes = await new Promise<{ headers: Record<string, string>; body: any }>((resolve) => {
      const req = { method: "GET", url: "/openapi.json", headers: {} } as any;
      const res = {
        headers: {} as Record<string, string>,
        setHeader(key: string, val: string) { this.headers[key] = val; return this; },
        json(data: any) { resolve({ headers: this.headers, body: data }); },
        send(data: any) { resolve({ headers: this.headers, body: data }); }
      } as any;
      docsRouter(req, res, () => {});
    });

    expect(specRes.headers["Content-Type"]).toContain("application/json");
    expect(specRes.body.openapi).toBe("3.1.0");

    const htmlRes = await new Promise<{ headers: Record<string, string>; body: any }>((resolve) => {
      const req = { method: "GET", url: "/docs", headers: {} } as any;
      const res = {
        headers: {} as Record<string, string>,
        setHeader(key: string, val: string) { this.headers[key] = val; return this; },
        json(data: any) { resolve({ headers: this.headers, body: data }); },
        send(data: any) { resolve({ headers: this.headers, body: data }); }
      } as any;
      docsRouter(req, res, () => {});
    });

    expect(htmlRes.headers["Content-Type"]).toContain("text/html");
    expect(htmlRes.body.toLowerCase()).toContain("<!doctype html>");
    expect(htmlRes.body).toContain("Missense Structural Explorer API Documentation");
  });
});
