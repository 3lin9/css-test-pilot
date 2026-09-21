# TestPilot Data-Driven Test Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add evidence-driven requirement matrices, QA coverage mapping, data-driven Case execution, static dependency preflight, setup/teardown phases, fixture/config variables, and cross-platform UI request-count assertions.

**Architecture:** Keep YAML as the source template. The SDK prepares one or more immutable execution units by loading project-scoped data, resolving whitelisted variables, and checking dependencies; the engine runs each unit through setup/steps/teardown; adapters provide optional request capture; reporters group results by template and dataset row.

**Tech Stack:** TypeScript, Zod 4, YAML 2, Vitest 3, Playwright 1.53, miniprogram-automator 0.12, pnpm/Turbo.

**Spec:** `docs/superpowers/specs/2026-09-21-data-driven-test-workflow-design.md`

## Global Constraints

- Existing Case YAML and existing result JSON remain readable without migration.
- Data references are project-relative and must resolve under `tests/e2e/data/`.
- Case files cannot read arbitrary process environment variables; only `testpilot.yaml variables` entries become `${variable.*}`.
- `requires` is optional and AI-generated from project evidence; no business field is globally mandatory.
- Missing static dependencies produce `skipped`, not `failed`.
- Request capture observes but never blocks, deduplicates, or changes responses.
- Do not commit unless the user explicitly requests it.

---

### Task 1: Whitelisted project variables

**Files:**
- Modify: `packages/core/src/config-loader.ts`
- Modify: `apps/cli/src/commands/init/config-initializer.ts`
- Test: `tests/unit/config-loader.test.ts`

**Interfaces:**
- Produces: `TestpilotConfig.variables?: Record<string, string>`
- Produces: recursive interpolation for values declared in `testpilot.yaml variables`

- [ ] **Step 1: Write failing config tests**

Add tests proving:

```ts
process.env.PPM_PROJECT_ID = 'ppm-100'
const config = await loadTestpilotConfig(root)
expect(config.variables).toEqual({ ppmProjectId: 'ppm-100' })
```

and proving unresolved references remain `${MISSING_VARIABLE}` for preflight detection.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm vitest run tests/unit/config-loader.test.ts
```

Expected: failure because `variables` is rejected by the strict config schema.

- [ ] **Step 3: Implement schema and interpolation**

Add to `configSchema`:

```ts
variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
```

Add `variables?: Record<string, string>` to `TestpilotConfig` and interpolate each value through `interpolateEnvRefs`.

- [ ] **Step 4: Update generated configuration examples**

Add a commented whitelist example:

```yaml
# variables:
#   ppmProjectId: ${PPM_PROJECT_ID}
```

Do not expose `process.env` directly.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
pnpm vitest run tests/unit/config-loader.test.ts
pnpm --filter @testpilot/sdk typecheck
```

Expected: PASS.

### Task 2: DSL contracts and semantic validation

**Files:**
- Modify: `packages/dsl/src/schema/index.ts`
- Modify: `packages/dsl/src/validator/index.ts`
- Test: `tests/unit/dsl.test.ts`

**Interfaces:**
- Produces: `DatasetReference`, `RequestExpectation`, extended `TestCase` and `TestStep`
- Produces: variable roots `fixture`, `dataset`, `variable`, and `account`

- [ ] **Step 1: Write failing parser tests**

Add a valid Case containing:

```yaml
fixtures:
  - tests/e2e/data/promotion.yaml
datasets:
  file: tests/e2e/data/discount-cases.yaml
  idField: id
requires:
  - fixture.product.styleNo
  - variable.ppmProjectId
setup:
  - target: api
    action: request
    url: /setup
steps:
  - target: web
    action: click
    locator: { css: ".submit" }
    expectRequests:
      - method: POST
        urlContains: /api/orders
        count: 1
        windowMs: 1000
teardown:
  - target: api
    action: request
    url: /cleanup
```

Also test rejection of absolute fixture paths, empty `requires`, duplicate request matchers, and `expectRequests` on `target: api`.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/unit/dsl.test.ts
```

Expected: schema rejects the new fields.

- [ ] **Step 3: Add strict schemas**

Define:

```ts
export const requestExpectationSchema = z.strictObject({
  method: z.enum(HTTP_METHODS).optional(),
  urlContains: z.string().min(1),
  count: z.number().int().nonnegative(),
  windowMs: z.number().int().nonnegative().default(1000),
})

