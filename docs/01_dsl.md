# Sigma Rule DSL — A Deterministic Rule-Based Language for Equities and Options Trading Systems

## Table of Contents

### Front Matter
- Title Page
- Abstract
- Executive Summary (Stakeholder-Friendly)
- Document Scope and Reader Guide
  - Audience Personas (Founder/PM, Quant, Trader, Engineer, Risk, Compliance)
  - How to Use This Document (PRD vs Spec vs Reference)
  - Terminology, Notation, and Conventions
- Revision History and Versioning Policy
- Glossary (Trading + DSL + Architecture)
- List of Figures / Tables / Listings

---

## Chapter 1 — Introduction
1.1 Problem Statement: Deterministic Rule Systems for Indian Markets  
1.2 Why a DSL (and Why Not Python)  
1.3 Key Goals and Non-Goals  
1.4 Core Philosophy and Design Principles  
1.5 Determinism as a First-Class Requirement  
1.6 System Overview (High-Level)  
1.7 Summary of Contributions

---

## Chapter 2 — Product Requirements Document (PRD)
2.1 Product Vision and Value Proposition  
2.2 Target Use Cases  
- 2.2.1 Discretionary + Semi-Automated Trading
- 2.2.2 Fully Systematic/Algorithmic Trading
- 2.2.3 Research → Backtest → Paper → Live Lifecycle
2.3 Supported Markets and Instruments (NSE/BSE)  
- 2.3.1 Cash Equities
- 2.3.2 Index Options (weekly/monthly expiries)
- 2.3.3 Stock Options
- 2.3.4 Futures (optional/roadmap)
2.4 Functional Requirements  
- 2.4.1 Signal Generation Rules
- 2.4.2 Strategy Intent Rules
- 2.4.3 Execution Planning Rules (broker-agnostic)
- 2.4.4 Risk Enforcement Rules (pre/post-trade)
- 2.4.5 Context-Aware Rules (underlying/option/chain)
- 2.4.6 Rule Library, Reuse, and Versioning
2.5 Non-Functional Requirements  
- 2.5.1 Deterministic Execution and Replayability
- 2.5.2 Performance and Latency Targets
- 2.5.3 Reliability, Fault Tolerance, and Recovery
- 2.5.4 Auditability and Explainability
- 2.5.5 Security and Access Control
2.6 Constraints and Guardrails  
- 2.6.1 No loops / no unrestricted functions
- 2.6.2 No arbitrary assignments
- 2.6.3 No direct broker execution in DSL
- 2.6.4 Actions expressed only as verbs
- 2.6.5 Strong typing, static validation, and runtime invariants
2.7 Success Metrics (Business + Trading + Engineering)  
2.8 Risks, Assumptions, and Open Questions  
2.9 Roadmap and Phased Delivery Plan

---

## Chapter 3 — Trading Domain Primer (India-Focused)
3.1 Indian Market Microstructure (NSE/BSE Overview)  
3.2 Trading Sessions and Calendars  
- 3.2.1 Market hours, pre-open, auctions (if applicable)
- 3.2.2 Holidays, special sessions, event days
3.3 Equity Mechanics  
- 3.3.1 Tick size, lot size (where relevant), circuit limits
- 3.3.2 Corporate actions and adjusted price series
- 3.3.3 Delivery vs intraday considerations (system-level)
3.4 Derivatives Mechanics (F&O)  
- 3.4.1 Contract specs: symbol, strike, expiry, lot size
- 3.4.2 Weekly vs monthly expiry logic
- 3.4.3 Settlement conventions and expiry day behavior
3.5 Options Fundamentals (for DSL Semantics)  
- 3.5.1 Calls/puts, moneyness, intrinsic/extrinsic
- 3.5.2 Volatility, IV, and skew
- 3.5.3 Payoff profiles and common structures
3.6 Greeks and Risk Measures  
- 3.6.1 Delta, gamma, theta, vega, rho (as supported)
- 3.6.2 Portfolio Greeks aggregation
- 3.6.3 Margin concepts (conceptual model for risk layer)
3.7 Order Types and Execution Realities  
- 3.7.1 Market/limit/SL/SL-M (mapped to broker capabilities)
- 3.7.2 Partial fills, rejects, modifications, cancels
- 3.7.3 Slippage, spreads, and impact
3.8 Regulatory/Operational Considerations (High-Level)  
- 3.8.1 Audit trails and controls expectations
- 3.8.2 Safety constraints for automated trading systems

