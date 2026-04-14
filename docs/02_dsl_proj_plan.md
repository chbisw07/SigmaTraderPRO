# Sigma Rule DSL — Project Plan and Versioned Roadmap

Status: Draft (execution-oriented)  
Last updated: 2026-04-14  
Source of truth: `docs/dsl.md` (thesis TOC + architectural intent)

---

## 1. Executive Summary

Sigma Rule DSL is a **Python-shaped, deterministic, rule-based language + runtime foundation** for equities and options trading systems (India-focused: NSE/BSE). It is **not** general-purpose Python and does **not** execute broker orders directly. The DSL produces **deterministic decisions** (signals / intents / constraints) and an **execution plan** interface that can later be integrated into trading platforms.

This plan turns `docs/dsl.md` into an **incremental product roadmap** where **every version enables real user activity** (author rules → validate → run deterministically → inspect traces → reuse rule packs), while progressively retiring architectural risks: parsing/typing correctness, deterministic evaluation, replay parity, option-chain modeling, and action-verb safety.

**Recommended MVP target:** **v0.4 “Equity Rule Runner + Trace + Replay”** (author rules, validate, run against historical OHLCV bars, see deterministic pass/fail and decision trace; package rules as a reusable library). This is the first milestone that feels like a usable “product” rather than a framework.

---

## 2. How This Plan Derives from `dsl.md`

`docs/dsl.md` is the source of truth for the DSL philosophy, constraints, and architecture. This plan **does not redefine** those; it sequences delivery.

### 2.1 Non-negotiable guardrails (directly from `dsl.md`)
- **Python-shaped syntax** (indentation, familiar readability), **but NOT Python** (Ch 10–11).
- **Deterministic execution and replayability** (Ch 6).
- **Declarative, rule-based**: “rules produce decisions, not programs” (Ch 10, Ch 13).
- **No loops, no unrestricted functions, no arbitrary assignments** (Ch 2, Ch 10–14).
- **Actions expressed as verbs**; effects are **planned**, not executed (Ch 15, Ch 13.5).
- **Separation of concerns is mandatory**: signal → intent → execution planning → risk enforcement (Ch 4, Ch 17–18).
- **No direct broker execution inside DSL**; broker adapters are outside the DSL boundary (Ch 2.6.3, Ch 17.7, Ch 25).

### 2.2 Phase-to-chapter mapping (the backbone of sequencing)
- **Authoring + Validation** → Ch 10–12, Ch 21, Appendix A/B/E
- **Deterministic evaluation + trace** → Ch 13–14, Ch 6, Ch 21.6
- **Domain model + data ingestion** → Ch 7, Ch 3 (as needed), Appendix F
- **Indicators/features** → Ch 16, Appendix D
- **Execution planning** → Ch 17 (plan generation only)
- **Risk enforcement** → Ch 18 (fail-closed constraints)
- **Backtest/replay parity** → Ch 19, Ch 6.5
- **Option chain + options context** → Ch 8, Ch 14.2, Ch 16.3–16.4
- **Library reuse + governance** → Ch 23, Ch 11.7, Ch 25
- **AI-assisted (guarded)** → Ch 20 (later; never in the hot path)

### 2.3 Product slices (what users touch early)
Even in early versions, every increment includes at least one of:
- a CLI command that a user runs (`validate`, `run`, `explain`, `replay`),
- sample rule packs + example datasets,
- deterministic outputs (signals / intents) with traceable reasons,
- reuse mechanics (module import / rule pack packaging).

---

## 3. Scope Boundary (based on thesis)

### In scope (this project)
- DSL surface + grammar + compiler pipeline: parsing, AST, type checking, profile compliance (Ch 10–12, Ch 21).
- Deterministic semantics and evaluation engine with explainability trace (Ch 13–14, Ch 6, Ch 21.6).
- Domain modeling sufficient for equities + options contexts (Ch 7–8, Ch 14.2).
- Deterministic indicator/feature registry (Ch 16).
- Execution planning outputs (plans), not broker execution (Ch 17).
- Risk enforcement rules that constrain/deny plans and record reasons (Ch 18).
- Backtesting/simulation/replay framework for parity and reproducibility (Ch 19, Ch 6.5).
- Rule library packaging, reuse, and versioning (Ch 23, Ch 11.7).
- Guarded AI assist workflows that **generate suggestions** but never execute trades (Ch 20).

