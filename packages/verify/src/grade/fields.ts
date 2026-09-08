/**
 * The model side of a field comparison: `JsonSchemaNode` → addressable pointers.
 *
 * A second walker, deliberately. The truth side walks Swagger 2.0 with `$ref`
 * resolution and a cycle stop; this one walks the closed recursive subset
 * `packages/schema` defines. §13's rule about an invariant's observed side
 * applies to a grader's two sides identically — share the walk and a bug in it
 * moves both sides at once, so a wrong pointer convention scores 1.0 instead of
 * failing.
 *
 * What the two **do** share is `MAX_FIELD_DEPTH`, and that sharing is required
 * rather than tolerated: the depth is not a property of either walker, it is the
 * boundary of what is comparable. Two walkers with different cut-offs would
 * charge infer for fields the truth side declined to enumerate. A test walks the
 * same six-deep shape — with an array in it, because `/[]` costs a level and
 * that is exactly where two independent implementations disagree — through both
 * vocabularies and asserts the pointer sets are equal.
 */
import type { JsonSchemaNode } from '@siteforge/schema';
import { MAX_FIELD_DEPTH } from './truth/gitea.js';

/** One addressable claim the model makes about a payload's shape. */
export interface ModelField {
  /** RFC 6901 over the value, with `/[]` for an array element. */
  readonly pointer: string;
  readonly node: JsonSchemaNode;
}

const escape = (name: string): string => name.replace(/~/g, '~0').replace(/\//g, '~1');

function walk(node: JsonSchemaNode, pointer: string, depth: number, out: ModelField[]): void {
  if (depth > MAX_FIELD_DEPTH) return;
  // The root itself is not a field: `''` addresses the whole body, which is a
  // claim about the endpoint rather than about a field in it.
  if (pointer !== '') out.push({ pointer, node });

  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes('array')) {
    if (node.items !== undefined) walk(node.items, `${pointer}/[]`, depth + 1, out);
    return;
  }
  if (node.properties === undefined) return;
  for (const [name, child] of Object.entries(node.properties)) {
    walk(child, `${pointer}/${escape(name)}`, depth + 1, out);
  }
}

/** Every field the model claims, in the pointer language the truth speaks. */
export function modelFieldPointers(root: JsonSchemaNode | null): ModelField[] {
  if (root === null) return [];
  const out: ModelField[] = [];
  walk(root, '', 0, out);
  return out;
}

/**
 * Does the model's type agree with the spec's?
 *
 * The two normalisations are 0015 §3's, fixed in the contract's own words before
 * any score existed so they cannot be argued after seeing one:
 *
 *   - `integer` counts as a match for `number`;
 *   - a nullable type matches its non-nullable counterpart **where the spec
 *     marks the field optional** — a nullable claim about a required field is a
 *     different claim and stays a miss.
 *
 * Everything else is a miss, including a union that merely contains the right
 * member: `['string','object']` is not a claim that the field is a string.
 */
export function typeAgrees(
  node: JsonSchemaNode,
  truth: { type: string; required: boolean },
): boolean {
  const claimed = Array.isArray(node.type) ? node.type : [node.type];
  // `nullable` and a `null` union member say the same thing; neither is the
  // field's type. Separating them here is what makes the second normalisation a
  // rule about optionality rather than about spelling.
  const nullable = node.nullable === true || claimed.some((t) => t === 'null');
  const declared = claimed.filter((t) => t !== 'null');
  if (declared.length !== 1) return false;
  const model = declared[0]!;
  if (nullable && truth.required) return false;

  if (model === truth.type) return true;
  const numeric = new Set(['integer', 'number']);
  return numeric.has(model) && numeric.has(truth.type);
}