export const datasetReferenceSchema = z.strictObject({
  file: z.string().min(1),
  idField: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('id'),
})
```

Extend `stepSchema` with `expectRequests`; extend `caseSchema` with `fixtures`, `datasets`, `requires`, `setup`, and `teardown`. Keep `steps` required and non-empty.

- [ ] **Step 4: Extend semantic validation**

Seed declared variable roots when their source exists:

```ts
if (data.fixtures?.length) declared.add('fixture')
if (data.datasets) declared.add('dataset')
declared.add('variable')
```

Validate setup → steps → teardown in order so extracted variables flow forward. Reject `expectRequests` for API targets and actions other than `navigate/click/input/select`.

- [ ] **Step 5: Verify GREEN and old Case compatibility**

```bash
pnpm vitest run tests/unit/dsl.test.ts tests/unit/dsl-api.test.ts
pnpm --filter @testpilot/sdk typecheck
```

Expected: all existing and new tests PASS.

### Task 3: Project-scoped data loading and Case preparation

**Files:**
- Create: `packages/sdk/src/case-data.ts`
- Create: `packages/sdk/src/case-preparation.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/cases.ts`
- Modify: `packages/sdk/src/runs.ts`
- Test: `packages/sdk/src/sdk.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PreparedCaseExecution {
  data: TestCase
  file: string
  rowId: string
  rowIndex: number
  templateId: string
  initialVariables: Record<string, string>
  missingDependencies: string[]
}

export async function prepareCaseExecutions(
  item: { data: TestCase; file: string },
  options: {
    root: string
    dataDir: string
    variables?: Record<string, string>
    accounts?: Record<string, string>
  },
): Promise<PreparedCaseExecution[]>
```

- [ ] **Step 1: Write failing loader tests**

Cover YAML and JSON, deep fixture merging, conflict rejection, dataset expansion, duplicate/missing row IDs, absolute paths, `..` traversal, symlink/realpath escape, and unresolved `${ENV_NAME}` values.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run packages/sdk/src/sdk.test.ts
```

Expected: imports/functions do not exist.

- [ ] **Step 3: Implement safe data loading**

Resolve references from project root, then ensure both lexical path and `realpath` are inside `<root>/tests/e2e/data`. Parse `.yaml/.yml` with `yaml.parse`, `.json` with `JSON.parse`; reject other extensions.

Fixture roots must be plain objects. Deep merge recursively and throw on any repeated leaf or object key path. Dataset roots must be arrays of plain objects.

- [ ] **Step 4: Implement variable flattening and preflight**

Flatten nested values into names such as:

```text
fixture.product.styleNo
dataset.discountType
variable.ppmProjectId
account.token
```

Keep objects out of results. Treat missing, `null`, empty string, and unresolved `${ENV_NAME}` as unavailable. Produce one `default` execution when no dataset exists.

- [ ] **Step 5: Integrate project-aware validation and run preparation**

`collectCases` continues schema validation. Add data-reference validation with project context so `csspilot validate` reports missing/invalid files. In `runCases`, prepare all valid templates before creating `TestRunner`.

- [ ] **Step 6: Verify GREEN**

```bash
pnpm vitest run packages/sdk/src/sdk.test.ts
pnpm --filter @testpilot/sdk typecheck
```

Expected: PASS.

### Task 4: Lifecycle execution and result states

**Files:**
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/execution-engine/src/context/index.ts`
- Modify: `packages/execution-engine/src/engine/execution-engine.ts`
- Modify: `packages/execution-engine/src/engine/test-runner.ts`
- Modify: `packages/execution-engine/src/engine/result-collector.ts`
- Modify: `packages/execution-engine/src/events/index.ts`
- Test: `tests/unit/engine.test.ts`

**Interfaces:**
- Consumes: `PreparedCaseExecution`
- Produces: `StepStatus = passed | failed | skipped | warning`
- Produces: `CaseStatus = passed | failed | skipped`
- Produces: row-aware `CaseResult` and extended totals

- [ ] **Step 1: Write failing engine tests**

Add tests for:

- two dataset rows execute with independent contexts;
- missing dependency returns skipped without adapter calls;
- setup failure skips main steps but runs teardown;
- main-step failure runs teardown;
- teardown failure becomes warning without changing a passed main result;
- screenshot/video/trace names include sanitized rowId;
- all-skipped run status is `skipped`.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/unit/engine.test.ts
```

Expected: type/behavior failures for new states and phases.

