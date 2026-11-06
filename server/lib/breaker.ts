export class BreakerOpenError extends Error {
  constructor(public readonly name_: string) {
    super(`Circuit open for ${name_}`);
    this.name = 'BreakerOpenError';
  }
}

export interface BreakerOptions {
  /** consecutive failures before opening */
  threshold?: number;
  /** how long to stay open before allowing one trial request */
  cooldownMs?: number;
  now?: () => number;
}

/** Small circuit breaker: closed -> open -> half-open (one trial) -> closed. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    private readonly label: string,
    opts: BreakerOptions = {},
  ) {
    this.threshold = opts.threshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  get state(): 'closed' | 'open' | 'half-open' {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const s = this.state;
    if (s === 'open') throw new BreakerOpenError(this.label);
    if (s === 'half-open') {
      if (this.trialInFlight) throw new BreakerOpenError(this.label);
      this.trialInFlight = true;
    }
    try {
      const out = await fn();
      this.failures = 0;
      this.openedAt = null;
      return out;
    } catch (err) {
      this.failures += 1;
      if (s === 'half-open' || this.failures >= this.threshold) this.openedAt = this.now();
      throw err;
    } finally {
      if (s === 'half-open') this.trialInFlight = false;
    }
  }
}
