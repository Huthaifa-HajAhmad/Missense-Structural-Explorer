import { describe, it, expect } from "vitest";
import { extractErrorMessage } from "./apiClient";

describe("extractErrorMessage Unit Tests", () => {
  it("extracts nested error.message from standardized backend JSON error", async () => {
    const res = new Response(
      JSON.stringify({
        error: {
          code: "BAD_GATEWAY",
          message: "Sequence length (875 aa) exceeds the public ESM Atlas limit of 400 aa. De novo folding for proteins > 400 aa requires an EvolutionaryScale/Biohub API token."
        }
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" }
      }
    );

    const msg = await extractErrorMessage(res, "Failed to run ESMFold");
    expect(msg).toBe("Sequence length (875 aa) exceeds the public ESM Atlas limit of 400 aa. De novo folding for proteins > 400 aa requires an EvolutionaryScale/Biohub API token.");
  });

  it("extracts top-level message field", async () => {
    const res = new Response(
      JSON.stringify({ message: "Sidecar model weight download timed out." }),
      {
        status: 504,
        headers: { "Content-Type": "application/json" }
      }
    );

    const msg = await extractErrorMessage(res, "Failed to run ESMFold");
    expect(msg).toBe("Sidecar model weight download timed out.");
  });

  it("extracts detail field from FastAPI style JSON", async () => {
    const res = new Response(
      JSON.stringify({ detail: "Unprocessable entity in coordinate file." }),
      {
        status: 422,
        headers: { "Content-Type": "application/json" }
      }
    );

    const msg = await extractErrorMessage(res, "Failed to align structures");
    expect(msg).toBe("Unprocessable entity in coordinate file.");
  });

  it("extracts string error field", async () => {
    const res = new Response(
      JSON.stringify({ error: "Invalid amino acid residue." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );

    const msg = await extractErrorMessage(res, "Failed to translate variant");
    expect(msg).toBe("Invalid amino acid residue.");
  });

  it("extracts plain text response without JSON parsing crash", async () => {
    const res = new Response("upstream connect error or disconnect/reset before headers", {
      status: 503,
      headers: { "Content-Type": "text/plain" }
    });

    const msg = await extractErrorMessage(res, "Failed to run ESMFold");
    expect(msg).toBe("upstream connect error or disconnect/reset before headers");
  });

  it("provides clean HTTP status fallback without trailing colon when body is empty", async () => {
    const res = new Response("", {
      status: 502,
      statusText: ""
    });

    const msg = await extractErrorMessage(res, "Failed to run ESMFold");
    expect(msg).toBe("Failed to run ESMFold (HTTP 502)");
    expect(msg).not.toContain("Failed to run ESMFold:");
  });
});
