# TestPilot / csspilot：项目测试基础设施初始化设计

> 目标：让 AI Coding Agent 按本文直接实现 `csspilot init`，把一个普通业务项目接入 TestPilot，形成标准化、可验证、可被 Agent 使用的测试工程。

产品名称：**TestPilot**  
CLI 对外命令：**csspilot**

## 1. 定位

`csspilot init` 不只是“创建几个目录”，而是：

> **TestPilot Project Bootstrap / 测试项目接入器**

执行：

```bash
npx csspilot init
```

之后，一个普通业务项目应该具备运行 TestPilot 所需的基础设施：

```text
普通业务项目
  ↓
csspilot init
  ↓
TestPilot Project
  ↓
Agent + Skill
  ↓
DSL / Case
  ↓
Execution Engine
  ↓
Adapter
  ↓
Test / Report
```

## 2. 核心原则

### 2.1 不侵入业务项目

- 优先复用已有目录
- 不覆盖用户已有文件
- 不删除已有测试
- 不强制改变项目技术栈
- 不强制要求项目采用 TestPilot 之外的目录规范

已有 `tests/e2e` 时直接复用，不重复创建。

### 2.2 TestPilot 不拥有业务 Case

业务 Case 属于业务项目：

```text
tests/e2e/cases/
```

TestPilot Core 不内置：

```text
login / order / payment / coupon / user / product
```

等业务概念。

### 2.3 Agent 不直接操作 Adapter

保持：

```text
AI Agent
   ↓
TestPilot Skill
   ↓
CLI / SDK
   ↓
Case / DSL
   ↓
Execution Engine
   ↓
Adapter
   ├── Playwright
   └── WeChatIDE
```

禁止：

```text
Agent → Playwright
Agent → WeChatIDE
Skill → direct Playwright
```

---

# 3. `csspilot init` 职责

`init` 完成以下 8 类工作：

1. 项目识别
2. 测试目录初始化
3. Agent Skill 初始化
4. TestPilot 配置初始化
5. 环境配置初始化
6. Adapter 检测与初始化
7. Git / CI 初始化能力准备
8. TestPilot Doctor 健康检查

---

# 4. Golden Path

```text
                    csspilot init
                         │
                         ▼
                Detect Project
                         ↓
                Detect Adapters
                         ↓
                Init TestPilot Config
                         ↓
                Init Test Structure
                         ↓
                Install Agent Skill
                         ↓
                Init Environment
                         ↓
                Prepare CI
                         ↓
                Run Doctor
                         ↓
                    Ready to Test
```

---

# 5. 项目识别

自动检测：

```text
Project name
Project type
Language
Package manager
Git repository
Existing test structure
Existing Playwright
Existing WeChat project
WeChat DevTools
Existing TestPilot configuration
```

示例：

```text
✔ Project: mall-miniapp
✔ Type: wechat-miniapp
✔ Language: TypeScript
✔ Package Manager: pnpm
✔ Git repository detected

Testing adapters:

✔ WeChat project detected
✔ WeChat DevTools detected
✗ Playwright not detected
```

V0.1 项目类型：

```text
web
wechat-miniapp
hybrid
unknown
```

映射：

```text
web → Playwright
wechat-miniapp → WeChatIDE
hybrid → Playwright + WeChatIDE
unknown → 仍允许完成初始化
```

---

# 6. 测试目录初始化

没有测试目录时：

```text
tests/
└── e2e/
    ├── cases/
    ├── fixtures/
    └── data/
```

含义：

```text
cases/    → 业务 Test Case
fixtures/ → 通用 Fixture
data/     → 测试数据
```

如果已有：

```text
tests/e2e/
```

直接复用。

如果已有其他 E2E 目录，优先提示并复用，不强制迁移。

---

# 7. Agent Skill 初始化

生成：

```text
.agents/
└── skills/
    └── testpilot/
        ├── SKILL.md
        ├── references/
        └── workflows/
```

注意：

`.agents` 是 TestPilot 推荐的 Agent Skill 源目录，不要求所有 Agent 都原生读取它。

用户可以按 Agent 需要复制到：

```text
.cursor/skills/
.claude/skills/
.qoder/skills/
...
```

TestPilot V0.1 不需要为每个 Agent 单独维护安装器。

---

# 8. 项目级 Agent 上下文

初始化时生成项目级上下文：

```text
.agents/
└── skills/
    └── testpilot/
        ├── SKILL.md
        ├── references/
        │   ├── project.md
        │   ├── test-conventions.md
        │   └── adapters.md
        └── workflows/
            ├── create-case.md
            ├── run-case.md
            └── analyze-result.md
```

`project.md` 描述：

```text
Project name
Project type
Test directory
Case directory
Available adapters
Default environment
Default workspace
```

`test-conventions.md` 告诉 Agent：

