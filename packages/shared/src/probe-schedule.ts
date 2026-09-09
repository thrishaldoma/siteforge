/**
 * The order §6's behaviour probes run in, as a function rather than a habit.
 *
 * Ordering is load-bearing twice over, and both were learned by breaking them:
 *
 *   - A **target-destructive** probe mutates the store, so every probe after it
 *     measures a different application. Firing "Delete all todos" inline took
 *     `statesProbed` from 1 to 0. §6's "each probe runs in a fresh page context,
 *     so probes cannot contaminate each other's preconditions" is about the
 *     browser, not the server.
 *   - A **session-destructive** probe ends the session. With non-interactive
 *     re-auth each can take a fresh login and order barely matters; without it
 *     there is exactly one to spend, and spending it early ends the crawl.
 *
 * Leaving that as prose is what §3.4 and the same-origin rule both were.
 */

export type ProbePhase = 'ordinary' | 'session-destructive' | 'target-destructive';

/**
 * Whether session-destructive probing is unrestricted.
 *
 * Named for what it governs rather than for the auth mechanism: the question a
 * consumer asks is never "how did we log in", it is "could we afford to throw
 * this session away". Derived from `credentialSource` (§3.3) — `env` and
 * `os-keychain` mean a login can be repeated without a human; `interactive-only`
 * means the session in hand is the only one there will be.
 */
export type SessionProbePolicy =
  /** Re-auth is non-interactive. Each session-destructive probe gets its own login. */
  | 'credentialed'
  /** Headful human login, unrepeatable. They run last, once, and the crawl ends. */
  | 'interactive'
  /** No authenticated context, so nothing to spend. */
  | 'not-applicable';

export const POLICY_BY_CREDENTIAL_SOURCE = {
  env: 'credentialed',
  'os-keychain': 'credentialed',
  'interactive-only': 'interactive',
} as const satisfies Record<string, SessionProbePolicy>;

export interface ScheduledControl<T> {
  control: T;
  phase: ProbePhase;
  /** False when the control is discovered but must not be activated. */
  fire: boolean;
  /** Why it will not be fired. `null` when it will be. */
  declineReason: 'target-destructive' | 'out-of-scope' | 'session-budget-spent' | null;
}

export interface SchedulerInput<T> {
  controls: readonly T[];
  hazardOf: (control: T) => 'target-destructive' | 'session-destructive' | 'out-of-scope' | null;
  /** §6's flag. The operator asserting they own the target. */
  allowDestructive: boolean;
  /** Controls the operator declined by name even under `--allow-destructive`. */
  neverFire: (control: T) => boolean;
  policy: SessionProbePolicy;
}

const PHASE_ORDER: readonly ProbePhase[] = ['ordinary', 'session-destructive', 'target-destructive'];

/**
 * Order the controls and decide which are fired.
 *
 * Returns every control, in execution order, each carrying its phase and
 * whether it will actually be activated — so a caller cannot run a phase early
 * by accident, and a test can assert the order without driving a browser.
 */
export function planProbeSchedule<T>({
  controls,
  hazardOf,
  allowDestructive,
  neverFire,
  policy,
}: SchedulerInput<T>): ScheduledControl<T>[] {
  const planned: ScheduledControl<T>[] = [];
  // Under `interactive` there is one session to spend, so at most one
  // session-destructive control is fired and the crawl ends after it.
  let sessionBudget = policy === 'interactive' ? 1 : Number.POSITIVE_INFINITY;

  for (const phase of PHASE_ORDER) {
    for (const control of controls) {
      const hazard = hazardOf(control);
      if (phase === 'ordinary') {
        if (hazard === null) {
          planned.push({ control, phase, fire: true, declineReason: null });
        } else if (hazard === 'out-of-scope') {
          planned.push({ control, phase, fire: false, declineReason: 'out-of-scope' });
        }
        continue;
      }
      if (phase === 'session-destructive' && hazard === 'session-destructive') {
        if (policy === 'not-applicable' || sessionBudget < 1) {
          planned.push({ control, phase, fire: false, declineReason: 'session-budget-spent' });
          continue;
        }
        sessionBudget -= 1;
        planned.push({ control, phase, fire: true, declineReason: null });
        continue;
      }
      if (phase === 'target-destructive' && hazard === 'target-destructive') {
        const fire = allowDestructive && !neverFire(control);
        planned.push({
          control,
          phase,
          fire,
          declineReason: fire ? null : 'target-destructive',
        });
      }
    }
  }
  return planned;
}