- [ ] **Step 3: Extend context seeding**

Add:

```ts
seed(values: Record<string, string>): void
```

Reject attempts to overwrite seeded roots during setup/extract.

- [ ] **Step 4: Implement phase runner**

Refactor `runCase` around a private phase executor:

```ts
runPhase(
  phase: 'setup' | 'steps' | 'teardown',
  steps: readonly TestStep[],
  failureStatus: 'failed' | 'warning',
): Promise<{ failed: boolean }>
```

Emit phase and rowId with step events. Before setup, return skipped immediately when `missingDependencies.length > 0`.

- [ ] **Step 5: Extend result aggregation**

Add `templates`, `skipped`, `warnings`, and `stepsWarning`. Run status is failed if any row fails, passed if at least one row passes and none fail, otherwise skipped.

- [ ] **Step 6: Verify GREEN**

```bash
pnpm vitest run tests/unit/engine.test.ts
pnpm --filter @testpilot/sdk typecheck
```

Expected: PASS.

### Task 5: Adapter request capture and step assertions

**Files:**
- Modify: `packages/adapter-core/src/adapter.ts`
- Modify: `packages/execution-engine/src/engine/step-executor.ts`
- Modify: `packages/adapter-playwright/src/page.ts`
- Modify: `packages/adapter-wechatide/src/ide.ts`
- Test: `tests/unit/engine.test.ts`
- Test: `tests/unit/wechatide-adapter.test.ts`
- Create: `tests/unit/playwright-adapter.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CapturedRequest {
  method: string
  url: string
}

startRequestCapture?(): Promise<void>
stopRequestCapture?(): Promise<CapturedRequest[]>
```

- [ ] **Step 1: Write failing adapter and engine tests**

Verify capture starts before the UI action, stops after `windowMs`, exact counts pass/fail, request summaries are truncated, and unsupported capture returns a clear failure rather than silently passing.

For miniapp, verify `mockWxMethod('request')` calls `this.origin(obj)`, forwards captured method/url through `exposeFunction`, and always restores `request`.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/unit/engine.test.ts tests/unit/wechatide-adapter.test.ts tests/unit/playwright-adapter.test.ts
```

Expected: capture methods and evidence do not exist.

- [ ] **Step 3: Add adapter capability**

Add optional start/stop methods and `CapturedRequest`. Do not add Playwright or automator types to adapter-core.

- [ ] **Step 4: Implement Playwright capture**

Attach a `page.on('request')` listener at start and remove that exact listener at stop. Store only method and URL.

- [ ] **Step 5: Implement miniapp transparent capture**

Extend `AutomatorProgram` with `exposeFunction`, `mockWxMethod`, and `restoreWxMethod`. Use a per-capture exposed callback name and restore `wx.request` in `finally`.

- [ ] **Step 6: Integrate with step execution**

Around UI actions with `expectRequests`:

1. start capture;
2. execute action;
3. wait the maximum `windowMs`;
4. stop capture;
5. compare each matcher and populate `StepResult.requests`;
6. fail the step on any count mismatch.

- [ ] **Step 7: Verify GREEN**

```bash
pnpm vitest run tests/unit/engine.test.ts tests/unit/wechatide-adapter.test.ts tests/unit/playwright-adapter.test.ts
pnpm --filter @testpilot/sdk typecheck
```

Expected: PASS.

### Task 6: Reports, CLI, Server, Web, and Agent compatibility

**Files:**
- Modify: `packages/reporter/src/report.ts`
- Modify: `packages/reporter/src/summary.ts`
- Modify: `packages/reporter/src/summary-report.ts`
- Modify: `apps/cli/src/commands/run.ts`
- Modify: `apps/server/src/services/run-service.ts`
- Modify: `apps/server/src/repositories/run-repo.ts`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/agent/src/agents/planner-agent.ts`
- Test: `tests/unit/reporter.test.ts`
- Test: `apps/server/src/server.test.ts`
- Test: `apps/agent/src/agent.test.ts`

**Interfaces:**
- Consumes: extended `RunSummary`
- Produces: grouped row-level report and backwards-compatible normalization

- [ ] **Step 1: Write failing report compatibility tests**