```text
1. E2E Case 位于 tests/e2e/cases
2. Case 使用 TestPilot DSL
3. 不允许直接调用 Playwright
4. 不允许直接调用 WeChatIDE
5. 不允许在 Case 中写明文密码
6. 优先复用已有 Case
7. 新增 Case 必须通过 csspilot validate
8. Case ID 必须唯一
```

不要把业务知识写进 TestPilot Core。

---

# 9. TestPilot 配置

初始化：

```text
.testpilot/
├── project.json
└── artifacts/
```

以及：

```text
testpilot.yaml
```

## `.testpilot/project.json`

示例：

```json
{
  "version": 1,
  "projectId": "proj_01HXYZ",
  "testDir": "tests/e2e",
  "caseDir": "tests/e2e/cases",
  "defaultAdapter": "wechatide"
}
```

`projectId` 用于关联 TestPilot Server。

## `testpilot.yaml`

示例：

```yaml
version: 1

project:
  name: mall-miniapp

test:
  directory: tests/e2e
  caseDirectory: tests/e2e/cases

environment:
  default: test

adapters:
  - wechatide

workspace:
  default: mall-test
```

---

# 10. 环境配置

支持：

```text
local
test
staging
```

等环境。

Case 只引用：

```yaml
environment: test
accountRef: test-user
```

禁止把：

```text
username
password
token
cookie
```

直接写进 Case。

环境变量示例：

```yaml
environment:
  default: test

  test:
    baseUrl: ${TEST_BASE_URL}

  staging:
    baseUrl: ${STAGING_BASE_URL}
```

敏感信息由：

```text
Environment
+
Server Secret
+
CI Secret
```

管理。

CLI 初始化只能生成配置模板，不生成真实密码/token。

---

# 11. Adapter 自动检测

检测：

```text
Playwright
WeChat DevTools
其他 TestPilot Adapter
```

示例：

```text
Available adapters:

✓ playwright
✓ wechatide
```

如果环境不完整：

```text
Adapter: wechatide
Status: needs configuration

Reason:
WeChat DevTools not found
```

Adapter 不可用不能阻止整个项目初始化。

---

# 12. `csspilot doctor`

独立命令：

```bash
npx csspilot doctor
```

同时 `csspilot init` 完成后自动执行一次。

检查范围：

### Runtime

```text
Node.js
Package Manager
Git
```

### TestPilot

```text
.testpilot/project.json
testpilot.yaml
Skill
```

### Test

```text
tests/e2e
tests/e2e/cases
Case validity
```

### Adapter

```text
Playwright
WeChatIDE
```

### Environment

```text
Required environment variables
Required secrets
```

### Server

如果项目配置了 Server：

```text
Server URL
Connection
Project association
```

示例：

```text
TestPilot Doctor

Project
────────────────────────
✔ Project detected
✔ Git repository
✔ project.json
✔ testpilot.yaml

Test
────────────────────────
✔ tests/e2e
✔ cases directory
✔ Case validation

Agent
────────────────────────
✔ TestPilot Skill
✔ Project testing guide

Adapters
────────────────────────
✔ Playwright
⚠ WeChat DevTools not configured

Environment
────────────────────────
✔ TEST_BASE_URL
✗ TEST_ACCOUNT missing

Server
────────────────────────
✔ Connected

Result
────────────────────────
1 error
1 warning
```

---

# 13. Git / CI

不要在 `init` 中强制修改用户 CI。

可以检测：

```text
.github/workflows
.gitlab-ci.yml
```

提供：

```bash
npx csspilot ci init
```

生成 CI 模板。

基本流程：

```text
git push
   ↓
CI
   ├── csspilot validate
   ├── csspilot sync-metadata
   └── optional csspilot run
```

其中：

> `sync-metadata` 是 Git Push → TestPilot Server 的正式同步边界。

不要让开发人员本地把未 Push 的 Case 随意同步到共享 Server。

---

# 14. 标准项目结构

典型 Web 项目：

```text
my-project/
│
├── .agents/
│   └── skills/
│       └── testpilot/
│           ├── SKILL.md
│           ├── references/
│           │   ├── project.md
│           │   ├── test-conventions.md
│           │   └── adapters.md
│           └── workflows/
│
├── .testpilot/
│   ├── project.json
│   └── artifacts/
│
├── tests/
│   └── e2e/
│       ├── cases/
│       ├── fixtures/
│       └── data/
│
├── testpilot.yaml
│
└── .github/
    └── workflows/
        └── testpilot.yml
```

---

# 15. V0.1 明确禁止

## 不自动生成大量业务 Case

禁止：

```text
csspilot init
→ 自动生成登录、下单、支付等大量业务 Case
```

## 不自动创建业务 Skill

禁止：

```text
skills/
├── login
├── order
├── payment
└── coupon
```

## 不自动配置业务系统

禁止：

```yaml
ppm:
  url: ...

mallAdmin:
  url: ...

payment:
  url: ...
```

跨项目关系通过：

```text
Project
  ↓
Environment
  ↓
Workspace
  ↓
Project Environment Binding
```

