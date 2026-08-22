import { describe, it, expect } from "vitest";
import express from "express";
import { docsRouter } from "./docs.ts";
import { generateOpenApiSpec } from "../services/openapi.ts";


describe("OpenAPI & Documentation Routes", () => {
  it("should generate a valid OpenAPI 3.1.0 specification object", () => {
    const spec = generateOpenApiSpec();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Missense Structural Explorer API");
    expect(spec.paths["/translate-variant"]).toBeDefined();
    expect(spec.paths["/analyze-variant"]).toBeDefined();
    expect(spec.paths["/biophysical-analysis"]).toBeDefined();
    expect(spec.paths["/align-sequences"]).toBeDefined();
    expect(spec.components.securitySchemes.SessionAuth).toBeDefined();
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