---

## Chapter 4 — System Conceptual Model
4.1 Separation of Concerns (Mandatory)  
- 4.1.1 Signal Generation
- 4.1.2 Strategy Intent
- 4.1.3 Execution Planning
- 4.1.4 Risk Enforcement
4.2 Deterministic Event-Driven Model  
- 4.2.1 Inputs, events, state, outputs
- 4.2.2 Ordering rules and tie-breakers
4.3 Time Model  
- 4.3.1 Tick vs bar vs snapshot semantics
- 4.3.2 Session boundaries and day rollovers
- 4.3.3 Expiry-time semantics and cutoffs
4.4 Domain Contexts  
- 4.4.1 Underlying context (equity/index)
- 4.4.2 Option instrument context
- 4.4.3 Option chain context
4.5 Deterministic State and Memory  
- 4.5.1 Allowed state: positions, orders, risk, derived facts
- 4.5.2 Forbidden state: arbitrary mutable variables
4.6 Explainability Model (Reason Codes, Rule Trace, Provenance)

---

## Chapter 5 — Architecture Overview
5.1 Architectural Goals and Constraints  
5.2 High-Level Component Diagram  
5.3 Data Flow Overview (Market → Engine → Plan → Adapter)  
5.4 Execution Modes  
- 5.4.1 Backtest mode
- 5.4.2 Paper/live-sim mode
- 5.4.3 Live mode
- 5.4.4 Deterministic replay mode
5.5 Deployment Topologies  
- 5.5.1 Single-node desktop research
- 5.5.2 Multi-service production
- 5.5.3 Hybrid (research + production parity)

---

## Chapter 6 — Determinism, Replay, and Correctness
6.1 Determinism Definition for Sigma Rule DSL  
6.2 Sources of Non-Determinism (and Mitigations)  
- 6.2.1 Data arrival timing and clock drift
- 6.2.2 Floating-point and rounding policies
- 6.2.3 Concurrency and async operations
- 6.2.4 External system variability (broker/exchange)
6.3 Deterministic Scheduling and Evaluation Order  
6.4 Idempotency and Exactly-Once Effects (planning layer)  
6.5 Replay Architecture  
- 6.5.1 Event logs and snapshots
- 6.5.2 Version pinning (DSL + indicators + models)
- 6.5.3 Forensic reconstruction and audit evidence
6.6 Correctness Strategy  
- 6.6.1 Invariants and assertions
- 6.6.2 Property-based testing approach
- 6.6.3 Golden test datasets and fixtures

---

## Chapter 7 — Data Model and Market Data Interfaces
7.1 Canonical Entities  
- 7.1.1 Instrument, Contract, Underlying
- 7.1.2 Quote, Trade, OHLCV bar
- 7.1.3 Order, Fill, Position, Portfolio
- 7.1.4 Corporate action, calendar event
7.2 Market Data Types  
- 7.2.1 L1 (bid/ask/last)
- 7.2.2 OHLCV (timeframe series)
- 7.2.3 Option chain snapshots
- 7.2.4 Greeks/IV surface inputs (computed vs vendor)
7.3 Normalization and Symbol Mapping (NSE/BSE specifics)  
7.4 Timezone, Timestamp, and Clock Policy  
7.5 Data Quality and Validation  
- 7.5.1 Missing data, stale data, outliers
- 7.5.2 Corporate action adjustments
- 7.5.3 Rollovers and contract discontinuities
7.6 Storage and Retrieval  
- 7.6.1 Event store vs time-series store
- 7.6.2 Snapshot strategy
- 7.6.3 Data lineage and provenance

---

## Chapter 8 — Option Chain Modeling and Analytics Layer
8.1 Option Chain Canonical Schema  
- 8.1.1 Strikes, expiries, call/put legs
- 8.1.2 OI, volume, bid/ask, IV, greeks
8.2 Chain Snapshot Semantics (atomicity and staleness)  
8.3 Derived Chain Metrics  
- 8.3.1 Put-Call ratios (variants)
- 8.3.2 OI change analytics
- 8.3.3 Max pain (definition and caveats)
- 8.3.4 Skew, smile, term structure
8.4 Strike Selection and Expiry Selection Rules  
- 8.4.1 ATM/ITM/OTM selection
- 8.4.2 Delta-based selection
- 8.4.3 Liquidity/spacing constraints
8.5 Chain Context in DSL  
- 8.5.1 Aggregations allowed (deterministic windows)
- 8.5.2 Prohibited computations (non-deterministic/unstable)
8.6 Performance Considerations for Chain Queries

