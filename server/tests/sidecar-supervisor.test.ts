import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { SidecarSupervisor, startSidecarSupervisor } from "../sidecar-supervisor.ts";
import { CONFIG } from "../config.ts";
import { spawn, execSync } from "child_process";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => "")
}));

vi.mock("../utils.ts", () => ({
  AuditLogger: {
    log: vi.fn()
  }
}));

describe("SidecarSupervisor", () => {
  let mockChildProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockChildProcess = Object.assign(new EventEmitter(), {
      pid: 12345,
      kill: vi.fn(),
      once: vi.fn((event: string, cb: Function) => {
        if (event === "exit") {
          setTimeout(() => cb(0, null), 10);
        }
      })
    });

    vi.mocked(spawn).mockReturnValue(mockChildProcess as any);
    vi.mocked(execSync).mockReturnValue("" as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("skips local spawn if sidecarBaseUrl is an external host", () => {
    const originalUrl = CONFIG.services.sidecarBaseUrl;
    try {
      (CONFIG.services as any).sidecarBaseUrl = "https://remote-ai-host.com";
      const supervisor = new SidecarSupervisor();
      supervisor.start();
      expect(spawn).not.toHaveBeenCalled();
      expect(supervisor.getProcess()).toBeNull();
    } finally {
      (CONFIG.services as any).sidecarBaseUrl = originalUrl;
    }
  });

  it("spawns sidecar process on start for local host", () => {
    const originalUrl = CONFIG.services.sidecarBaseUrl;
    try {
      (CONFIG.services as any).sidecarBaseUrl = "http://127.0.0.1:8000";
      const supervisor = new SidecarSupervisor();
      supervisor.start();

      expect(spawn).toHaveBeenCalled();
      expect(supervisor.getProcess()).toBe(mockChildProcess);
    } finally {
      (CONFIG.services as any).sidecarBaseUrl = originalUrl;
    }
  });

  it("handles process exit with exponential backoff restart", () => {
    const originalUrl = CONFIG.services.sidecarBaseUrl;
    try {
      (CONFIG.services as any).sidecarBaseUrl = "http://127.0.0.1:8000";
      const supervisor = new SidecarSupervisor();
      supervisor.start();

      expect(spawn).toHaveBeenCalledTimes(1);

      // Emit unexpected exit
      mockChildProcess.emit("exit", 1, null);
      expect(supervisor.getProcess()).toBeNull();

      // Fast-forward backoff delay (2000ms for attempt 1)
      vi.advanceTimersByTime(2500);

      expect(spawn).toHaveBeenCalledTimes(2);
    } finally {
      (CONFIG.services as any).sidecarBaseUrl = originalUrl;
    }
  });

  it("handles process error event gracefully", () => {
    const originalUrl = CONFIG.services.sidecarBaseUrl;
    try {
      (CONFIG.services as any).sidecarBaseUrl = "http://127.0.0.1:8000";
      const supervisor = new SidecarSupervisor();
      supervisor.start();

      mockChildProcess.emit("error", new Error("Spawn failure"));
      expect(supervisor.getProcess()).toBeNull();
    } finally {
      (CONFIG.services as any).sidecarBaseUrl = originalUrl;
    }
  });

  it("gracefully terminates child process and clears timers on stop()", async () => {
    const originalUrl = CONFIG.services.sidecarBaseUrl;
    try {
      (CONFIG.services as any).sidecarBaseUrl = "http://127.0.0.1:8000";
      const supervisor = new SidecarSupervisor();
      supervisor.start();

      expect(supervisor.getProcess()).toBe(mockChildProcess);

      const stopPromise = supervisor.stop();
      vi.advanceTimersByTime(50);
      await stopPromise;

      expect(supervisor.getProcess()).toBeNull();
    } finally {
      (CONFIG.services as any).sidecarBaseUrl = originalUrl;
    }
  });

  it("initiates recovery when 3 consecutive background health checks fail after grace period", async () => {
    const originalUrl = CONFIG.services.sidecarBaseUrl;
    try {
      (CONFIG.services as any).sidecarBaseUrl = "http://127.0.0.1:8000";
      // Mock failed fetch to /health
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection refused")));

      const supervisor = new SidecarSupervisor();
      supervisor.start();

      expect(spawn).toHaveBeenCalledTimes(1);

      // Fast-forward past 180s startup grace window
      vi.advanceTimersByTime(180000);

      // Strike 1 (at 240s)
      vi.advanceTimersByTime(60000);
      await Promise.resolve();

      // Strike 2 (at 300s)
      vi.advanceTimersByTime(60000);
      await Promise.resolve();

      // Strike 3 (at 360s) -> triggers recovery
      vi.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(execSync).toHaveBeenCalled();

      const stopPromise = supervisor.stop();
      vi.advanceTimersByTime(3500);
      await stopPromise;
    } finally {
      (CONFIG.services as any).sidecarBaseUrl = originalUrl;
    }
  });

  it("starts singleton helper function startSidecarSupervisor", async () => {
    const originalUrl = CONFIG.services.sidecarBaseUrl;
    try {
      (CONFIG.services as any).sidecarBaseUrl = "http://127.0.0.1:8000";
      const supervisor = startSidecarSupervisor();
      expect(supervisor).toBeInstanceOf(SidecarSupervisor);
      expect(spawn).toHaveBeenCalled();
      const stopPromise = supervisor.stop();
      vi.advanceTimersByTime(3500);
      await stopPromise;
    } finally {
      (CONFIG.services as any).sidecarBaseUrl = originalUrl;
    }
  });
});
