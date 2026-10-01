import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initialDeploymentPaused, persistDeploymentRole } from "./deployment-role.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mse-role-"));
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(path.join(dir, "role"), { force: true }); });

describe("persistent deployment role", () => {
  it("keeps a promoted standby active after a container restart", () => {
    vi.stubEnv("DEPLOYMENT_ROLE_PATH", path.join(dir, "role"));
    vi.stubEnv("DEPLOYMENT_STANDBY", "true");
    expect(initialDeploymentPaused()).toBe(true);
    persistDeploymentRole(false);
    expect(initialDeploymentPaused()).toBe(false);
  });
  it("keeps a draining former primary paused after a restart", () => {
    vi.stubEnv("DEPLOYMENT_ROLE_PATH", path.join(dir, "role"));
    vi.stubEnv("DEPLOYMENT_STANDBY", "false");
    persistDeploymentRole(true);
    expect(initialDeploymentPaused()).toBe(true);
  });
  it("fails closed on a corrupt role rather than starting a second worker", () => {
    vi.stubEnv("DEPLOYMENT_ROLE_PATH", path.join(dir, "role"));
    fs.writeFileSync(path.join(dir, "role"), "corrupt");
    expect(() => initialDeploymentPaused()).toThrow("Invalid persisted deployment role");
  });
});
