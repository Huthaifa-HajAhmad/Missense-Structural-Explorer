import { afterEach, describe, expect, it } from "vitest";
import { sanitizeUrl } from "./variant-parser.ts";
import { validateSafeCustomEndpointUrlAsync } from "../../utils/security.ts";

const originalEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalEnv;
});

describe("sanitizeUrl", () => {
  it("refuses loopback, metadata and link-local hosts in every spelling, in any environment", () => {
    process.env.NODE_ENV = "development";
    for (const url of [
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://127.5.5.5/x",
      "https://0.0.0.0/x",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/x",
      "https://[::]/x",
      "https://[::ffff:127.0.0.1]/x", // WHATWG rewrites this to [::ffff:7f00:1]
      "https://[::ffff:7f00:1]/x",
      "https://[::ffff:169.254.169.254]/x",
      "https://[::ffff:a9fe:a9fe]/x",
      "https://[fe80::1]/x",
      "https://[febf::1]/x",
      "https://[fc01::1]/x",
      "https://[fd12:3456::1]/x",
    ]) {
      expect(sanitizeUrl(url), url).toBeNull();
    }
  });

  it("refuses private and shared-address ranges in production, including IPv4-mapped forms", () => {
    process.env.NODE_ENV = "production";
    for (const url of [
      "https://10.1.2.3/x",
      "https://172.16.0.1/x",
      "https://172.31.255.255/x",
      "https://192.168.1.1/x",
      "https://100.64.0.1/x",
      "https://100.127.255.254/x",
      "https://[::ffff:10.0.0.1]/x",
      "https://[::ffff:a00:1]/x",
      "https://[::ffff:c0a8:101]/x",
      "https://[::ffff:ac10:1]/x",
    ]) {
      expect(sanitizeUrl(url), url).toBeNull();
    }
  });

  it("requires https in production and keeps ordinary public hosts", () => {
    process.env.NODE_ENV = "production";
    expect(sanitizeUrl("http://example.org/api")).toBeNull();
    expect(sanitizeUrl("https://example.org/api/")).toBe("https://example.org/api");
    expect(sanitizeUrl("https://172.32.0.1/x")).toBe("https://172.32.0.1/x");
    expect(sanitizeUrl("https://100.128.0.1/x")).toBe("https://100.128.0.1/x");
    expect(sanitizeUrl("https://[2606:4700::1111]/x")).toBe("https://[2606:4700::1111]/x");
  });

  it("allows http outside production and still rejects other schemes", () => {
    process.env.NODE_ENV = "development";
    expect(sanitizeUrl("http://example.org/api")).toBe("http://example.org/api");
    expect(sanitizeUrl("ftp://example.org/x")).toBeNull();
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("validateSafeCustomEndpointUrlAsync (DNS SSRF protection)", () => {
  it("blocks hostnames in production that resolve to private, loopback, metadata, ULA, or CGNAT IPs", async () => {
    process.env.NODE_ENV = "production";
    for (const ip of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "172.16.1.2", "192.168.1.1", "100.64.0.1", "::1", "fe80::1", "fc00::1"]) {
      const res = await validateSafeCustomEndpointUrlAsync("https://proxy.attacker.test/api", async () => [
        { address: ip, family: ip.includes(":") ? 6 : 4 },
      ]);
      expect(res.valid, ip).toBe(false);
    }
  });

  it("fails closed when DNS resolution fails or returns no records in production", async () => {
    process.env.NODE_ENV = "production";
    const errRes = await validateSafeCustomEndpointUrlAsync("https://broken.example/api", async () => {
      throw new Error("ENOTFOUND");
    });
    expect(errRes.valid).toBe(false);
    const emptyRes = await validateSafeCustomEndpointUrlAsync("https://empty.example/api", async () => []);
    expect(emptyRes.valid).toBe(false);
  });

  it("allows hostnames resolving strictly to public IPs in production and preserves LAN hostnames in dev", async () => {
    process.env.NODE_ENV = "production";
    const pub = await validateSafeCustomEndpointUrlAsync("https://safe.example/api/", async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(pub).toEqual({ valid: true, url: "https://safe.example/api", resolvedAddresses: ["93.184.216.34"] });

    process.env.NODE_ENV = "development";
    const dev = await validateSafeCustomEndpointUrlAsync("http://tailscale-box.internal:8080/api", async () => {
      throw new Error("should not resolve in dev");
    });
    expect(dev).toEqual({ valid: true, url: "http://tailscale-box.internal:8080/api" });
  });
});
