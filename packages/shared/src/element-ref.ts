/**
 * The runtime resolution contract: turning a recorded `ActionTarget` into a live
 * element, and addressing live elements from an agent.
 *
 * Lives in `shared` because **two** consumers need exactly one implementation:
 *
 *   §9  the behavioral gate replays `flows/*.trace.json` against the clone
 *   §10 `envkit` enumerates `actionSpace` and executes agent actions
 *
 * §9 is where this gets hardened. Replay hits real re-renders at M2, long before
 * `envkit` exists at M5 — so the resolver meets adversarial reality first in the
 * gate, not in the RL loop.
 *
 * **Contract only. Implemented at M2's behavioral gate** (decision 0008).
 */
import type { ActionTarget } from '@siteforge/schema';

/**
 * An address for a live element, valid only within the episode that issued it.
 *
 * Never persisted, never written to a capture artifact, never derived from a
 * `nodeId` — a nodeId is positional within a homogeneous collection, so deriving
 * a ref from one would silently retarget instead of failing (decision 0007).
 */
export type ElementRef = `el_${string}`;

export const ELEMENT_REF_PATTERN = /^el_[0-9a-f]{12}$/;

/**
 * How a ref was arrived at. §10's order, and §9 replay uses the same one so the
 * gate and the runtime cannot disagree about what "the same element" means.
 */
export const RESOLUTION_STRATEGIES = ['entity', 'role-name', 'positional'] as const;
export type ResolutionStrategy = (typeof RESOLUTION_STRATEGIES)[number];

export interface ResolvedElement {
  ref: ElementRef;
  strategy: ResolutionStrategy;
  /**
   * True when the ref came from position alone. Surfaced in the observation so
   * fragility is visible to the agent rather than assumed away (decision 0007).
   */
  positional: boolean;
  /**
   * Digest of the element's identity at the moment the ref was issued. An action
   * whose target's signature has since changed is stale, not retargetable.
   */
  identitySignature: string;
}

export type ResolutionFailure =
  | { reason: 'not-found'; tried: ResolutionStrategy[] }
  | { reason: 'ambiguous'; tried: ResolutionStrategy[]; candidates: number }
  /** Resolution would have succeeded, but only by position, and that was refused. */
  | { reason: 'positional-refused'; tried: ResolutionStrategy[] };

export type ResolutionOutcome =
  | { ok: true; element: ResolvedElement }
  | { ok: false; failure: ResolutionFailure; diagnostic: ActionTarget['diagnostic'] };

/**
 * Raised when an action names a ref whose element identity has changed since the
 * observation that issued it.
 *
 * Never retarget. A rejected action costs the agent one step; a retargeted click
 * writes a corrupted trajectory that reads as success (decision 0007).
 */
export class StaleRefError extends Error {
  constructor(
    readonly ref: ElementRef,
    readonly issuedSignature: string,
    readonly currentSignature: string | null,
  ) {
    super(
      `elementRef ${ref} is stale: issued for ${issuedSignature}, ` +
        `element is now ${currentSignature ?? 'absent'}`,
    );
    this.name = 'StaleRefError';
  }
}

/** A live element as seen by the resolver. Supplied by whatever drives the page. */
export interface LiveElement {
  role: string;
  name: string;
  /** From `data-sf-entity`, before it is stripped from the observation. */
  entityRef: string | null;
  /** Document order among siblings sharing this role, for the positional fallback. */
  ordinal: number;
}

/**
 * One resolver, two consumers.
 *
 * `resolve` walks `RESOLUTION_STRATEGIES` in order and stops at the first
 * unambiguous match. `check` is the staleness test an action must pass before it
 * is executed.
 */
export interface TargetResolver {
  resolve(target: ActionTarget, live: readonly LiveElement[]): ResolutionOutcome;
  enumerate(live: readonly LiveElement[]): ResolvedElement[];
  check(ref: ElementRef, live: readonly LiveElement[]): void;
}