---

## Chapter 9 — Strategy Lifecycle and State Machine
9.1 Strategy Definition vs Rule Set vs Deployment Unit  
9.2 Lifecycle States  
- 9.2.1 Draft, validated, simulated
- 9.2.2 Paper, live (shadow), live (active)
- 9.2.3 Paused, halted, retired
9.3 Session Lifecycle  
- 9.3.1 Pre-market preparation
- 9.3.2 Intraday operation
- 9.3.3 End-of-day reconciliation
9.4 Position Lifecycle and Intent Lifecycle  
- 9.4.1 Intent creation, modification, cancellation
- 9.4.2 Entry, adjustment, exit
9.5 Incident Handling and Kill Switch Behavior  
- 9.5.1 Risk-triggered halts
- 9.5.2 Broker disconnect / data outage modes
9.6 Governance: Approvals, Promotion, and Rollback

---

## Chapter 10 — Sigma Rule DSL: Language Overview
10.1 Design Goals for the DSL  
10.2 What the DSL Is (and Is Not)  
10.3 Mental Model: “Rules Produce Decisions, Not Programs”  
10.4 Deterministic Evaluation Model (single pass, event-triggered)  
10.5 Key Constructs (Preview)  
- 10.5.1 Rule blocks and declarations
- 10.5.2 Conditions and predicates
- 10.5.3 Facts and derived values (non-assignable)
- 10.5.4 Actions as verbs (effects as plans)
10.6 Language Profiles (Signal/Intent/Plan/Risk subsets)

---

## Chapter 11 — Lexical Structure and Syntax (Python-Shaped)
11.1 Source Files and Modules  
11.2 Indentation and Block Structure  
11.3 Tokens, Keywords, and Reserved Words  
11.4 Comments, Docstrings, and Metadata Blocks  
11.5 Identifiers, Namespaces, and Naming Conventions  
11.6 Literals (numbers, strings, time literals, enums)  
11.7 Imports and Dependency Rules (library model)  
11.8 Compatibility and Deprecation Syntax

---

## Chapter 12 — Static Type System and Validation
12.1 Type System Goals (safety, clarity, determinism)  
12.2 Primitive Types (int, decimal, bool, string, timestamp, duration)  
12.3 Domain Types  
- 12.3.1 Price, Quantity, Percent, Money
- 12.3.2 Symbol, Exchange, Segment
- 12.3.3 ExpiryDate, Strike, OptionType
- 12.3.4 Greeks types and vector/portfolio aggregates
12.4 Structured Types  
- 12.4.1 Records (instrument, chain row, position)
- 12.4.2 Lists/maps (restricted usage)
12.5 Units, Rounding, and Precision Policy  
12.6 Type Inference (allowed scope) vs Required Annotations  
12.7 Compile-Time Validation  
- 12.7.1 Syntax and schema validation
- 12.7.2 Type checking
- 12.7.3 Rule profile compliance checks
- 12.7.4 Forbidden constructs detection
12.8 Runtime Validation  
- 12.8.1 Preconditions and guards
- 12.8.2 Data availability constraints
- 12.8.3 Risk invariants enforcement

---

## Chapter 13 — Semantics: Deterministic Rule Evaluation
13.1 Execution Context Definition  
13.2 Event Triggers and Evaluation Phases  
13.3 Condition Semantics  
- 13.3.1 Short-circuit behavior
- 13.3.2 Three-valued logic policy (if any) and “unknown” handling
13.4 Derived Values (facts) vs Actions (verbs)  
13.5 Side-Effect Model: “Plan, Don’t Execute”  
13.6 Conflict Resolution and Priority  
- 13.6.1 Multiple matching rules
- 13.6.2 Rule priority, ordering, and deterministic tie-breakers
13.7 Rule Outcomes: decisions, intents, constraints, annotations  
13.8 Error Semantics  
- 13.8.1 Compile errors
- 13.8.2 Runtime faults
- 13.8.3 Degradation policies (fail-closed vs fail-open)

---

