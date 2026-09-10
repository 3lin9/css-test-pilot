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
5. Validate Case (`npx testpilot validate`)
6. Run Case (`npx testpilot run`)
7. Analyze result (`npx testpilot report`)

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
npx testpilot init      # install TestPilot into the current project
npx testpilot validate  # validate cases against the DSL
npx testpilot list      # list cases (--tag smoke)
npx testpilot run       # run cases (file paths / --tag)
npx testpilot report    # generate JSON + HTML report
npx testpilot doctor    # check environment
```

## Directory map (business project)

- `.ai/skills/testpilot/` — this skill (AI usage spec)
- `.testpilot/` — TestPilot runtime state and artifacts
- `tests/e2e/cases/` — business cases
- `testpilot.yaml` — project-level TestPilot config

## Further reading

- `rules/case-design.md` — what a case is, evidence-first generation
- `rules/dsl.md` — case structure and the V0.1 action set
- `rules/locator.md` — locator forms and the no-invention rule
- `rules/assertion.md` — assertions and variable references
- `workflows/` — step-by-step workflows (create / validate / run / analyze)
