# 0034 — Limitations recorded against the wrong thing

*Status: accepted. Sweep + two §13 rules.*

## 1. The instance that started it

0025's Open section, verbatim:

> - **The key-value rung.** `examples` is string-only and capped at five, so the
>   observation that would settle identity outright is discarded by capture.

The heading is a **rung** — a feature being built that afternoon. The mechanism
is `inferSchema`, whose `examples` recording sat inside the `string` branch
alone, so the terminal `return { type: kind, … }` dropped the observed values of
every integer, number and boolean.

Reach, measured: **0 of 68 numeric nodes carried a value, against 273 of 324
string ones.** And §8 seeds the mock store "from real captured responses", so
every numeric field in every generated clone, on every target, was seeding from
nothing at all.

Filed as a rung's shortcoming it read as a small deferred nicety. Filed against
the mechanism it is a hole in the product. **Nothing about the text was false**
— that is what makes the failure mode worth a rule rather than a correction.

## 2. The sweep

The test is two questions: *what function is this actually in, and what else
calls that function?* Blast radius is callers of the mechanism, never occurrences
of the symptom.

### 2.1 `ENUM_TOKEN` — never recorded at all, and the largest of the four

`ENUM_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/`, in `classifyStringField`,
implementing §7.5's hard exclusion "values containing sentence-like text".

Two things about it that were not written down anywhere:

- **It excludes 161 of the 273 string fields that carry observed values — 59%.**
  Many of those are correct (URLs, free text, version strings). `"0"`, `"1"`,
  `"2"` are not: a numeric-coded domain is not sentence-like by any reading, and
  it fails on the first character.
- **It runs *before* the UI-constraint branch.** §7.5 ranks a `<select>` first
  and calls it "ground truth about the domain, and the only evidence that is" —
  and a hard exclusion placed above it means **a perfect `<select>` of
  `<option value="0">` can never narrow anything, on any target, regardless of
  evidence.**

This is §13's stand-in family: a regex correlating with "sentence-like" until
the day it does not, exactly as substring-for-token and segment-count-for-shape
did. §7.5's own text does say hard exclusions apply "regardless of the above", so
the ordering is specified rather than a bug — what was missing is that anyone
knew what it cost. Recorded, not changed: reordering it is a §7.5 semantic
change that could produce a wrong enum, which is the silent failure the whole
section exists to prevent.

### 2.2 `classifyStringField` is string-only — mis-scoped by me, last turn

0029 §9 recorded it against `repeat_mode`, one field on one target. The
mechanism is `inferSchema` calling the ladder only in its `string` branch, and
the reach is **every integer, number and boolean domain, on every target,
forever** — the same 68 nodes as §1, and structurally every coded enum in every
API.

The same mis-scoping as 0025, in the same file, one turn later. That is the
argument for the rule: knowing about the failure did not prevent it, because the
pull comes from *where you are standing when you write it down*.

### 2.3 The probe vocabulary is `click` alone

0030 §2.1 recorded it against binding — the feature being designed. The
mechanism is `runProbe`, whose only verb is `locator.click()`.

Reach on this target, counted from the captured DOM: **13 controls** need a verb
that does not exist — 6 `<select>`, 2 `<textarea>`, 2 `input[file]`, 2
`input[text]`, 1 `input[time]`. Checkboxes are excluded because a click does
exercise them.

Structurally it is every form control that is not a button or a checkbox, on
every target. §6 calls the probe tuple set "the functional specification", so a
missing verb is not a gap in binding — it is a gap in the specification the
behavioural gate replays.

### 2.4 `MAX_ATTEMPTS_PER_ROUTE` — correctly scoped already

Recorded against the driver, with the number beside it, and its gap text says
"this is a limit of the driver, not a property of the target". Included here
because a sweep that finds only positives is not a sweep: this is what a
correctly-scoped limitation looks like, and it is the control for the other
three.

## 3. Ranked by reach, which is the point of measuring

| limitation | scope as recorded | mechanism | reach |
|---|---|---|---|
| `ENUM_TOKEN` before the UI branch | *(never recorded)* | `classifyStringField` | 161 of 273 string fields; **no** numeric-coded domain is narrowable on any target |
| `examples` string-only | "the key-value rung" | `inferSchema` | 68 of 68 numeric nodes; every numeric field in every clone **(fixed, 0029 §5)** |
| ladder is string-only | "`repeat_mode`" | `inferSchema` | every integer domain, every target |
| probe verb is `click` | "binding" | `runProbe` | 13 controls here; every non-button form control anywhere |
| `MAX_ATTEMPTS_PER_ROUTE` | the driver, with a count | the probe loop | 663 declined, already stated |

The ranking is the argument for measuring rather than asserting. Read as prose,
all five sound like roughly equal deferred niceties. Measured, one of them was
the seed data of every generated clone.

## 4. Rules added to §13

Two, both from this turn, and deliberately in different places:

- **"A limitation is recorded against the mechanism it lives in, with its reach
  measured."** Beside the vacuity-cause taxonomy, because both are about
  recording a fact so the next reader goes to the right package.
- **"A chokepoint enforces only what it can reach from where it sits."** Beside
  the `.gitignore`-is-not-a-scope-boundary rule, because they are the same shape:
  one is a guard whose scope comes from the wrong *view*, the other a guard whose
  scope comes from the wrong *moment*. See 0035.

## 5. Open

- The `ENUM_TOKEN` ordering. Whether §7.5's hard exclusions should really
  outrank its own primary evidence is a question about the specification, not
  about the code, and it is not mine to decide alone. The cost is now measured.
- A `selectOption` probe verb. §6 calls the probe set the functional
  specification, so this is larger than the binding feature it was filed under.
