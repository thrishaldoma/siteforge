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