表达。

## 不把 Agent 做成第二套执行引擎

Agent 不负责：

```text
Playwright 调用
WeChatIDE 调用
截图实现
浏览器生命周期管理
```

这些属于：

```text
Execution Engine
Adapter
```

---

# 16. CLI 命令

V0.1：

```bash
npx csspilot init
npx csspilot doctor
npx csspilot validate
npx csspilot list
npx csspilot run
npx csspilot report
npx csspilot sync-metadata
```

可选：

```bash
npx csspilot ci init
```

---

# 17. 幂等性

`csspilot init` 必须幂等。

连续执行：

```bash
npx csspilot init
npx csspilot init
npx csspilot init
```

不能：

- 覆盖用户配置
- 重复生成内容
- 删除 Case
- 修改已有 CI
- 重置 projectId
- 重复安装 Skill

应该输出：

```text
✔ TestPilot already initialized
✔ Skill already exists
✔ Test directory already exists
✔ Configuration already exists
```

已有配置默认：

> Keep existing

---

# 18. 安全要求

CLI 初始化必须：

1. 不读取并上传用户密码。
2. 不把 `.env` 内容写入日志。
3. 不把 Secret 写入 Case。
4. 不自动执行未知远程脚本。
5. 不安装未经确认的 npm 包。
6. 不修改用户已有 CI 文件。
7. 不删除已有测试文件。
8. 不覆盖已有配置。
9. Server 同步只同步 Case Metadata，不上传 Case Secret。
10. 所有自动执行动作必须有明确的本地文件范围。

---

# 19. 推荐代码结构

建议：

```text
apps/cli/src/
└── commands/
    └── init/
        ├── index.ts
        ├── detector.ts
        ├── project-detector.ts
        ├── test-structure.ts
        ├── skill-installer.ts
        ├── config-initializer.ts
        ├── environment-initializer.ts
        ├── adapter-detector.ts
        ├── ci-initializer.ts
        └── doctor.ts
```

核心接口：

```ts
interface InitContext {
  cwd: string;
  project: ProjectInfo;
  existingConfig: ExistingConfig;
  adapters: AdapterInfo[];
}
```

步骤：

```ts
detectProject(context)
detectAdapters(context)
initTestStructure(context)
initTestPilotConfig(context)
initAgentSkill(context)
initEnvironment(context)
initCI(context)
runDoctor(context)
```

---

# 20. 测试要求

必须覆盖：

### 新项目

```text
无 TestPilot
→ init
→ 所有基础文件正确创建
```

### 已有项目

```text
已有 tests/e2e
→ 不覆盖
```

### 重复 init

```text
init
→ init
→ 文件不重复、不破坏
```

### 已有配置

```text
已有 testpilot.yaml
→ 保留原配置
```

### 不同项目类型

```text
Web
WeChat MiniApp
Hybrid
Unknown
```

### Adapter 不可用

```text
WeChat DevTools 不存在
→ init 成功
→ doctor 给出 warning
```

### Secret

确保：

```text
.env
密码
Token
Cookie
```

不会被写入：

```text
Case
Skill
日志
Metadata
```

---

# 21. 验收标准

执行：

```bash
npx csspilot init
```

必须满足：

- [ ] 能识别当前项目
- [ ] 能识别 Git
- [ ] 能识别已有测试目录
- [ ] 能识别可用 Adapter
- [ ] 创建 `.testpilot/project.json`
- [ ] 创建/保留 `testpilot.yaml`
- [ ] 创建/复用 `tests/e2e`
- [ ] 创建/保留 `tests/e2e/cases`
- [ ] 安装 `.agents/skills/testpilot`
- [ ] 生成项目级测试规范
- [ ] 不覆盖已有文件
- [ ] 可重复执行
- [ ] 初始化完成后自动 Doctor
- [ ] Doctor 能给出明确的问题和解决建议
- [ ] 不泄露 Secret
- [ ] 不创建业务 Case
- [ ] 不创建业务 Skill
- [ ] 不直接依赖具体业务系统

---

# 22. Agent Coding 任务

请直接按照本文实现。

实现顺序：

```text
Phase 1  项目检测
    ↓
Phase 2  TestPilot 配置初始化
    ↓
Phase 3  测试目录初始化
    ↓
Phase 4  Agent Skill 初始化
    ↓
Phase 5  Adapter 检测
    ↓
Phase 6  Environment 配置
    ↓
Phase 7  Doctor
    ↓
Phase 8  CI init
    ↓
Phase 9  完整测试
```

原则：

> **先实现最小可用 Golden Path，再扩展能力。**

第一阶段不要引入：

- 数据库
- RAG
- LLM
- Autonomous Agent
- AI Repair
- 复杂插件系统
- RBAC
- 分布式 Runner
- 复杂 Workspace 编排

最终目标：

> **让一个业务项目具备标准化的 TestPilot 测试基础设施，并让人和 AI Agent 都能立即开始使用 TestPilot。**
