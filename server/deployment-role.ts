import fs from "node:fs";
import path from "node:path";

function rolePath(): string {
  // Container-local, so two generations never overwrite one another's role.
  return process.env.DEPLOYMENT_ROLE_PATH ?? path.join(process.cwd(), ".deployment-role");
}

export function initialDeploymentPaused(): boolean {
  try {
    const role = fs.readFileSync(rolePath(), "utf8").trim();
    if (role !== "active" && role !== "paused") throw new Error("Invalid persisted deployment role");
    return role === "paused";
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    return process.env.DEPLOYMENT_STANDBY === "true";
  }
}

export function persistDeploymentRole(paused: boolean): void {
  const target = rolePath();
  fs.writeFileSync(`${target}.tmp`, paused ? "paused\n" : "active\n", { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
}