## Chapter 14 — DSL Constructs: Rules, Contexts, and Guards
14.1 Rule Definitions  
- 14.1.1 Naming, description, tags
- 14.1.2 Version constraints and compatibility metadata
14.2 Context Binding  
- 14.2.1 `underlying` scope
- 14.2.2 `option` scope
- 14.2.3 `chain` scope
14.3 Guards and Preconditions  
- 14.3.1 Market session guards
- 14.3.2 Liquidity/volatility guards
- 14.3.3 Data quality guards
14.4 Deterministic Windows and “Lookback” Semantics  
- 14.4.1 Allowed aggregations (min/max/avg/EMA etc.)
- 14.4.2 Window alignment and bar-close rules
14.5 Pattern Catalog (canonical rule patterns)  
- 14.5.1 Entry conditions
- 14.5.2 Exit conditions
- 14.5.3 Re-entry and cooldown patterns
- 14.5.4 Breakout/mean-reversion templates
- 14.5.5 Options-specific templates (straddle/strangle/spreads)

---

## Chapter 15 — Actions as Verbs: The Effect Catalog (Core)
15.1 Action Philosophy and Constraints  
15.2 Action Categories  
- 15.2.1 Intent actions (declare/adjust/cancel intent)
- 15.2.2 Risk actions (cap exposure, block trades, reduce size)
- 15.2.3 Execution planning actions (place plan, route, slice)
- 15.2.4 Position management actions (move_stop, start_trailing_stop)
15.3 Action Signatures and Type Rules  
15.4 Idempotency, Deduplication, and Plan Merging  
15.5 Action Conflicts and Resolution Policies  
15.6 Standard Reason Codes and Explainability Payloads  
15.7 Extensibility: Adding New Verbs Safely

---

## Chapter 16 — Indicator and Feature Framework (Deterministic)
16.1 Indicator Definitions and Allowed Computations  
16.2 Built-in Indicators (equities)  
- 16.2.1 Moving averages, RSI, ATR, VWAP (as supported)
- 16.2.2 Volatility and range measures
16.3 Options Features  
- 16.3.1 IV rank/percentile
- 16.3.2 Skew/term structure measures
- 16.3.3 Greeks-based features
16.4 Chain Aggregations and Cross-Strike Features  
16.5 Caching, Reuse, and Version Pinning  
16.6 Deterministic Handling of Missing/Stale Inputs

---

## Chapter 17 — Execution Planning Layer (Broker-Agnostic)
17.1 Plan Model: From Intent to Executable Orders  
17.2 Order Planning Primitives  
- 17.2.1 Entry plan (limit/market/SL variants)
- 17.2.2 Exit plan (profit/stop/time)
- 17.2.3 Bracket/OCO semantics (abstracted)
17.3 Sizing and Allocation  
- 17.3.1 Quantity derivation (risk-based, fixed, volatility-scaled)
- 17.3.2 Lot rounding and exchange constraints
17.4 Slippage and Spread Models (simulation vs live)  
17.5 Execution Constraints  
- 17.5.1 Rate limits
- 17.5.2 Price bands / circuit filters
- 17.5.3 Liquidity checks
17.6 Order Lifecycle Handling  
- 17.6.1 Pending/ack/reject/partial/fill/cancel
- 17.6.2 Modify/cancel policies and retries
17.7 Plan-to-Adapter Interface (contract specification)

---

## Chapter 18 — Risk Management and Enforcement
18.1 Risk Philosophy: “Fail Closed, Explain Clearly”  
18.2 Risk Domains  
- 18.2.1 Pre-trade risk (eligibility, sizing caps)
- 18.2.2 In-trade risk (drawdown, trailing constraints)
- 18.2.3 Post-trade risk (reconciliation, exposure validation)
18.3 Risk Metrics and Limits  
- 18.3.1 Notional exposure, leverage, concentration
- 18.3.2 Options-specific: portfolio Greeks caps
- 18.3.3 Margin-aware constraints (conceptual abstraction)
18.4 Circuit Breakers and Kill Switch Rules  
18.5 Risk Exceptions and Override Governance  
18.6 Risk Audits, Reports, and Compliance Artifacts

---