### Interfaces out of scope (but defined as contracts)
- Market data adapter contract (Ch 25.1.1).
- Order adapter contract (Ch 25.1.2) — **outside** DSL; only plan interfaces in scope.

---

## 4. Non-Goals

- A full custom IDE/editor from day one (Ch 21.5 is later).
- Live broker integration inside DSL (explicitly prohibited; Ch 2.6.3).
- General-purpose programming: loops, arbitrary variables, arbitrary functions (explicitly prohibited; Ch 2.6.1–2.6.2).
- “One DSL to rule everything” across asset classes beyond equities/options (futures/commodities only as future; Ch 28.3.1).
- Premature performance work (Ch 26 exists, but only after correctness + determinism are solid).
- AI auto-trading or AI-driven real-time rule decisions (Ch 20 is bounded and guarded).

---

## 5. Product Delivery Philosophy

### 5.1 Definition of “product” for this project
A version is a product when a user can:
- **author** a rule file,
- **validate** it (clear diagnostics),
- **run** it deterministically against some data source (even mock/historical),
- **observe outcomes + reasons**, and
- **reuse**/package rule packs to build up a library.

### 5.2 Iteration strategy
- Prefer **vertical slices**: small language surface + runner + samples + tests.
- Add **new capabilities only when the previous layer is testable and replayable**.
- Keep **language surface stable** before investing in editor/UI (Ch 21.5, Ch 22 later).
- Treat **determinism and explainability** as first-class acceptance criteria (Ch 6, Ch 4.6).

### 5.3 Work classification tags (used throughout this plan)
- **Engine**: parser, AST, type checker, evaluator, deterministic scheduler
- **Product**: end-user CLI behavior, sample rule packs, example datasets, outputs
- **Tooling/DX**: error messages, lint, formatting, trace viewer, packaging
- **Docs**: markdown docs, tutorials, reference pages
- **Tests/Correctness**: unit tests, golden traces, property tests (as appropriate)

---

## 6. Versioned Roadmap (v0.1 → v2.0)

### 6.1 Roadmap table (summary)

| Version | Phase | Primary goal | User-visible capability | Major framework work | Key risks retired | `dsl.md` chapters |
|---:|---|---|---|---|---|---|
| v0.1 | Authoring Bootstrap | “Validate rule files” | `validate` CLI with deterministic diagnostics on a small DSL subset | Lexer/parser skeleton + AST + diagnostics | Can parse safely without Python escape hatches | Ch 10–11, Ch 21.2 |
| v0.2 | Typed Authoring | “Typed rules” | Type errors + profile checks; sample rule pack compiles | Type system + validators for forbidden constructs | Prevents unsafe/ambiguous authoring | Ch 12, Ch 14, App B/E |
| v0.3 | Deterministic Evaluation (Equity) | “Run rules on bars” | `run` on OHLCV bars → signals + trace | Deterministic evaluator + trace model | Semantics are executable and explainable | Ch 13–14, Ch 6, Ch 21.6 |
| v0.4 | MVP: Equity Rule Runner | “Replayable equity screener” | `run` + `explain` + `replay` on historical CSV with stable outputs | Event log + replay + golden tests | Deterministic replay parity starts | Ch 6.5, Ch 7, Ch 19 |
| v0.5 | Indicators + Feature Registry | “Real indicators, still deterministic” | Built-in indicators (EMA/RSI/ATR/VWAP) used in rules | Indicator registry + caching/version pinning | Indicator correctness + reproducibility | Ch 16, App D |
| v0.6 | Library + Packaging | “Reusable rule packs” | `pack`/`import` rules; semantic versioning; sample library | Module/import rules + pack metadata | Reuse, governance foundations | Ch 11.7, Ch 23 |
| v1.0 | Stable Equity Product | “Credible first product” | Equity screeners + intent-style outputs + risk constraints + reports | Rule profiles (signal/intent/risk) + stable CLI UX | First “platform-ready” core | Ch 4, Ch 18, Ch 21, Ch 27 |
| v1.1 | Options Contract Context | “Option-aware rules” | `option` context: contract selection + greeks inputs (computed/pluggable) | Option instrument model + type extensions | Options correctness baseline | Ch 3.4–3.6, Ch 14.2, Ch 7 |
| v1.2 | Option Chain Context | “Chain snapshots + analytics” | `chain` context queries + basic derived metrics; deterministic chain snapshot semantics | Chain schema + snapshot atomicity + feature ops | Chain determinism + staleness handling | Ch 8, Ch 16.4 |
| v2.0 | Intent→Plan→Risk Platform | “Full separation realized” | Intent verbs + execution plan generation + strict risk enforcement + backtest parity suite | Plan IR + conflict resolution + parity harness | Integration-ready deterministic outputs | Ch 15, Ch 17–19, Ch 25 |

