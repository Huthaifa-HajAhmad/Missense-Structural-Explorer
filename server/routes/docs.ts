import express from "express";
import { generateOpenApiSpec } from "../services/openapi.ts";

export const docsRouter = express.Router();


// 1. JSON OpenAPI Specification Endpoint
docsRouter.get("/openapi.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.json(generateOpenApiSpec());
});

// 2. Interactive Scalar / Swagger API Documentation Viewer HTML
docsRouter.get("/docs", (_req, res) => {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>Missense Structural Explorer API Documentation</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/style.min.css">
    <style>
      body { margin: 0; background-color: #0f172a; font-family: ui-sans-serif, system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <script id="api-reference" data-url="/api/v1/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/browser/standalone.min.js"></script>
  </body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});
