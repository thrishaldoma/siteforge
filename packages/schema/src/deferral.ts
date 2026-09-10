/**
 * Deferred grade categories, in two classes, distinguished in code (0045).
 *
 * 0045 defers five categories from M2's gate. They are **not the same kind of
 * deferral**, and collapsing them is how `narrowing` reached its current state:
 *
 * | class | meaning | deferring is |
 * |---|---|---|
 * | `emits-but-unscored` | the model makes claims here and nothing checks them | **a tracked risk.** A wrong value is silent and reaches the store |
 * | `emits-nothing` | the model makes no claim here at all | safe. There is no output to be silently wrong |
 *
 * ### The transition is the thing this exists to catch
 *
 * A category in `emits-nothing` is safe *because it emits nothing*, and that
 * is a fact about today's model rather than a property of the category. The
 * moment infer starts emitting for one, the deferral silently changes meaning:
 * unchecked claims begin reaching codegen under a declaration that says they
 * cannot. **That is exactly how `narrowing` got here** — nobody decided to
 * ship 43 unscored narrowings, the emission arrived and the deferral did not
 * move.
 *
 * So a category declared `emits-nothing` that starts emitting **fails the
 * gate** until it is either scored or explicitly re-declared as
 * `emits-but-unscored` with a reason. Re-declaring is cheap and is a decision
 * somebody makes; drifting is free and is a decision nobody makes.
 *
 * ### The counters are gates too
 *
 * Each counter reads the model and nothing else, so it can be driven without a
 * truth side or a crawl. That matters more than it looks: **a broken counter
 * reads `0` and fails open** — the category stays in `emits-nothing` forever
 * and the transition guard never fires. So every counter has a test that
 * drives it to a *non-zero* value on a synthetic model, and `narrowing` and
 * `entity-narrowing` are asserted on the same model to prove they are not the
 * same counter twice (they read `NarrowingRecord` on different paths, and one
 * counter covering both would report 43 for each and collapse the classes).
 */

import type { GradeCategoryId } from './grade-contract.js';

export type DeferralKind = 'emits-but-unscored' | 'emits-nothing';

export interface Deferral {
  readonly category: GradeCategoryId;
  readonly kind: DeferralKind;
  /** Why it cannot be scored on this target. */
  readonly reason: string;
  /**
   * What ends the deferral, for `emits-but-unscored` only.
   *
   * An event in the work rather than a date, and — per 0045 §4 — one with a
   * gate behind it, because an expiry nobody watches for is the manifest-claim
   * shape this repository keeps finding.
   */
  readonly expiry?: string;
}

/**
 * M2's deferrals, as accepted in 0045.
 *
 * The standing condition on all of them: **a second target is the only thing
 * that supplies `narrowing`'s truth side.** This table defers the question and
 * does not answer it.
 */
export const DEFERRALS: readonly Deferral[] = [
  {
    category: 'narrowing',
    kind: 'emits-but-unscored',
    reason:
      'the document declares zero formats in 368KB, so precision is unscoreable, and recall is over the divergence cap — 4 of 9 scored slots against 0.45, which the grader itself reports as the document being unfit for this category. The model emits 43 date-time narrowings against 55 scorable slots and nothing checks any of them.',
    expiry:
      'codegen seeding the mock store from response schemas. §8 seeds from captured responses, so that is the moment an unchecked narrowing reaches a generated environment — gated by assessSeedExpiry, not left to memory.',
  },
  {
    category: 'entity-narrowing',
    kind: 'emits-nothing',
    reason: 'the model emits no enum narrowing on any paired entity field (graded 0/0). Distinct from `narrowing`: same record type, different path.',
  },
  {
    category: 'identifier',
    kind: 'emits-nothing',
    reason: 'not derived. §7.4 reads foreign keys from identifier.pathParamOf and no producer writes it, so the cost is a missing capability, visible as absence.',
  },
  {
    category: 'entity-relation',
    kind: 'emits-nothing',
    reason: 'Swagger 2.0 declares no scalar foreign keys and RelationSchema cannot express the embedded associations it does declare (0023 §3.2). The model emits no relation.',
  },
  {
    /**
     * **Re-declared, because the gate caught this on its first real run.**
     *
     * 0045 filed this `emits-nothing` on the strength of the grader reading
     * `vacuous 0/0` — and that denominator is *in-universe* synthesized
     * endpoints, not emitted ones. §7.6 binds 5 controls to `href` targets
     * that are SPA routes outside `/api/v1`, so they score nothing and exist
     * anyway. Reading a filtered denominator as an emission count is the
     * mistake the two classes exist to prevent, and it was made in the
     * document that introduced them.
     */
    category: 'synthesized-endpoint',
    kind: 'emits-but-unscored',
    reason:
      'the §7.6 ranking binds 5 controls, all by `href` to SPA routes outside the /api/v1 universe, so the category scores 0/0 while the model carries 5 claims. §8 implements a bound-from-control endpoint against the store, so these reach codegen unchecked — and 0015 calls bound-from-control the highest-hallucination-risk claim in the model.',
    expiry:
      'codegen implementing bound-from-control endpoints (§8), which is the same event as narrowing\'s in a different place: the moment an unscored claim becomes a route in a generated environment. Until then the 5 bindings sit in the model and nothing acts on them.',
  },
];

