// Sessions expire after 30 minutes of inactivity. Timers use milliseconds.
const idleTimeout = 30 * 60 * 1000;

/** Stores browser sessions in memory for one application instance. */
export class Sessions<T> {
  private readonly entries = new Map<
    string,
    { value: T; expires: number; timer: NodeJS.Timeout }
  >();

  /** Replaces any previous session with a fresh ID for the authenticated user. */
  open(value: T, previous: unknown) {
    this.invalidate(previous);
    const id = crypto.randomUUID();
    const timer = setTimeout(() => this.entries.delete(id), idleTimeout).unref();
    this.entries.set(id, { value, expires: Date.now() + idleTimeout, timer });
    return id;
  }

  /** Returns the active session value and restarts its idle timeout, or returns null if expired or unknown. */
  read(id: unknown) {
    const entry = typeof id === 'string' ? this.entries.get(id) : undefined;
    if (!entry || entry.expires <= Date.now()) return null;
    entry.expires = Date.now() + idleTimeout;
    entry.timer.refresh();
    return entry.value;
  }

  /** Removes a session and cancels its expiration timer. */
  invalidate(id: unknown) {
    if (typeof id !== 'string') return;
    const entry = this.entries.get(id);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(id);
  }

  /** Invalidates every session whose stored value matches the predicate. */
  revokeWhere(matches: (value: T) => boolean) {
    for (const [id, entry] of this.entries) if (matches(entry.value)) this.invalidate(id);
  }
}