Test old result JSON without row/status additions, grouped template/row output, skipped and warning cards, row-aware flaky identity, and request assertion evidence.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/unit/reporter.test.ts apps/server/src/server.test.ts apps/agent/src/agent.test.ts
```

Expected: new statuses/totals are not represented.

- [ ] **Step 3: Add result normalization**

Normalize missing legacy values:

```ts
rowId ??= 'default'
rowIndex ??= 0
totals.templates ??= totals.cases
totals.skipped ??= 0
totals.warnings ??= 0
totals.stepsWarning ??= 0
```

- [ ] **Step 4: Update report rendering and aggregation**

Group rows under `caseId`, show rowId/status/skip reason/warnings, and use `${caseId}#${rowId}` as the historical identity.

- [ ] **Step 5: Update boundary types and messages**

Allow run status `skipped`; keep Agent Job completion successful while message states that test execution was skipped. CLI prints skipped/warning totals distinctly.

- [ ] **Step 6: Verify GREEN**

```bash
pnpm vitest run tests/unit/reporter.test.ts apps/server/src/server.test.ts apps/agent/src/agent.test.ts
pnpm typecheck
```

Expected: PASS.

### Task 7: Skill workflow, examples, and versioned delivery

**Files:**
- Modify: `skills/testpilot/workflows/test-requirements-review.md`
- Modify: `skills/testpilot/workflows/create-case.md`
- Modify: `skills/testpilot/workflows/validate.md`
- Modify: `skills/testpilot/workflows/run-case.md`
- Modify: `skills/testpilot/workflows/analyze-result.md`
- Modify: `skills/testpilot/rules/case-design.md`
- Modify: `skills/testpilot/rules/dsl.md`
- Modify: `skills/testpilot/rules/assertion.md`
- Modify: `skills/testpilot/SKILL.md`
- Modify: `skills/testpilot/manifest.yaml`
- Modify: `apps/cli/src/commands/init/skill-installer.ts`
- Modify: `apps/cli/src/commands/init/config-initializer.ts`
- Create: `examples/tests/e2e/data/promotion.yaml`
- Create: `examples/tests/e2e/data/discount-cases.yaml`
- Create: `examples/tests/e2e/cases/promotion-discount.yaml`
- Test: `apps/cli/src/commands/init/init.test.ts`

**Interfaces:**
- Produces: deterministic requirement-review and QA coverage workflow
- Produces: installed project guidance for new DSL features

- [ ] **Step 1: Define three Skill behavior evaluations**

Record expected behavior for:

1. a promotion PRD with four combination dimensions;
2. a QA library with covered/partial/missing/conflict mappings;
3. a project with no account/promotion concepts.

The third evaluation must omit invented account/coupon/PPM fields.

- [ ] **Step 2: Update requirement review workflow**

Require atomic rules, dimensions/value domains, explicit constraints, all valid combinations, excluded-combination reasons, TP generation, QA→TP mapping, and `tests/e2e/reviews/<slug>-coverage.md`.

- [ ] **Step 3: Update Case design and DSL guidance**

Document when data-driven grouping is allowed, variable scopes, static preflight limits, lifecycle semantics, and request-count assertions. State that AI proposes the minimum evidence-backed `requires` and humans/data systems provide real values.

- [ ] **Step 4: Update init-generated project conventions**

Add `tests/e2e/data/` and `tests/e2e/reviews/` guidance plus the rule that `testpilot.yaml variables` is the only environment-variable whitelist exposed to Cases.

- [ ] **Step 5: Add executable examples and bump Skill version**

Set `manifest.yaml` to the next minor version and update CLI package version only if release packaging requires exact parity. Examples must validate through the real DSL.

- [ ] **Step 6: Verify examples and init behavior**

```bash
pnpm vitest run apps/cli/src/commands/init/init.test.ts
pnpm csspilot validate examples/cases/promotion-discount.yaml
```

Expected: generated references include the new guidance and example Case validates.

### Task 8: Full verification and handoff

**Files:**
- No planned file changes; any failure returns to the owning task above

**Interfaces:**
- Consumes all previous tasks
- Produces a verified backwards-compatible repository state

- [ ] **Step 1: Run formatting/static checks**

```bash
pnpm lint
pnpm typecheck
```

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

- [ ] **Step 3: Build all packages**

```bash
pnpm build
```

- [ ] **Step 4: Run representative CLI validation**

Validate the existing golden Case and the new data-driven example. Run a mock-adapter dataset execution and inspect `result.json`/`report.json` for row IDs, skipped reasons, warnings, and request evidence.

- [ ] **Step 5: Inspect final diff**

```bash
git diff --check
git status --short
```

Confirm no credentials, generated runtime artifacts, `.env`, or unrelated files are included.