/** A JSON-schema-ish node, walked structurally rather than by type import. */
interface WalkableNode {
  readonly narrowing?: unknown;
  readonly identifier?: unknown;
  readonly properties?: Record<string, WalkableNode>;
  readonly items?: WalkableNode;
  readonly additionalProperties?: boolean | WalkableNode;
  readonly anyOf?: readonly WalkableNode[];
}

const isNode = (v: unknown): v is WalkableNode => typeof v === 'object' && v !== null;

/** Every node in a schema tree, including the root. Cycles are impossible; the schema is a tree. */
function* walkNodes(root: unknown): Generator<WalkableNode> {
  if (!isNode(root)) return;
  yield root;
  for (const child of Object.values(root.properties ?? {})) yield* walkNodes(child);
  if (root.items !== undefined) yield* walkNodes(root.items);
  if (isNode(root.additionalProperties)) yield* walkNodes(root.additionalProperties);
  for (const alt of root.anyOf ?? []) yield* walkNodes(alt);
}

/** The model shape each counter needs, structurally — so a test can hand it a literal. */
export interface EmissionSource {
  readonly operations?: readonly {
    readonly discovery?: { readonly kind?: string };
    readonly requestSchema?: unknown;
    readonly responses?: readonly { readonly schema?: unknown }[];
  }[];
  readonly entities?: readonly {
    readonly fields?: readonly { readonly narrowing?: unknown }[];
    readonly relations?: readonly unknown[];
  }[];
}

/**
 * What the model claims, per deferred category, read from the model alone.
 *
 * Independent of the truth on purpose: whether a claim is *checkable* is the
 * truth's business, and whether one was *made* is the model's. Conflating them
 * is what let a category be called safe-to-defer on the strength of a `0/0`
 * that was really a statement about the document.
 */
export function countEmissions(model: EmissionSource): Record<string, number> {
  const operationNodes = function* () {
    for (const op of model.operations ?? []) {
      yield* walkNodes(op.requestSchema);
      for (const response of op.responses ?? []) yield* walkNodes(response.schema);
    }
  };
  let narrowing = 0;
  let identifier = 0;
  for (const node of operationNodes()) {
    if (node.narrowing !== undefined && node.narrowing !== null) narrowing += 1;
    if (node.identifier !== undefined && node.identifier !== null) identifier += 1;
  }
  let entityNarrowing = 0;
  let entityRelation = 0;
  for (const entity of model.entities ?? []) {
    for (const field of entity.fields ?? []) {
      if (field.narrowing !== undefined && field.narrowing !== null) entityNarrowing += 1;
    }
    entityRelation += (entity.relations ?? []).length;
  }
  return {
    narrowing,
    identifier,
    'entity-narrowing': entityNarrowing,
    'entity-relation': entityRelation,
    'synthesized-endpoint': (model.operations ?? []).filter(
      (o) => o.discovery?.kind === 'bound-from-control',
    ).length,
  };
}

export interface DeferralFinding {
  readonly category: GradeCategoryId;
  readonly problem: 'class-changed' | 'deferral-unexercised' | 'undeclared-expiry';
  readonly detail: string;
}

/**
 * Whether every deferral still describes the model it defers.
 *
 * Takes both sides as parameters — §13's rule, and here it is load-bearing
 * twice over, because the counters this compares against are themselves the
 * thing most likely to be wrong.
 */
