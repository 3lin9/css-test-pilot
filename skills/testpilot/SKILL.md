# TestPilot

## What is TestPilot

TestPilot is an AI Native cross-platform testing infrastructure.

It lets AI understand, generate, validate and run business tests for Web and Mini Program apps.

TestPilot is a **tool, not a business test project**. Business cases always belong to the project (`tests/e2e/cases/`), never to TestPilot itself.

## When to use

Use TestPilot when the user wants to:

- create business test cases
- validate test cases
- run tests
- inspect test results

## Core workflow

1. Understand user requirement
2. Inspect project
3. Identify test target
4. Create TestPilot Case (`tests/e2e/cases/*.yaml`)
5. Validate Case (`npx csspilot validate`)
6. Run Case (`npx csspilot run`)
7. Analyze result (`npx csspilot report`)

## Important rules

- Never directly control Playwright.
- Never directly control WeChatIDE.
- Use TestPilot DSL to describe tests.
- Business cases belong to the project.
- Prefer existing project conventions.
- Never invent locators without evidence.
- Validate before running.

## CLI

```bash
npx csspilot init      # install TestPilot into the current project
npx csspilot validate  # validate cases against the DSL
npx csspilot list      # list cases (--tag smoke)
npx csspilot run       # run cases (file paths / --tag)
npx csspilot report    # generate JSON + HTML report
npx csspilot doctor    # check environment
```

## Directory map (business project)

- `.agents/skills/testpilot/` — this skill (AI usage spec)
- `.testpilot/` — TestPilot runtime state and artifacts
- `tests/e2e/cases/` — business cases
- `testpilot.yaml` — project-level TestPilot config

## Further reading

- `rules/case-design.md` — what a case is, evidence-first generation
- `rules/dsl.md` — case structure and the V0.1 action set
- `rules/locator.md` — locator forms and the no-invention rule
- `rules/assertion.md` — assertions and variable references
- `workflows/` — step-by-step workflows (create / validate / run / analyze)
