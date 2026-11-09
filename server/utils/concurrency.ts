/**
 * Async concurrency limiter with FIFO queue, timeout, and AbortSignal support.
 */
export class Semaphore {
  private activeCount = 0;
  private queue: { resolve: () => void; reject: (err: Error) => void }[] = [];
  private maxConcurrency: number;
  private maxQueueLength: number;

  constructor(maxConcurrency: number, maxQueueLength = 20) {
    this.maxConcurrency = maxConcurrency;
    this.maxQueueLength = maxQueueLength;
  }

  async acquire(timeoutMs = 30000, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw signal.reason || new Error("Aborted");
    }

    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }

    if (this.queue.length >= this.maxQueueLength) {
      throw new Error("Concurrency limit reached. Biophysical server queue is full.");
    }

    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      const onAcquire = () => {
        resolved = true;
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        this.activeCount++;
        resolve();
      };

      const onAbort = () => {
        if (!resolved) {
          const idx = this.queue.findIndex(item => item.resolve === onAcquire);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
          resolved = true;
          clearTimeout(timer);
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          reject(signal?.reason || new Error("Aborted"));
        }
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          const idx = this.queue.findIndex(item => item.resolve === onAcquire);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
          resolved = true;
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          reject(new Error("Timeout acquiring biophysical semaphore. Concurrency limit reached."));
        }
      }, timeoutMs);

      if (signal) {
        signal.addEventListener("abort", onAbort);
      }

      this.queue.push({ resolve: onAcquire, reject });
    });
  }

  /** True when nothing holds a slot and nothing waits for one (a read, not a reservation). */
  isIdle(): boolean {
    return this.activeCount === 0 && this.queue.length === 0;
  }

  release(): void {
    if (this.activeCount <= 0) {
      console.error("Semaphore over-release detected");
      return;
    }
    // activeCount-- must happen before next.resolve() is called,
    // as next.resolve() (which triggers onAcquire) will immediately increment activeCount again.
    this.activeCount--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next.resolve();
      }
    }
  }
}

/**
 * Three-state resilience circuit breaker (CLOSED, OPEN, HALF-OPEN)
 * with jittered cooldown to prevent thundering herds.
 *
 * HALF-OPEN means one trial request is out. The first caller after the cooldown gets the trial; every
 * other caller is refused until the trial reports (`recordSuccess` closes the breaker, `recordFailure`
 * opens it again). A trial that never reports (its caller was aborted) is replaced after one cooldown,
 * so the breaker cannot stay shut because of a lost caller.
 */
export class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF-OPEN" = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;
  private currentCooldownMs = 60000;
  private trialStartedAt: number | null = null;
  private threshold: number;
  private cooldownMs: number;

  constructor(
    threshold = 5,
    cooldownMs = 60000
  ) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.currentCooldownMs = cooldownMs;
  }

  /** Whether a caller may send a request now. A true answer in OPEN or HALF-OPEN takes the trial. */
  canExecute(): boolean {
    if (!this.isAvailable()) return false;
    if (this.state !== "CLOSED") {
      this.state = "HALF-OPEN";
      this.trialStartedAt = Date.now();
    }
    return true;
  }

  /** The same answer as `canExecute()`, without taking the trial. For callers that only want to know. */
  isAvailable(): boolean {
    if (this.state === "CLOSED") return true;
    const now = Date.now();
    if (this.state === "OPEN") return now - this.lastFailureTime > this.currentCooldownMs;
    return this.trialStartedAt === null || now - this.trialStartedAt > this.cooldownMs;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "CLOSED";
    this.trialStartedAt = null;
    this.currentCooldownMs = this.cooldownMs;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.trialStartedAt = null;
    if (this.failures >= this.threshold) {
      this.state = "OPEN";
      // Add ±20% randomized jitter to prevent thundering herd when breaker exits cooldown
      const jitterFactor = 0.8 + Math.random() * 0.4;
      this.currentCooldownMs = Math.round(this.cooldownMs * jitterFactor);
      console.warn(`[Circuit Breaker] Tripped to OPEN state due to ${this.failures} consecutive failures (cooldown: ${this.currentCooldownMs}ms).`);
    }
  }
}