export function assessDeferrals(input: {
  readonly deferrals: readonly Deferral[];
  readonly emissions: Readonly<Record<string, number>>;
}): DeferralFinding[] {
  const findings: DeferralFinding[] = [];
  for (const deferral of input.deferrals) {
    const emitted = input.emissions[deferral.category];
    if (emitted === undefined) {
      findings.push({
        category: deferral.category,
        problem: 'class-changed',
        detail: `${deferral.category} is deferred and nothing counts what it emits, so its class is a claim nobody can check. Every deferral needs a counter.`,
      });
      continue;
    }
    if (deferral.kind === 'emits-nothing' && emitted > 0) {
      findings.push({
        category: deferral.category,
        problem: 'class-changed',
        detail: `${deferral.category} is declared emits-nothing and the model emits ${emitted}. Deferring it was safe only while there was no claim to be wrong about; there is now. Score it, or re-declare it emits-but-unscored with a reason and an expiry — the point is that somebody decides rather than that it drifts.`,
      });
    }
    if (deferral.kind === 'emits-but-unscored') {
      if (emitted === 0) {
        // The mirror, and this repository always wants it: a tracked risk that
        // never materialised is a declaration resting on nothing, exactly like
        // an exemption that never fires.
        findings.push({
          category: deferral.category,
          problem: 'deferral-unexercised',
          detail: `${deferral.category} is declared emits-but-unscored and the model emits nothing. Either it moved to emits-nothing, or the counter is broken — and a counter reading zero is the failure this table exists to catch, so it is not the reading to trust first.`,
        });
      }
      if ((deferral.expiry ?? '').trim().length === 0) {
        findings.push({
          category: deferral.category,
          problem: 'undeclared-expiry',
          detail: `${deferral.category} carries a tracked risk with no expiry. A deferral with no end is a decision to ship it.`,
        });
      }
    }
  }
  return findings;
}

/**
 * `narrowing`'s expiry, as a gate rather than a note (0045 §4, ruling).
 *
 * An event-based expiry is right and an event nobody watches for is the
 * manifest-claim shape: a condition written down, never checked, and true or
 * false without anyone finding out. So the event is detected instead of
 * remembered.
 *
 * The event is **codegen seeding the mock store from response schemas**. §8:
 * "Seeded from `seeds/<seed>.json`, generated from real captured responses
 * after scrubbing." So the trigger is a seed artifact existing at all: while
 * `narrowing` is unscored, a run that produces one has put an unchecked
 * narrowing into a generated environment, and that is the thing the deferral
 * promised would not happen.
 *
 * **Which view supplies `seedFiles` matters and is not free.** `/envs/*​/` is
 * gitignored, so a seed file is invisible to `git status` by construction —
 * the caller must walk the **filesystem**, and a caller reading git's view
 * would find nothing and report clean forever. That is §13's two-views rule,
 * and it has produced three separate defects in this repository already.
 */
export interface SeedExpiryInput {
  /** Seed artifacts found on disk, repo-relative. Filesystem view, never git's. */
  readonly seedFiles: readonly string[];
  /** Whether `narrowing` currently has a scored, non-vacuous metric. */
  readonly narrowingScored: boolean;
}

export interface SeedExpiryFinding {
  readonly problem: 'expiry-fired';
  readonly detail: string;
}

export function assessSeedExpiry(input: SeedExpiryInput): SeedExpiryFinding | null {
  if (input.seedFiles.length === 0) return null;
  if (input.narrowingScored) return null;
  return {
    problem: 'expiry-fired',
    detail:
      `codegen produced ${input.seedFiles.length} seed artifact(s) (${input.seedFiles.slice(0, 3).join(', ')}` +
      `${input.seedFiles.length > 3 ? ', …' : ''}) while \`narrowing\` is still unscored. §8 seeds the store from ` +
      'response schemas, so the 43 narrowings nothing checks are now shaping a generated environment — a wrong ' +
      'one makes valid states of the real system unrepresentable in the clone, silently, on every trajectory ' +
      'touching the field (§7.5). 0045 deferred `narrowing` on the explicit condition that this had not happened ' +
      'yet. Score it, or re-defer it deliberately.',
  };
}