## Chapter 19 — Backtesting, Simulation, and Live Parity
19.1 Parity Requirement and Definitions  
19.2 Historical Data Alignment  
- 19.2.1 Survivorship bias and corporate actions
- 19.2.2 Options data challenges (chain completeness)
19.3 Fill Models  
- 19.3.1 Deterministic fill policies
- 19.3.2 Partial fills and queue models (optional)
19.4 Slippage, Fees, and Taxes Models (configurable)  
19.5 Event Replay and Deterministic Re-simulation  
19.6 Metrics and Reporting  
- 19.6.1 Returns, drawdown, hit rate
- 19.6.2 Risk metrics: exposure, Greeks PnL attribution
19.7 Validation Against Live: Shadow Mode and Drift Detection

---

## Chapter 20 — AI Integration Layer (Deterministic + Guarded)
20.1 AI Roles (strictly bounded)  
- 20.1.1 Idea generation and rule suggestion
- 20.1.2 Parameter tuning recommendations
- 20.1.3 Anomaly detection and diagnostics
- 20.1.4 Natural-language explanation generation (post-hoc)
20.2 Determinism Boundary: Where AI Is Allowed (and not allowed)  
20.3 AI-to-DSL Workflow  
- 20.3.1 Suggest → validate → compile → simulate → approve
- 20.3.2 Human-in-the-loop checkpoints
20.4 Safety, Guardrails, and Policy Constraints  
- 20.4.1 Prompt constraints and tool isolation
- 20.4.2 Output schema validation and lint gates
20.5 Model Management  
- 20.5.1 Versioning and reproducibility
- 20.5.2 Offline evaluation and regression tests
20.6 AI Observability  
- 20.6.1 Recommendation logs and provenance
- 20.6.2 Drift and hallucination detection (operationally)

---

## Chapter 21 — Developer Tooling: Compiler, Linter, and IDE Experience
21.1 CLI and Developer Workflow  
21.2 Parser/Compiler Pipeline  
- 21.2.1 Lexing, parsing, AST
- 21.2.2 Type checking and rule profile validation
- 21.2.3 IR generation and optimization (deterministic)
21.3 Lint Rules (best practices and anti-patterns)  
21.4 Formatter and Style Rules (Python-shaped constraints)  
21.5 IDE Features  
- 21.5.1 Syntax highlighting and autocomplete
- 21.5.2 Hover types and documentation
- 21.5.3 Jump-to-definition and rule graph navigation
21.6 Debugging and Tracing Tools  
- 21.6.1 Step-by-step rule evaluation trace
- 21.6.2 Decision provenance and reason codes
21.7 Error Catalog and Diagnostics UX

---

## Chapter 22 — Visualization, UX, and Operator Interfaces
22.1 Stakeholder Views and Dashboards  
- 22.1.1 Trader cockpit
- 22.1.2 Risk officer view
- 22.1.3 Engineering/ops view
22.2 Visualizing Rule Behavior  
- 22.2.1 Signal overlays on charts
- 22.2.2 Intent timelines and plan ladders
- 22.2.3 Rule firing heatmaps and graphs
22.3 Options-Specific Visualization  
- 22.3.1 Chain heatmaps (OI/IV/greeks)
- 22.3.2 Skew/term structure plots
22.4 Explainability UX  
- 22.4.1 “Why did it trade?” narratives
- 22.4.2 “Why didn’t it trade?” blockers
22.5 Operator Controls  
- 22.5.1 Pause/resume/flatten/kill switch
- 22.5.2 Safe parameter updates and approvals

---

## Chapter 23 — Rule Library Model, Reuse, and Governance
23.1 Library Structure and Packaging  
- 23.1.1 Modules, namespaces, and imports
- 23.1.2 Rule templates vs instantiated strategies
23.2 Copy/Modify/Reuse Workflows  
23.3 Semantic Versioning and Compatibility Rules  
23.4 Review and Approval Pipelines  
- 23.4.1 Code review requirements
- 23.4.2 Simulation gates
- 23.4.3 Risk sign-off
23.5 Provenance, Attribution, and Audit Trails  
23.6 Deprecation, Migration, and Upgrade Tooling

---

## Chapter 24 — Security, Reliability, and Operations
24.1 Threat Model (data, execution, insider risk)  
24.2 Authentication, Authorization, and Roles  
24.3 Secrets Management (broker creds, keys)  
24.4 Observability  
- 24.4.1 Logs, metrics, traces
- 24.4.2 Rule evaluation metrics
- 24.4.3 Execution metrics and broker health
24.5 Fault Tolerance and Recovery  
- 24.5.1 Restart safety and state restoration
- 24.5.2 Message replay and deduplication
24.6 Operational Runbooks  
- 24.6.1 Incident response
- 24.6.2 Trading day checklist
24.7 Compliance-Oriented Evidence and Reporting

