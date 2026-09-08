/**
 * `assets/index.json` — every byte the page fetched, content-addressed.
 *
 * §5: "originalUrl → {localPath, sha256, mime, referencedBy[]}". Keyed by original
 * URL because that is the actual access pattern: codegen rewrites references by
 * looking up the URL it found in the DOM or the CSSOM.
 *
 * §6: "persist **every** response body content-addressed by sha256. Rewrite
 * nothing yet." So this index is descriptive; rewriting happens in codegen.
 */
import { z } from 'zod';
import {
  AssetIdSchema,
  EndpointIdSchema,
  NodeIdSchema,
  RouteIdSchema,
  Sha256Schema,
  StyleIdSchema,
} from './primitives.js';
import { artifactEnvelope } from './artifact.js';

export const AssetKindSchema = z.enum([
  'document',
  'stylesheet',
  'script',
  'image',
  'font',
  'video',
  'audio',
  'json',
  'other',
]);

/**
 * Where an asset is referenced from.
 *
 * Typed rather than a bag of strings, because codegen must rewrite each kind of
 * reference differently — a DOM `src` attribute, a `url()` inside a CSS
 * declaration, and an `@font-face` source are three different rewrites.
 */
export const AssetReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('dom-attribute'),
    routeId: RouteIdSchema,
    nodeId: NodeIdSchema,
    attribute: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('css-url'),
    routeId: RouteIdSchema,
    /** The deduped style object containing the `url()`, when it is a computed value. */
    styleId: StyleIdSchema.optional(),
    /** The stylesheet the rule came from, when it is a source rule. */
    stylesheetHref: z.string().optional(),
    property: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('font-face'),
    routeId: RouteIdSchema,
    family: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('network'),
    routeId: RouteIdSchema,
    endpointId: EndpointIdSchema,
  }),
  z.strictObject({
    kind: z.literal('asset-import'),
    /** e.g. a stylesheet that `@import`s another, or references a font. */
    fromAssetId: AssetIdSchema,
  }),
]);

export const AssetEntrySchema = z.strictObject({
  assetId: AssetIdSchema,
  /** As requested on the wire. Query strings retained — they can be significant. */
  originalUrl: z.string().min(1),
  /** Relative to the capture root: `assets/files/<sha256>.<ext>` (§5). */
  localPath: z
    .string()
    .regex(/^assets\/files\/[0-9a-f]{64}\.[A-Za-z0-9]+$/, 'expected assets/files/<sha256>.<ext>'),
  sha256: Sha256Schema,
  mime: z.string().min(1),
  bytes: z.int().nonnegative(),
  kind: AssetKindSchema,
  status: z.int().min(100).max(599),
  /** False for anything not on the target origin — relevant to §11's third-party rules. */
  sameOrigin: z.boolean(),
  /** Served from the browser cache rather than the network during this crawl. */
  fromCache: z.boolean(),
  referencedBy: z.array(AssetReferenceSchema),
});

export const AssetIndexSchema = z.strictObject({
  ...artifactEnvelope('asset-index'),
  /** §5's `originalUrl → {...}` mapping, literally. */
  byUrl: z.record(z.string().min(1), AssetEntrySchema),
  stats: z.strictObject({
    assetCount: z.int().nonnegative(),
    /** Distinct sha256s. Lower than `assetCount` when one file is served at several URLs. */
    distinctFiles: z.int().nonnegative(),
    totalBytes: z.int().nonnegative(),
  }),
});

export type AssetKind = z.infer<typeof AssetKindSchema>;
export type AssetReference = z.infer<typeof AssetReferenceSchema>;
export type AssetEntry = z.infer<typeof AssetEntrySchema>;
export type AssetIndex = z.infer<typeof AssetIndexSchema>;