### 6.2 What makes each version a product (A)
This is the explicit “no framework-only releases” defense:
- **v0.1:** A user can write a `.sr` (Sigma Rule) file and get deterministic syntax diagnostics via CLI.
- **v0.2:** A user can author *typed* rule packs and be prevented from writing unsafe constructs; they can iterate quickly with meaningful compiler feedback.
- **v0.3:** A user can run rules on bar data and see deterministic pass/fail + “why” trace.
- **v0.4 (MVP):** A user can run and replay a full equity screener pipeline on historical data and compare traces across code/rule changes.
- **v0.5:** A user can write realistic indicator-based rules; results are stable due to pinned indicator versions.
- **v0.6:** A user can build a reusable rule library, import rule modules, and share/version them.
- **v1.0:** A user can operate a coherent equity rules product: signals + intents + risk constraints + reports, suitable for downstream integration.
- **v1.1:** A user can express option contract rules (expiry/strike selection, greeks-based predicates).
- **v1.2:** A user can express chain-aware rules using deterministic chain snapshots and derived chain metrics.
- **v2.0:** A user can express intent and obtain execution plans under strict risk rules, with parity testing and replay logs—ready to embed in larger platforms.

---

## 7. Phase Breakdown (mapped to thesis chapters)

### Phase A — Authoring + Validation (v0.1–v0.2)
- **Intent:** Make the language safely authorable: parseable, typed, and impossible to misuse as Python.
- **Thesis alignment:** Ch 10–12, Ch 14, Ch 21.2–21.4, Appendices A/B/E.
- **Major risks retired:** grammar ambiguity, unsafe constructs, unclear diagnostics.

### Phase B — Deterministic Evaluation + Explainability (v0.3–v0.4)
- **Intent:** Make rules executable with deterministic ordering, traces, and replay.
- **Thesis alignment:** Ch 13–14, Ch 6, Ch 21.6, Ch 19.5.
- **Major risks retired:** “it runs but we can’t explain it”, nondeterministic results, inability to debug/verify.

### Phase C — Indicators + Data Model Hardening (v0.5)
- **Intent:** Add deterministic indicator registry and stable feature computation.
- **Thesis alignment:** Ch 7, Ch 16, Appendix D/F.
- **Major risks retired:** indicator drift, inconsistent computations, missing data policies.

### Phase D — Library Reuse + Governance (v0.6)
- **Intent:** Make rule packs reusable, versioned, and importable.
- **Thesis alignment:** Ch 11.7, Ch 23, Ch 25.4.
- **Major risks retired:** unmanageable rule sprawl, lack of upgrade discipline.

### Phase E — Equity Productization (v1.0)
- **Intent:** Deliver a stable equity rules product slice with risk constraints and reporting.
- **Thesis alignment:** Ch 4, Ch 18, Ch 21, Ch 27.1, Ch 24.4 (observability basics).
- **Major risks retired:** product cohesion; “works in demos but not in usage”.

### Phase F — Options + Chain Productization (v1.1–v1.2)
- **Intent:** Add option contract context, then chain context, with deterministic semantics.
- **Thesis alignment:** Ch 8, Ch 14.2, Ch 16.3–16.4, Ch 3.4–3.6.
- **Major risks retired:** chain staleness/atomicity; strike/expiry selection correctness.

### Phase G — Intent→Plan→Risk Platform Readiness (v2.0)
- **Intent:** Realize full separation of intent, planning, and risk enforcement with parity tests.
- **Thesis alignment:** Ch 15, Ch 17–19, Ch 25, Ch 6.
- **Major risks retired:** unsafe execution coupling; inability to integrate into larger systems.

---

## 8. Sprint Breakdown

Assumption: sprints are **1–2 weeks** for a solo founder + AI-assisted workflow. Each sprint ends with: working CLI, updated docs, and tests/golden outputs.