---

## Chapter 25 — Reference Implementations and Contracts (Developer Reference)
25.1 Canonical Interfaces  
- 25.1.1 Market data adapter contract
- 25.1.2 Order adapter contract (broker-agnostic)
- 25.1.3 Risk engine contract
25.2 Data Schemas and Serialization  
- 25.2.1 JSON/MessagePack/Protobuf schemas (as selected)
- 25.2.2 Versioning and backwards compatibility
25.3 Engine API (compile, validate, run, replay)  
25.4 Strategy Packaging and Deployment Artifacts  
25.5 Configuration Model (env, files, overrides)

---

## Chapter 26 — Performance Engineering
26.1 Performance Targets by Mode (backtest vs live)  
26.2 Hot Path Analysis: Chain + Rules + Planning  
26.3 Deterministic Caching and Memoization  
26.4 Memory Model and Snapshot Costs  
26.5 Load Testing and Benchmark Methodology  
26.6 Capacity Planning (symbols, chains, timeframes)

---

## Chapter 27 — Worked Examples (Specification-by-Example)
27.1 Equity Trend Strategy (signal → intent → plan → risk)  
27.2 Index Options Intraday Strategy (weekly expiry focus)  
27.3 Stock Options Strategy (liquidity and spread guards)  
27.4 Chain-Driven Strategy (OI/IV/Skew-based conditions)  
27.5 Risk-First Example (kill switch and drawdown constraints)  
27.6 Failure Mode Examples (data gaps, reject loops, stale chain)

---

## Chapter 28 — Limitations, Tradeoffs, and Future Work
28.1 Known Limitations (by design)  
28.2 Tradeoffs vs General-Purpose Languages  
28.3 Extensibility Roadmap  
- 28.3.1 Additional instruments (futures, commodities)
- 28.3.2 More chain analytics primitives
- 28.3.3 Advanced execution tactics
28.4 Research Directions (formal verification, robust optimization)

---

## Chapter 29 — Conclusion
29.1 Summary of the Sigma Rule DSL Approach  
29.2 Outcomes and Expected Impact  
29.3 Final Notes for Stakeholders and Developers

---

# Appendices

### Appendix A — Formal Grammar (EBNF/PEG)
A.1 Lexical Grammar  
A.2 Syntax Grammar  
A.3 Ambiguity Analysis and Deterministic Parsing Proof Notes

### Appendix B — Complete Type Catalog
B.1 Primitive Types  
B.2 Domain Types  
B.3 Structured Types and Schemas  
B.4 Units, Rounding, and Precision Tables

### Appendix C — Complete Verb/Action Catalog
C.1 Intent Verbs  
C.2 Planning Verbs  
C.3 Risk Verbs  
C.4 Position Management Verbs  
C.5 Standard Parameters and Defaults

### Appendix D — Built-in Indicators and Feature Definitions
D.1 Equity Indicators  
D.2 Options/Greeks Features  
D.3 Chain Aggregations  
D.4 Deterministic Window Semantics

### Appendix E — Error Codes, Diagnostics, and Lint Rules
E.1 Compile-Time Errors  
E.2 Runtime Faults  
E.3 Linter Warnings and Fix Suggestions  
E.4 Troubleshooting Guides

### Appendix F — Data Schemas and Contracts
F.1 Market Data Schema  
F.2 Option Chain Snapshot Schema  
F.3 Order/Fill/Position Schema  
F.4 Event Log and Replay Schema

### Appendix G — Backtesting Assumptions and Model Specs
G.1 Fill Model Variants  
G.2 Slippage/Fee/Tax Modeling Inputs  
G.3 Corporate Action Handling Notes  
G.4 Parity Checklist (Backtest vs Live)

### Appendix H — Governance and Audit Templates
H.1 Strategy Approval Checklist  
H.2 Risk Sign-Off Template  
H.3 Incident Report Template  
H.4 Daily Ops Checklist

### Appendix I — Stakeholder Quick Guides
I.1 Trader Quick Start  
I.2 Risk Officer Quick Start  
I.3 Engineering Quick Start  
I.4 FAQ

### Appendix J — Bibliography / References
J.1 Language design and deterministic systems  
J.2 Trading systems engineering references  
J.3 Options analytics references

