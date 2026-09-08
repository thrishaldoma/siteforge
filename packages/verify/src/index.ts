// @siteforge/verify — Stage 4 gates.
//
// The grade gate (decision 0015) is the first thing here: infer is the first
// stage whose output cannot be checked by re-reading its input, so it is graded
// against a spec somebody else wrote. The grader is written before infer, and
// the ground-truth loader before the grader.
export * from './grade/truth/index.js';