### v0.1 — Authoring Bootstrap (2 sprints)
- **Sprint 0.1-A (Goal: “Parse and diagnose”)**
  - Outcome: `sigmarule validate` parses a minimal DSL subset and prints deterministic diagnostics.
- **Sprint 0.1-B (Goal: “Ship samples + docs”)**
  - Outcome: 10 minimal rules + docs showing valid/invalid examples; CI runs validations.

### v0.2 — Typed Authoring (2 sprints)
- **Sprint 0.2-A (Goal: “Type checker v1”)**
  - Outcome: typed literals, domain types skeleton, compile-time errors with locations.
- **Sprint 0.2-B (Goal: “Profile compliance + forbidden constructs”)**
  - Outcome: rules are enforced as declarative (no assignments/loops/functions); clear lint output.

### v0.3 — Deterministic Evaluation (Equity) (2 sprints)
- **Sprint 0.3-A (Goal: “Deterministic evaluator + trace”)**
  - Outcome: run rules on in-memory bar series; emit signals with reasons.
- **Sprint 0.3-B (Goal: “CLI run + JSON output”)**
  - Outcome: `sigmarule run` reads CSV bars → emits JSON decisions + trace.

### v0.4 — MVP: Equity Rule Runner + Replay (2 sprints)
- **Sprint 0.4-A (Goal: “Event log + replay”)**
  - Outcome: `sigmarule replay` reproduces identical outputs from logged inputs.
- **Sprint 0.4-B (Goal: “Explain UX + golden suite”)**
  - Outcome: `sigmarule explain` shows “why passed/failed”; golden traces protect determinism.

### v0.5 — Indicators + Feature Registry (2 sprints)
- **Sprint 0.5-A (Goal: “Indicator registry + caching”)**
  - Outcome: EMA/RSI/ATR/VWAP with deterministic windows and pinned versions.
- **Sprint 0.5-B (Goal: “Indicator-based sample strategies”)**
  - Outcome: 10 realistic equity rules + benchmark datasets + expected outputs.

### v0.6 — Library + Packaging (2 sprints)
- **Sprint 0.6-A (Goal: “Imports + module layout”)**
  - Outcome: rule modules import deterministically; dependency graph validated.
- **Sprint 0.6-B (Goal: “Rule pack packaging”)**
  - Outcome: `sigmarule pack` creates versioned bundles; `sigmarule validate --pack`.

### v1.0 — Stable Equity Product (3 sprints)
- **Sprint 1.0-A (Goal: “Signal/Intent/Risk profiles”)**
  - Outcome: profile-specific validators and outputs; stable CLI contract.
- **Sprint 1.0-B (Goal: “Risk constraints v1”)**
  - Outcome: fail-closed risk rules can block/limit decisions; audit reasons recorded.
- **Sprint 1.0-C (Goal: “Reports + UX polish”)**
  - Outcome: summary reports (per rule, per symbol, per day), plus documentation.

### v1.1 — Options Contract Context (3 sprints)
- **Sprint 1.1-A (Goal: “Option instrument model + types”)**
  - Outcome: option contract types (strike/expiry/type/lot) with validation.
- **Sprint 1.1-B (Goal: “Option context binding”)**
  - Outcome: `option` context rules run deterministically on option snapshots.
- **Sprint 1.1-C (Goal: “Selection helpers + examples”)**
  - Outcome: deterministic strike/expiry selection primitives + example rule pack.

### v1.2 — Option Chain Context (3 sprints)
- **Sprint 1.2-A (Goal: “Chain schema + snapshot semantics”)**
  - Outcome: chain snapshots are atomic/staleness-aware; deterministic access patterns.
- **Sprint 1.2-B (Goal: “Derived chain metrics v1”)**
  - Outcome: PCR variants + OI change analytics + skew measures (as defined).
- **Sprint 1.2-C (Goal: “Chain-driven worked examples”)**
  - Outcome: 5 chain-driven strategies + deterministic expected outputs.

### v2.0 — Intent→Plan→Risk Platform Readiness (4 sprints)
- **Sprint 2.0-A (Goal: “Intent verbs v1”)**
  - Outcome: intent actions exist as verbs with typed signatures and conflict resolution.
- **Sprint 2.0-B (Goal: “Execution planning IR”)**
  - Outcome: intent → plan IR (order planning primitives) produced deterministically (no broker).
