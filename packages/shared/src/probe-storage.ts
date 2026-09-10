/**
 * Client storage a probe must not inherit from the probe before it (0044).
 *
 * §6: "for each candidate, in a fresh page **context**". The crawler gives a
 * fresh *page* in a shared *context*, and those differ by exactly one thing —
 * client storage. **Measured: three of the four reproducible within-route
 * contamination points are client-side**, not server-side. The project view
 * switches (Gantt, Table, Kanban) write nothing to the server and still move
 * the next probe's pre-state; clicking Gantt and reloading in the same context
 * takes the route from 1303 to 3070 elements, and reloading in a new context
 * against the same server returns it to 1303.
 *
 * A context per probe is the literal reading of §6 and it was tried: it
 * removes the contamination and costs most of the pass, because a cold context
 * has no warm cache or service worker and the SPA has not rendered the control
 * by the time the probe looks for it (fired probes 9 → 1 on `root`). So the
 * context stays warm and the *storage* is reset instead.
 *
 * ### Why this is an allowlist and not a `localStorage.clear()`
 *
 * **The session lives in `localStorage` on this target.** Vikunja keeps its
 * JWT in a `token` key, so a blanket clear signs the crawl out and every probe
 * after it measures a login screen — which is 0019's precondition failure
 * exactly: the run still completes and its output is indistinguishable from a
 * clean one.
 *
 * So the keys that survive are declared, each with the reason it must, and
 * everything else goes. The direction matters: an unknown key is **cleared**,
 * because a UI preference nobody has seen yet is the case this exists to
 * catch, while a forgotten session key fails loudly at the next probe rather
 * than silently biasing a measurement.
 */

/** Keys a probe keeps, and why each one is not a UI preference. */
export const SESSION_STORAGE_KEYS: ReadonlyMap<string, string> = new Map([
  ['token', 'the JWT. Clearing it signs the crawl out, and every probe after would measure a login screen.'],
  ['API_URL', 'where the SPA sends its calls, written at boot. Clearing it leaves the app pointing nowhere.'],
]);

export interface StorageOrigin {
  readonly origin: string;
  readonly localStorage: readonly { readonly name: string; readonly value: string }[];
}
export interface StorageState {
  readonly cookies?: readonly unknown[];
  readonly origins?: readonly StorageOrigin[];
}

/** Whether a probe may inherit this key from the probe before it. */
export const isSessionStorageKey = (name: string): boolean => SESSION_STORAGE_KEYS.has(name);

/**
 * The names a probe must drop, given what a context currently holds.
 *
 * Returned rather than applied, so the caller can log what it dropped and a
 * test can drive the decision without a browser — the same reason
 * `assessWriteAttribution` is a function and not four lines in the driver.
 */
export function nonSessionKeys(names: readonly string[]): string[] {
  return names.filter((n) => !isSessionStorageKey(n));
}

/**
 * A storage state carrying only the session.
 *
 * Applied when a probe context is built, because the sign-in that produced the
 * state visited pages of its own and may have left preferences in it — the
 * first probe on a route would otherwise start from a state no later probe
 * shares.
 */
export function sessionOnlyStorageState<T extends StorageState>(state: T): T {
  if (state.origins === undefined) return state;
  return {
    ...state,
    origins: state.origins.map((o) => ({
      ...o,
      localStorage: o.localStorage.filter((e) => isSessionStorageKey(e.name)),
    })),
  };
}
