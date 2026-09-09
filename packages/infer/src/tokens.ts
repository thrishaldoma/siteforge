/**
 * Piece 4a — design tokens, by clustering what was actually painted.
 *
 * §7.1: cluster every captured colour, spacing, radius, shadow and font size
 * into a small set, snapping near-identical values together — "a site with
 * `#1a73e8` and `#1a73e9` has one brand blue and a typo". The caps are schema,
 * not advice (≤16 colours, ≤8 spacing steps), and §8 names the symptom of
 * failing: `bg-[#1a73e8]` scattered through the generated code.
 *
 * Frequency decides which values survive the cap, and the frequency is over
 * **style-table entries weighted by how many nodes use them** — the table is
 * already deduplicated by declaration set, so counting rows would make a style
 * used by four hundred nodes weigh the same as one used by a single divider.
 */
import type { DesignTokens } from '@siteforge/schema';

type DesignToken = DesignTokens['colors'][number];
import type { CapturedRoute } from './capture.js';

/** Colour channels, or null for a value that is not a colour we can compare. */
function rgb(value: string): [number, number, number, number] | null {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec(value.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
}

/**
 * Near enough to be the same colour.
 *
 * A per-channel distance rather than a perceptual one: the case §7.1 names is a
 * typo, one digit apart, and a perceptual metric would also merge colours a
 * designer chose to distinguish. Fully transparent values never merge with
 * opaque ones — `rgba(0,0,0,0)` is "no colour", not black.
 */
const SNAP_DISTANCE = 8;

export function sameColour(a: string, b: string): boolean {
  const x = rgb(a);
  const y = rgb(b);
  if (x === null || y === null) return a === b;
  if ((x[3] === 0) !== (y[3] === 0)) return false;
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) <= SNAP_DISTANCE;
}

interface Counted {
  readonly value: string;
  count: number;
  readonly snappedFrom: Set<string>;
}

/** Cluster values by `same`, keeping the most-used spelling as the token value. */
export function cluster(
  values: ReadonlyArray<{ value: string; count: number }>,
  same: (a: string, b: string) => boolean,
): Counted[] {
  const clusters: Counted[] = [];
  for (const { value, count } of [...values].sort((a, b) => b.count - a.count)) {
    const hit = clusters.find((c) => same(c.value, value));
    if (hit === undefined) {
      clusters.push({ value, count, snappedFrom: new Set([value]) });
    } else {
      hit.count += count;
      hit.snappedFrom.add(value);
    }
  }
  return clusters.sort((a, b) => b.count - a.count);
}

const PROPERTIES = {
  colors: ['color', 'background-color', 'border-top-color', 'border-bottom-color'],
  spacing: ['padding-top', 'padding-bottom', 'margin-top', 'margin-bottom', 'gap'],
  radii: ['border-top-left-radius', 'border-bottom-right-radius'],
  shadows: ['box-shadow'],
  fontSizes: ['font-size'],
} as const;

const CAPS = { colors: 16, spacing: 8, radii: 6, shadows: 6, fontSizes: 10 } as const;

const NOT_A_TOKEN = new Set(['', 'none', 'auto', 'normal', '0px', 'rgba(0, 0, 0, 0)']);

/**
 * A name for a token, from its rank rather than its value.
 *
 * `brand`/`ink` naming needs semantics this stage does not have, and inventing
 * one would be the `Div7` failure with better spelling. A rank is honest: it
 * says "the most-used colour" and nothing more.
 */
const nameFor = (kind: string, index: number): string => `${kind}-${index + 1}`;

export function inferTokens(routes: readonly CapturedRoute[]): {
  colors: DesignToken[];
  spacing: DesignToken[];
  radii: DesignToken[];
  shadows: DesignToken[];
  fontSizes: DesignToken[];
} {
  /** How many nodes use each style row, so a token's weight is nodes not rows. */
  const weights = new Map<string, number>();
  for (const route of routes) {
    // nodeId → styleId, so a style shared by four hundred nodes weighs four
    // hundred. Counting table rows instead would make a divider's border as
    // important as the body background.
    for (const styleId of Object.values(route.styles.assignments)) {
      weights.set(styleId, (weights.get(styleId) ?? 0) + 1);
    }
  }

  const collect = (properties: readonly string[]): Array<{ value: string; count: number }> => {
    const counts = new Map<string, number>();
    for (const route of routes) {
      for (const row of route.styles.table) {
        const weight = weights.get(row.styleId) ?? 1;
        for (const property of properties) {
          const value = row.declarations[property];
          if (value === undefined || NOT_A_TOKEN.has(value)) continue;
          counts.set(value, (counts.get(value) ?? 0) + weight);
        }
      }
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }));
  };

  const build = (kind: keyof typeof PROPERTIES): DesignToken[] =>
    cluster(collect(PROPERTIES[kind]), kind === 'colors' ? sameColour : (a, b) => a === b)
      .slice(0, CAPS[kind])
      .map((c, i) => ({
        name: nameFor(kind === 'fontSizes' ? 'text' : kind.replace(/s$/, ''), i),
        value: c.value,
        snappedFrom: [...c.snappedFrom].sort(),
        usageCount: c.count,
      }));

  return {
    colors: build('colors'),
    spacing: build('spacing'),
    radii: build('radii'),
    shadows: build('shadows'),
    fontSizes: build('fontSizes'),
  };
}