- **Sprint 2.0-C (Goal: “Risk enforcement integrated”)**
  - Outcome: risk rules constrain plans; policy decisions are traceable and replayable.
- **Sprint 2.0-D (Goal: “Parity harness + contracts”)**
  - Outcome: backtest vs replay parity suite; adapter contracts documented and tested with mocks.

---

## 9. Codex-Sized Task Breakdown

This section is intentionally **implementation-shaped**: each task is meant to be attempted in a single focused Codex iteration, reviewed, and merged.

### 9.1 Codex task sizing guidance (B)
A task is “Codex-sized” when it:
- changes a **small, coherent surface area** (one module or a tight cluster),
- has **clear acceptance criteria** (tests + example CLI output + golden files),
- is **reversible** (no repo-wide refactors),
- is **bounded** (typically ≤ ~300–700 lines touched across a few files),
- includes at least one of: unit test, golden output, or deterministic snapshot fixture.

Avoid tasks like “implement the whole compiler” or “build full options chain UI” (too broad).

### 9.2 Tasks by sprint (with classification)

#### Sprint 0.1-A — Parse and diagnose
- **Engine:** Implement lexer/tokenizer for indentation-aware blocks.
- **Engine:** Implement parser support for `rule` blocks, `when` conditions, and `then` action lists (minimal subset).
- **Tooling/DX:** Add deterministic diagnostic format (file, line, column, code, message).
- **Tests/Correctness:** Add parser golden tests (valid/invalid fixtures).
- **Docs:** Write `docs/dsl_quickstart.md` (author + validate examples).

#### Sprint 0.1-B — Ship samples + docs
- **Product:** Add `examples/equity_min_rules/` with 10 minimal rules and expected `validate` outputs.
- **Tooling/DX:** Implement `sigmarule fmt` (minimal formatter / normalize indentation) *only if trivial*; otherwise defer.
- **Tests/Correctness:** Add CLI snapshot tests (stdout golden files).

#### Sprint 0.2-A — Type checker v1
- **Engine:** Implement type model: primitives + `Price`, `Quantity`, `Percent`, `Timestamp`, `Duration`.
- **Engine:** Implement type checking for comparisons, boolean expressions, and action argument types.
- **Tooling/DX:** Improve error messages with “expected vs got” and source spans.
- **Tests/Correctness:** Add type-check fixtures (good/bad).

#### Sprint 0.2-B — Profile compliance + forbidden constructs
- **Engine:** Add AST validator for forbidden constructs: assignments, loops, function defs/calls outside whitelist.
- **Engine:** Implement “language profiles” validator: `signal` profile vs `intent`/`risk` (initially only `signal` allowed).
- **Tooling/DX:** Add `sigmarule lint` with stable rule codes.
- **Docs:** Author “Language Guardrails” page mapping back to Ch 2.6 and Ch 10.

#### Sprint 0.3-A — Deterministic evaluator + trace
- **Engine:** Implement deterministic evaluation loop: event → context → rule matching → actions → decision outputs.
- **Engine:** Implement deterministic ordering rules (rule ordering + stable tie-breakers).
- **Engine:** Implement trace record model: rule fired, predicate outcomes, reason codes.
- **Tests/Correctness:** Add golden trace tests on small bar series.

#### Sprint 0.3-B — CLI run + JSON output
- **Product:** Implement `sigmarule run --input bars.csv --rules path/` producing `decisions.jsonl`.
- **Tooling/DX:** Add `sigmarule explain --decision-id ...` to print a single decision’s trace (basic).
- **Tests/Correctness:** Add end-to-end fixtures: input CSV → expected JSON outputs.

#### Sprint 0.4-A — Event log + replay
- **Engine:** Implement event log format (inputs + version pins + config) and deterministic replay loader.
- **Product:** Implement `sigmarule replay --log run.log` producing identical decisions.
- **Tests/Correctness:** Add “replay must match” golden tests.

#### Sprint 0.4-B — Explain UX + golden suite
- **Tooling/DX:** Implement `sigmarule diff` to compare two runs (counts + first divergence) deterministically.
- **Docs:** Add “Debugging determinism” page (why/how to use replay + diff).
- **Tests/Correctness:** Expand golden suite across OS/timezone invariants (timestamp handling policy).

