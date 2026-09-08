/**
 * Whether a route or an endpoint is gated — and what was actually observed.
 *
 * §6 requires capture to "record which routes require auth ... because the clone
 * must reproduce the redirect-to-login behavior." The first implementation
 * recorded that as a boolean, and rung 3 showed why a boolean cannot carry it:
 * every endpoint came back `requiresAuth: false`, not because anonymous access
 * was observed to work, but because a 401 was never *seen*. The anonymous context
 * is redirected to `/login` before any XHR runs, so the crawl had no evidence
 * either way — and a boolean has nowhere to put "no evidence" except `false`.
 *
 * `false` is the expensive direction. §8 turns this field into the mock backend's
 * session check and §10 builds auth tasks on it: a clone that demands a login the
 * original did not costs an agent one step, while a clone that permits anonymous
 * mutation the original blocked makes every auth task trivially bypassable and
 * every trajectory through it worthless. So the third state is not a nicety —
 * it is the difference between a wrong default and an honest one.
 *
 * The requirement is therefore **derived**, never asserted: `requiresAuth` must
 * equal `resolveAuthRequirement(authEvidence)`, which the artifact schemas check.
 * Writing `not-required` without an observation of anonymous success is not
 * discouraged here, it is unrepresentable.
 */
import { z } from 'zod';
import { ContextIdSchema } from './primitives.js';

export const AuthRequirementSchema = z.enum(['required', 'not-required', 'unknown']);

/**
 * One observation bearing on whether auth is required.
 *
 * Every member records the context it came from, so a claim about anonymous
 * behaviour can be checked against a context that is actually anonymous — see
 * `CaptureModelSchema`, which rejects anonymous evidence sourced from a
 * signed-in crawl.
 */
export const AuthEvidenceSchema = z.discriminatedUnion('kind', [
  /** Settles `required`. The server itself said so. */
  z.strictObject({
    kind: z.literal('unauthorized-status'),
    status: z.union([z.literal(401), z.literal(403)]),
    observedCount: z.int().positive(),
    contextId: ContextIdSchema,
  }),
  /**
   * Settles `required`. An anonymous request was bounced to a login route —
   * §6's "what an anonymous visitor gets", observed rather than assumed.
   */
  z.strictObject({
    kind: z.literal('anonymous-redirect-to-login'),
    to: z.string().min(1),
    status: z.int().min(300).max(399),
    contextId: ContextIdSchema,
  }),
  /** Settles `not-required`. It was tried without a session and it worked. */
  z.strictObject({
    kind: z.literal('anonymous-success'),
    status: z.int().min(200).max(299),
    observedCount: z.int().positive(),
    contextId: ContextIdSchema,
  }),
  /**
   * Settles nothing. Every observed request carried a credential — but a crawl
   * that only ever ran signed in would produce exactly this for an endpoint open
   * to the world. It leans toward `required` and is strictly better than
   * recording `false`, which is why it is kept rather than dropped.
   */
  z.strictObject({
    kind: z.literal('all-observations-authenticated'),
    header: z.enum(['cookie', 'authorization']),
    observedCount: z.int().positive(),
  }),
  /**
   * Settles nothing. The control appears in an authenticated context and not in
   * an anonymous one. Contexts (decision 0004) are what make this observable at
   * all; before them there was no second crawl to diff against.
   */
  z.strictObject({
    kind: z.literal('present-only-in-authenticated-context'),
    presentIn: ContextIdSchema,
    absentFrom: ContextIdSchema,
  }),
]);

/**
 * Which verdict each kind of evidence settles, if any.
 *
 * A table rather than a chain of `if`s because it is also the documentation:
 * exactly two kinds settle `required`, exactly one settles `not-required`, and
 * the corroborating kinds settle nothing no matter how many of them accumulate.
 */
export const AUTH_EVIDENCE_SETTLES = {
  'unauthorized-status': 'required',
  'anonymous-redirect-to-login': 'required',
  'anonymous-success': 'not-required',
  'all-observations-authenticated': null,
  'present-only-in-authenticated-context': null,
} as const satisfies Record<AuthEvidence['kind'], 'required' | 'not-required' | null>;

/**
 * The verdict a set of observations supports.
 *
 * Conflict resolves to `required`: an endpoint that 401s once and succeeds
 * anonymously once is gated by something conditional, and the safe reading of a
 * contradiction is the one that does not hand an agent a free bypass.
 */
export function resolveAuthRequirement(
  evidence: readonly AuthEvidence[],
): z.infer<typeof AuthRequirementSchema> {
  let notRequired = false;
  for (const item of evidence) {
    const settles = AUTH_EVIDENCE_SETTLES[item.kind];
    if (settles === 'required') return 'required';
    if (settles === 'not-required') notRequired = true;
  }
  return notRequired ? 'not-required' : 'unknown';
}

/**
 * How codegen (§8) resolves the third state when it has to emit a real check.
 *
 * `unknown` fails **closed, full stop**. There is deliberately no `isMutation`
 * parameter: the asymmetry that once justified one only holds if you compare
 * the wrong two things.
 *
 * The costs are not symmetric between reads and writes — they are the same
 * shape at different volumes. A wrongly-gated read costs an agent one login
 * step, and it is visible: the trajectory shows a login the original did not
 * need. A wrongly-public gated read is invisible and makes every §10 auth task
 * that reads through it bypassable, so the trajectory reads as success while
 * proving nothing. Failing open is the option whose damage cannot be seen.
 *
 * This is safe rather than merely cautious because `unknown` is narrow.
 * §6 re-issues every distinct GET anonymously, so a read that is genuinely
 * public gets `anonymous-success` evidence and resolves to `not-required` on
 * that evidence — it never reaches this function. `unknown` means the crawl
 * never saw the endpoint answer an anonymous caller *and* never saw a 401. A
 * read that shallow is one nobody has grounds to publish.
 *
 * §8's stage report lists the endpoints resolved this way. A large `unknown`
 * set means a shallow anonymous crawl, and the operator wants to see that
 * rather than have a permissive default hide it.
 */
export function resolveAuthForCodegen(
  requirement: z.infer<typeof AuthRequirementSchema>,
): boolean {
  return requirement !== 'not-required';
}

export type AuthRequirement = z.infer<typeof AuthRequirementSchema>;
export type AuthEvidence = z.infer<typeof AuthEvidenceSchema>;