/** True when the crawl must stop after the schedule: the only session was spent. */
export function terminatesAfterSchedule<T>(
  schedule: readonly ScheduledControl<T>[],
  policy: SessionProbePolicy,
): boolean {
  return (
    policy === 'interactive' &&
    schedule.some((s) => s.phase === 'session-destructive' && s.fire)
  );
}

// ---------------------------------------------------------------------------
// Classifying a control (§6, decision 0011)
// ---------------------------------------------------------------------------

/**
 * The term lists, in one place for every driver.
 *
 * §6's original heuristic had a single "destructive" bucket and it conflated
 * three unrelated things: "Sign out" and "Delete account" both match, and
 * treating them alike was wrong in both directions — it left
 * `POST /api/auth/logout` uncaptured while §10's auth tasks depend on it, and
 * it filed a core auth flow as unreliable.
 *
 * These were `rung3.mjs`'s local constants. A second driver needed them and
 * copying was the obvious move; §13's schema-drift argument says otherwise, and
 * the concrete failure would be two crawlers disagreeing about whether the same
 * button is safe to press. One implementation, imported by both.
 */
export const TARGET_DESTRUCTIVE_TERMS: readonly string[] = [
  'delete',
  'remove',
  'cancel subscription',
  'deactivate',
  'close account',
];

export const SESSION_DESTRUCTIVE_TERMS: readonly string[] = [
  'sign out',
  'log out',
  'logout',
  'switch account',
  'revoke',
];

/** Controls the operator declines to fire even under `--allow-destructive`. */
export const NEVER_FIRE_NAMES: readonly string[] = ['delete account'];

export interface ControlClassification {
  readonly hazard: 'target-destructive' | 'session-destructive' | 'out-of-scope' | null;
  /** The term that classified it. Required for a destructive verdict. */
  readonly matchedTerm?: string;
  /** What put it outside scope: the scheme, or the foreign origin. */
  readonly outOfScopeTarget?: string;
}

/**
 * Classify one control by **who absorbs the harm** (decision 0011).
 *
 * Order matters and is not arbitrary: "delete account" must not be read as a
 * session action just because signing out is a side effect of it, so the
 * target-destructive list is consulted first. Out-of-scope comes before both,
 * because a `mailto:` named "Delete" is still not ours to fire.
 *
 * `sameOrigin` is passed in rather than imported so this stays a pure function
 * of its arguments — and so the origin comparison is the caller's parsed one
 * rather than a prefix test reinvented here. §13: `${ORIGIN}@evil.example/x`
 * and `${ORIGIN}.evil.net/x` both satisfy `startsWith` and are foreign.
 */
export function classifyControlHazard(options: {
  /** The accessible name. Matched case-insensitively. */
  readonly name: string;
  readonly href?: string | undefined;
  /** True when the href is on the crawl's own origin. Parsed by the caller. */
  readonly isSameOrigin: (href: string) => boolean;
}): ControlClassification {
  const { name, href = '', isSameOrigin } = options;
  const lower = name.toLowerCase();

  if (href !== '' && /^(mailto:|tel:)/i.test(href)) {
    return { hazard: 'out-of-scope', outOfScopeTarget: `${href.split(':')[0]!}:` };
  }
  if (href !== '' && /^https?:\/\//i.test(href) && !isSameOrigin(href)) {
    // The caller parsed it, so `new URL` here cannot disagree with the test above.
    return { hazard: 'out-of-scope', outOfScopeTarget: new URL(href).origin };
  }
  const target = TARGET_DESTRUCTIVE_TERMS.find((t) => lower.includes(t));
  if (target !== undefined) return { hazard: 'target-destructive', matchedTerm: target };
  const session = SESSION_DESTRUCTIVE_TERMS.find((t) => lower.includes(t));
  if (session !== undefined) return { hazard: 'session-destructive', matchedTerm: session };
  return { hazard: null };
}