#### Sprint 0.5-A — Indicator registry + caching
- **Engine:** Implement indicator registry with explicit version pinning.
- **Engine:** Implement deterministic windows and bar alignment semantics (fixed policy).
- **Tests/Correctness:** Golden numeric tests for EMA/RSI/ATR/VWAP with fixed rounding.

#### Sprint 0.5-B — Indicator-based sample strategies
- **Product:** Add `examples/equity_indicator_rules/` with 10 rules and expected results on sample datasets.
- **Docs:** Add “Indicator cookbook” pages with inputs/outputs.
- **Tooling/DX:** Add `sigmarule profile` summary (what indicators/actions a pack uses).

#### Sprint 0.6-A — Imports + module layout
- **Engine:** Implement module/import resolution rules (no dynamic imports; deterministic load order).
- **Engine:** Add dependency graph validation + cycle detection.
- **Tests/Correctness:** Fixtures for import resolution and cycle errors.

#### Sprint 0.6-B — Rule pack packaging
- **Product:** Implement pack manifest: name, version, compatibility, hashes.
- **Tooling/DX:** Implement `sigmarule pack` and `sigmarule validate --pack file`.
- **Docs:** Add “Rule library model” page aligned to Ch 23.

#### Sprint 1.0-A — Signal/Intent/Risk profiles
- **Engine:** Implement profile-specific allowed verbs and outputs.
- **Engine:** Implement stable decision schema (signals/intents/constraints + trace).
- **Tests/Correctness:** Golden schemas + backward-compat checks for outputs.

#### Sprint 1.0-B — Risk constraints v1
- **Engine:** Implement risk rule evaluation as a separate phase that can block decisions (fail-closed).
- **Product:** Add `examples/risk_rules/` showing blocked trades and reasons.
- **Tests/Correctness:** Golden tests proving risk blocks are deterministic and replayable.

#### Sprint 1.0-C — Reports + UX polish
- **Product:** Implement `sigmarule report` (aggregate outcomes per rule/symbol/day).
- **Tooling/DX:** Improve `explain` formatting: “why did/didn’t it fire?” outputs.
- **Docs:** Add “Equity product quickstart” and “FAQ”.

#### Sprint 1.1-A — Option instrument model + types
- **Engine:** Add option contract types, validation, and canonical identifiers.
- **Engine:** Extend data model to include option snapshots (quotes/greeks inputs).
- **Tests/Correctness:** Fixtures for expiry/strike validation and parsing.

#### Sprint 1.1-B — Option context binding
- **Engine:** Implement `option` context binding rules and deterministic context selection.
- **Product:** Implement `sigmarule run --input options.csv` mode (or multi-input bundle).
- **Docs:** Add “Option context rules” tutorial.

#### Sprint 1.1-C — Selection helpers + examples
- **Engine:** Add deterministic strike/expiry selection primitives (ATM/OTM, delta-based selection when available).
- **Product:** Add `examples/options_contract_rules/` with expected outputs.
- **Tests/Correctness:** Golden tests for selection behavior.

#### Sprint 1.2-A — Chain schema + snapshot semantics
- **Engine:** Implement chain snapshot schema and atomic retrieval semantics.
- **Engine:** Add staleness/quality guards as first-class predicates.
- **Tests/Correctness:** Fixtures for incomplete chain handling and deterministic “unknown” outcomes (per policy).

#### Sprint 1.2-B — Derived chain metrics v1
- **Engine:** Implement derived chain metrics functions with deterministic rounding.
- **Product:** Add chain analytics examples and expected outputs.
- **Tests/Correctness:** Golden numeric tests for PCR/OI change/skew computations.

#### Sprint 1.2-C — Chain-driven worked examples
- **Product:** Add chain-driven examples aligned to Ch 27.4 with deterministic outputs.
- **Docs:** Add “Chain context cookbook”.

#### Sprint 2.0-A — Intent verbs v1
- **Engine:** Implement intent actions as verbs with typed signatures and idempotency rules.
- **Engine:** Implement conflict resolution policy for multiple intents (deterministic tie-breakers).
- **Tests/Correctness:** Golden tests on intent conflict scenarios.

#### Sprint 2.0-B — Execution planning IR
- **Engine:** Implement plan IR schema (entry/exit/size primitives) and deterministic plan generation.
- **Product:** `sigmarule plan` command outputs plan JSON for downstream adapters.
- **Tests/Correctness:** Golden plan outputs for sample intents.

#### Sprint 2.0-C — Risk enforcement integrated
- **Engine:** Integrate risk evaluation across signals→intents→plans; fail-closed defaults.
- **Product:** `sigmarule plan --with-risk` outputs allowed/blocked plans with reasons.
- **Tests/Correctness:** Parity tests: same inputs + same outputs across replay.

#### Sprint 2.0-D — Parity harness + contracts
- **Tests/Correctness:** Implement parity harness for backtest vs replay vs simulated-live modes (Ch 19).
- **Docs:** Document adapter contracts (Ch 25) and integration guidance.

---

## 10. Deliverables by Version

| Version | CLI deliverables | Examples + docs | Correctness deliverables |
|---:|---|---|---|
| v0.1 | `validate` | minimal rules + quickstart | parser golden tests |
| v0.2 | `validate`, `lint` | typed rule pack examples | type-check fixtures |
| v0.3 | `run`, basic `explain` | equity bar runner examples | golden traces |
| v0.4 | `replay`, `diff`, improved `explain` | MVP tutorial + replay guide | replay equivalence tests |
| v0.5 | indicator support in `run` | indicator cookbook + realistic rules | golden numeric tests |
| v0.6 | `pack`, deterministic `import` | reusable library starter pack | pack hash verification |
| v1.0 | `report`, stable schema | equity product guide + FAQ | schema compat tests |
| v1.1 | options input mode | option context tutorials | selection golden tests |
| v1.2 | chain input mode | chain cookbook + worked examples | chain determinism fixtures |
| v2.0 | `plan` (+ risk) | integration guide (adapter contracts) | parity harness suite |

---

## 11. User Value by Version

### v0.1
**User CAN**
- Write a minimal rule file and run `sigmarule validate` to get deterministic syntax diagnostics.
- Start a rule library folder with sample “known good” patterns.

**User CANNOT**
- Run rules against market data.
- Use indicators or domain types beyond basic literals.

### v0.2
**User CAN**
- Write typed conditions and get meaningful type errors and profile compliance errors.
- Preventively catch “Python-like” misuse (assignments/loops/functions).

**User CANNOT**
- Execute against bars/options/chain.
- Produce deterministic traces of evaluation outcomes.

### v0.3
**User CAN**
- Run equity rules deterministically on OHLCV bars and get signal outputs + trace.
- Inspect why a rule matched or failed.

**User CANNOT**
- Replay runs from logs and prove parity across versions.
- Use a robust indicator registry (only minimal computed fields).

### v0.4 (MVP)
**User CAN**
- Run equity screeners on historical CSV data and persist event logs.
- Replay the same run and get identical results; diff two runs deterministically.
- Use `explain` to see “why/why not” with stable reason codes.

**User CANNOT**
- Use a broad set of indicators or option contexts.
- Generate execution plans or enforce sophisticated risk models.

### v0.5
**User CAN**
- Use deterministic indicators (EMA/RSI/ATR/VWAP) in rules.
- Share “indicator-based” rule packs with stable outputs.

**User CANNOT**
- Package rule packs as versioned artifacts with imports (still manual).

### v0.6
**User CAN**
- Import rule modules deterministically and bundle rule packs with manifests/hashes.
- Start building a reusable rule library and apply it across datasets.

**User CANNOT**
- Rely on a stable, documented “product profile” boundary for intent/risk/planning (pre-v1.0).

### v1.0
**User CAN**
- Use stable profiles: `signal`, `intent`, `risk` with clear allowed verbs.
- Run equity rules with risk constraints and produce human-readable reports.
- Treat outputs as integration-ready “decisions with reasons”.

**User CANNOT**
- Write option chain rules or produce execution planning outputs (beyond limited intent).

### v1.1
**User CAN**
- Write option contract context rules (expiry/strike selection, greeks predicates when available).
- Run option-aware rules deterministically on option snapshot inputs.

**User CANNOT**
- Write chain-aware rules; chain snapshot atomicity and derived metrics are not yet present.

### v1.2
**User CAN**
- Write chain-aware rules using deterministic chain snapshots and derived chain metrics.
- Debug chain staleness/quality via first-class guards and traces.

**User CANNOT**
- Generate complete intent→plan outputs with integrated risk enforcement for platform integration (v2.0).

### v2.0
**User CAN**
- Express intent via verbs and produce execution plan IR deterministically.
- Enforce strict risk rules that block/limit plans with audit reasons.
- Run parity suites across modes and provide replay logs as integration evidence.

**User CANNOT (still)**
- Execute broker orders directly from the DSL (by design; Ch 2.6.3).

---

## 12. Risks and Dependencies

### 12.1 Core technical risks (and where they are retired)
- **Grammar drift / ambiguity** → retired in v0.1–v0.2 via golden parse fixtures and strict profiles (Ch 11–12).
- **Non-deterministic evaluation order** → retired in v0.3 via explicit ordering + tie-breakers (Ch 13, Ch 6.3).
- **Hard-to-debug decisions** → retired in v0.3–v0.4 via trace + explain + replay/diff (Ch 4.6, Ch 21.6, Ch 6.5).
- **Indicator instability and rounding differences** → retired in v0.5 with pinned registry + golden numeric tests (Ch 16, Ch 6.2.2).
- **Rule library sprawl** → retired in v0.6 with imports + packaging + versioning (Ch 23, Ch 11.7).
- **Option chain staleness/atomicity** → retired in v1.2 (Ch 8.2).
- **Execution/risk coupling** → retired in v2.0 by enforcing the signal→intent→plan→risk separation (Ch 4, Ch 17–18).

### 12.2 External dependencies (kept behind contracts)
- Market data feeds and historical datasets (input adapters; Ch 25.1.1).
- Greeks/IV computation source (computed in-engine vs vendor; treated as input with validation first; Ch 7.2.4).
- Broker/execution adapters (explicitly outside DSL; plan output only; Ch 25.1.2).

---

## 13. Recommended MVP Target (C)

### MVP = v0.4 “Equity Rule Runner + Trace + Replay”
**Why this milestone:** it is the earliest point where users can *meaningfully* adopt the DSL workflow:
- author rules → validate → run on historical data → explain outcomes → replay deterministically → diff changes.

**MVP acceptance criteria**
- Deterministic `run` output schema (signals + trace).
- Deterministic `replay` produces identical outputs from stored logs.
- `explain` answers both: “why did it fire?” and “why didn’t it fire?” for a rule on an event.
- At least one complete sample pack: equity screener rules + dataset + expected outputs.
- Golden tests cover: parsing, typing, evaluation trace, replay equivalence.

---

## 14. What NOT to Build Early (D)

These are attractive, but premature given `dsl.md` sequencing and risk retirement:
- A full custom editor/IDE, language server, or rich UI (delay until language surface stabilizes; Ch 21.5 later).
- Live broker integration or order placement “verbs” (explicitly out of scope for the DSL; Ch 2.6.3).
- Complex options chain visualization UX (Ch 22.3) before chain semantics (Ch 8.2) are deterministic and testable.
- Too many built-in indicators or advanced “quant libraries” before determinism + version pinning are proven (Ch 16 + Ch 6).
- User-defined functions, macros, loops, or variable assignments (contradicts guardrails; Ch 2.6, Ch 10–14).
- Premature performance optimization or rewriting in C/C++ (Ch 26 is later; correctness first).
- Broad AI automation that writes rules directly into production without validation/simulation gates (Ch 20.3 is guarded).

---

## Appendix: Suggested Repo / Workstream Structure

Even if hosted inside a monorepo initially, keep Sigma Rule DSL **logically separate** from application development.

### Recommended top-level structure
- `dsl/`
  - `compiler/` (lexer, parser, AST, type checker, validators)
  - `runtime/` (deterministic evaluator, trace, replay)
  - `domain/` (entities: instruments, bars, options, chain schema)
  - `indicators/` (registry, windows, caching, pinned versions)
  - `planning/` (intent verbs, plan IR; later)
  - `risk/` (risk rules and enforcement; later)
  - `cli/` (commands: validate/run/explain/replay/diff/pack/report/plan)
  - `schemas/` (decision schema, log schema, pack manifest)
- `examples/`
  - `equity_min_rules/`
  - `equity_indicator_rules/`
  - `options_contract_rules/`
  - `chain_rules/`
- `docs/`
  - `dsl.md` (thesis TOC, source of truth)
  - `dsl_proj_plan.md` (this plan)
  - additional tutorials/cookbooks as shipped per version
- `tests/`
  - `fixtures/` (CSV inputs, chain snapshots, option snapshots)
  - `goldens/` (expected outputs: validate/run/trace/replay)

