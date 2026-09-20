// TestPilot 研究进度汇报 PPT 构建脚本(pptxgenjs)
const pptxgen = require('pptxgenjs')

const p = new pptxgen()
p.layout = 'LAYOUT_WIDE'
p.author = 'TestPilot'
p.title = 'TestPilot 研究进度汇报'

// ---- 调色板(测试主题:深钢蓝 + 信号绿/红 + 仪表琥珀)----
const DARK = '0F2233'      // 封面/封底深色底
const CARD_DARK = '1B3A5C' // 深色页卡片
const BG = 'FFFFFF'
const PRIMARY = '1B4965'   // 深钢蓝:标题/结构元素
const PTINT = 'E8F0F8'     // 主色浅底
const ACCENT = 'E8A317'    // 仪表琥珀:关键强调
const OK = '1A7F37'
const FAIL = 'CF222E'
const TEXT = '1F2937'
const MUTED = '5A6B7B'
const F = 'Microsoft YaHei'

const T = (o) => ({ fontFace: F, ...o })
const shadow = () => ({ type: 'outer', color: '16232E', blur: 7, offset: 2, angle: 90, opacity: 0.13 })

function kicker(s, text) {
  s.addText(text, T({ x: 0.5, y: 0.3, w: 12.33, h: 0.3, fontSize: 12, bold: true, color: ACCENT, charSpacing: 2, margin: 0 }))
}
function title(s, text) {
  s.addText(text, T({ x: 0.5, y: 0.6, w: 12.33, h: 0.62, fontSize: 27, bold: true, color: PRIMARY, margin: 0 }))
}
function pageNum(s, n) {
  s.addText('TestPilot · ' + n + ' / 7', T({ x: 10.7, y: 7.08, w: 2.13, h: 0.3, fontSize: 12, color: MUTED, align: 'right', margin: 0 }))
}
function chevron(s, x, y, w, h, text, fill, textColor) {
  s.addText(text, T({ shape: p.shapes.CHEVRON, x, y, w, h, fill: { color: fill }, align: 'center', fontSize: 14, bold: true, color: textColor || 'FFFFFF', margin: 0 }))
}
function box(s, x, y, w, h, text, opts) {
  const o = opts || {}
  s.addText(text, T({ shape: p.shapes.ROUNDED_RECTANGLE, rectRadius: 0.06, x, y, w, h,
    fill: { color: o.fill || 'FFFFFF' }, line: o.line === false ? undefined : { color: 'D0D7DE', width: 1 },
    align: 'center', fontSize: o.fontSize || 13, bold: o.bold !== false, color: o.color || PRIMARY, margin: 0.04 }))
}
function arrow(s, x1, y1, x2, y2) {
  s.addShape(p.shapes.LINE, { x: x1, y: y1, w: x2 - x1, h: y2 - y1,
    line: { color: PRIMARY, width: 2, endArrowType: 'triangle' },
    flipH: x2 < x1, flipV: y2 < y1 })
}
const OKB = (text) => ({ text: '✓ ' + text, options: { color: OK, bold: true } })

// ================= S1 封面 =================
{
  const s = p.addSlide()
  s.background = { color: DARK }
  s.addText('AI NATIVE · 跨端业务测试基础设施', T({ x: 0.7, y: 1.0, w: 11, h: 0.35, fontSize: 13, bold: true, color: ACCENT, charSpacing: 2, margin: 0 }))
  s.addText('TestPilot', T({ x: 0.7, y: 1.45, w: 11.9, h: 1.15, fontSize: 60, bold: true, color: 'FFFFFF', margin: 0 }))
  s.addText('研究进度汇报', T({ x: 0.7, y: 2.62, w: 11.9, h: 0.85, fontSize: 36, bold: true, color: 'E8F0F8', margin: 0 }))
  s.addText('让 AI 能理解、生成、校验并执行业务测试 —— 从需求评审到结果分析的全流程闭环',
    T({ x: 0.7, y: 3.7, w: 11.5, h: 0.5, fontSize: 16, color: '9DB2C6', margin: 0 }))

  const stats = [
    ['8 / 8', '研究阶段完成'],
    ['双端', 'Adapter 真机验证'],
    ['csspilot', 'npm 已发布 0.4.0'],
    ['跨端', '黄金链路实测通过'],
  ]
  stats.forEach((it, i) => {
    const x = 0.7 + i * 3.12
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: 4.85, w: 2.88, h: 1.15, rectRadius: 0.08, fill: { color: CARD_DARK } })
    s.addText(it[0], T({ x: x + 0.2, y: 4.98, w: 2.5, h: 0.45, fontSize: 19, bold: true, color: 'FFFFFF', margin: 0 }))
    s.addText(it[1], T({ x: x + 0.2, y: 5.44, w: 2.5, h: 0.35, fontSize: 12, color: '9DB2C6', margin: 0 }))
  })
  s.addText('2026-09 · 内部研究汇报 · csspilot@0.5.0 待发布', T({ x: 0.7, y: 6.85, w: 11, h: 0.35, fontSize: 12, color: '9DB2C6', margin: 0 }))
}

// ================= S2 定位与总体架构 =================
{
  const s = p.addSlide()
  s.background = { color: BG }
  kicker(s, 'OVERVIEW · 定位与架构')
  title(s, '定位与总体架构')
  s.addShape(p.shapes.RECTANGLE, { x: 0.5, y: 1.06, w: 12.33, h: 0.6, fill: { color: PTINT } })
  s.addText([
    { text: 'TestPilot 是测试基础设施,不是业务测试项目:', options: { bold: true, breakLine: true } },
    { text: '业务项目定义测什么、怎么算通过;TestPilot 定义怎么描述、校验、执行', options: {} },
  ], T({ x: 0.68, y: 1.06, w: 12.0, h: 0.6, fontSize: 12.5, color: TEXT, valign: 'middle', margin: 0 }))

  s.addText('核心链路', T({ x: 0.5, y: 1.88, w: 6, h: 0.3, fontSize: 12, bold: true, color: MUTED, margin: 0 }))
  const chain = [
    ['AI', '需求 / 评审'],
    ['Skill', '能力规范'],
    ['CLI', '统一入口'],
    ['DSL', '测试描述'],
    ['Engine', '执行核心'],
  ]
  chain.forEach((it, i) => {
    const x = 0.5 + i * 2.46
    const isEngine = i === 4
    s.addShape(p.shapes.CHEVRON, { x, y: 2.2, w: 2.3, h: 0.85, fill: { color: isEngine ? ACCENT : PRIMARY } })
    s.addText([
      { text: it[0], options: { fontSize: 14.5, bold: true, breakLine: true, color: isEngine ? '16232E' : 'FFFFFF' } },
      { text: it[1], options: { fontSize: 10.5, color: isEngine ? '16232E' : 'D7E3F4' } },
    ], T({ shape: p.shapes.CHEVRON, x, y: 2.2, w: 2.3, h: 0.85, align: 'center', valign: 'middle', margin: 0 }))
  })

  s.addText('执行与取证', T({ x: 0.5, y: 3.32, w: 6, h: 0.3, fontSize: 12, bold: true, color: MUTED, margin: 0 }))
  const row2 = [
    ['Playwright Adapter', 'Web 端', 0.5],
    ['WeChatIDE Adapter', '小程序端', 3.75],
    ['Evidence', '截图 / 视频 / trace / 日志', 7.0],
    ['Reporter', 'JSON + 交互式 HTML', 10.25],
  ]
  row2.forEach((it) => {
    box(s, it[2], 3.68, 2.7, 0.85, it[0], { fontSize: 13, color: TEXT,
      fill: it[0] === 'Evidence' || it[0] === 'Reporter' ? PTINT : 'FFFFFF' })
    s.addText(it[1], T({ x: it[2], y: 4.56, w: 2.7, h: 0.3, fontSize: 11.5, color: MUTED, align: 'center', margin: 0 }))
  })
  arrow(s, 1.85, 4.53, 1.85, 4.98)   // web -> (示意汇入证据)
  arrow(s, 5.1, 4.53, 5.1, 4.98)     // 小程序 -> (示意汇入证据)
  s.addText('Adapter 由 Engine 统一调度;Evidence 汇聚后由 Reporter 输出统一报告',
    T({ x: 0.5, y: 5.35, w: 12.33, h: 0.3, fontSize: 12, color: MUTED, margin: 0 }))

  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 5.85, w: 6.0, h: 1.25, rectRadius: 0.07, fill: { color: PTINT } })
  s.addText([
    { text: '设计铁律 1 · Case 属于业务项目', options: { bold: true, breakLine: true, color: PRIMARY } },
    { text: 'TestPilot 定义怎么测;业务项目定义测什么、怎么算通过', options: { color: TEXT } },
  ], T({ x: 0.72, y: 5.98, w: 5.6, h: 1.0, fontSize: 12.5, margin: 0 }))
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 6.83, y: 5.85, w: 6.0, h: 1.25, rectRadius: 0.07, fill: { color: PTINT } })
  s.addText([
    { text: '设计铁律 2 · Evidence-first', options: { bold: true, breakLine: true, color: PRIMARY } },
    { text: 'AI 不凭空生成测试:先读代码与页面,再写步骤', options: { color: TEXT } },
  ], T({ x: 7.05, y: 5.98, w: 5.6, h: 1.0, fontSize: 12.5, margin: 0 }))
  pageNum(s, 2)
}

// ================= S3 研究进度 =================
{
  const s = p.addSlide()
  s.background = { color: BG }
  kicker(s, 'PROGRESS · 研究进度')
  title(s, '研究进度:八个阶段全部完成')

  s.addText('8 / 8', T({ x: 0.5, y: 1.5, w: 3.4, h: 1.2, fontSize: 66, bold: true, color: PRIMARY, margin: 0 }))
  s.addText('研究阶段完成', T({ x: 0.55, y: 2.75, w: 3.3, h: 0.4, fontSize: 14, color: MUTED, margin: 0 }))
  const chips = [
    'csspilot 已发布 npmjs(0.1.0 → 0.4.0)',
    '跨端黄金链路真机实测通过',
    '80+ 单测 · typecheck · lint 全绿',
  ]
  chips.forEach((text, i) => {
    const y = 3.4 + i * 0.66
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.5, y, w: 3.45, h: 0.52, rectRadius: 0.06, fill: { color: PTINT } })
    s.addText(text, T({ x: 0.68, y, w: 3.15, h: 0.52, fontSize: 12, color: TEXT, valign: 'middle', margin: 0 }))
  })

  const phases = [
    ['P1', '项目骨架', 'pnpm workspace / Turbo / TS / ESLint / Vitest'],
    ['P2', 'CLI 六命令', 'init · validate · list · run · report · doctor'],
    ['P3', 'DSL 规范', 'schema(zod)/ parser(yaml)/ validator'],
    ['P4', '执行引擎', 'Context / StepExecutor / EventBus / 取证落盘'],
    ['P5', 'Playwright Adapter', '9 个基础 Action 全部可用(Web 端)'],
    ['P6', 'WeChatIDE Adapter', '基于官方自动化 SDK,已真机验证'],
    ['P7', '跨端黄金 Case', '小程序下单 → Web 后台验证,已实测'],
    ['P8', 'AI Skill 体系', '评审 / 生成 / 校验 / 执行 / 分析五工作流'],
  ]
  phases.forEach((it, i) => {
    const y = 1.35 + i * 0.7
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 4.3, y, w: 0.72, h: 0.46, rectRadius: 0.06, fill: { color: PRIMARY } })
    s.addText(it[0], T({ x: 4.3, y, w: 0.72, h: 0.46, fontSize: 12, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0 }))
    s.addText(it[1], T({ x: 5.2, y, w: 3.6, h: 0.46, fontSize: 14, bold: true, color: TEXT, valign: 'middle', margin: 0 }))
    s.addText(it[2], T({ x: 8.85, y, w: 4.0, h: 0.46, fontSize: 11.5, color: MUTED, valign: 'middle', margin: 0 }))
    s.addText('✓', T({ x: 12.5, y, w: 0.4, h: 0.46, fontSize: 15, bold: true, color: OK, margin: 0 }))
    if (i < phases.length - 1) {
      s.addShape(p.shapes.LINE, { x: 4.3, y: y + 0.58, w: 8.55, h: 0, line: { color: 'E3E8ED', width: 0.75 } })
    }
  })
  s.addText('说明:P1-P5 已包含在已发布的 csspilot@0.4.0;0.5.0(汇总报告等)内容就绪、待发布',
    T({ x: 4.3, y: 6.95, w: 8.5, h: 0.3, fontSize: 12, color: MUTED, margin: 0 }))
  pageNum(s, 3)
}

// ================= S4 使用流程 =================
{
  const s = p.addSlide()
  s.background = { color: BG }
  kicker(s, 'WORKFLOW · 使用介绍')
  title(s, '使用流程:从需求到报告')

  const steps = [
    ['需求评审', 'AI 工作流', ['产出测试点清单 TP-xxx', '多平台执行信息澄清']],
    ['生成 Case', 'create-case 工作流', ['tests/e2e/cases/*.yaml', '回链测试点编号']],
    ['validate', 'csspilot validate', ['DSL + 语义校验', '未通过不进 run']],
    ['run', 'csspilot run --tag', ['Engine + 双 Adapter', '截图 / 视频 / trace 取证']],
    ['report', 'csspilot report', ['交互式 HTML', 'summary.json 供 AI']],
    ['分析改进', 'analyze-result 工作流', ['改 Case 或确认产品 bug']],
  ]
  steps.forEach((it, i) => {
    const x = 0.5 + i * 1.97
    s.addShape(p.shapes.CHEVRON, { x, y: 1.5, w: 1.95, h: 0.7, fill: { color: PRIMARY } })
    s.addText(it[0], T({ shape: p.shapes.CHEVRON, x, y: 1.5, w: 1.95, h: 0.7, fontSize: 13.5, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0 }))
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: 2.45, w: 1.85, h: 1.95, rectRadius: 0.06, fill: { color: 'FFFFFF' },
      shadow: { type: 'outer', color: '16232E', blur: 6, offset: 2, angle: 90, opacity: 0.12 } })
    s.addText(it[1], T({ x: x + 0.12, y: 2.58, w: 1.62, h: 0.34, fontSize: 12, bold: true, color: PRIMARY, margin: 0 }))
    s.addText(it[2].map((line, li) => ({ text: line, options: { breakLine: li < it[2].length - 1 } })),
      T({ x: x + 0.12, y: 2.95, w: 1.65, h: 1.35, fontSize: 12, color: TEXT, margin: 0 }))
  })

  // 回归迭代回路
  s.addShape(p.shapes.LINE, { x: 11.3, y: 4.55, w: 0, h: 0.35, line: { color: MUTED, width: 1.5 } })
  s.addShape(p.shapes.LINE, { x: 3.4, y: 4.9, w: 7.9, h: 0, line: { color: MUTED, width: 1.5, dashType: 'dash', beginArrowType: 'triangle' }, flipH: true })
  s.addShape(p.shapes.LINE, { x: 3.4, y: 4.55, w: 0, h: 0.35, line: { color: MUTED, width: 1.5 } })
  s.addText('回归迭代:需求变更 → 重新评审与生成', T({ x: 4.4, y: 4.98, w: 6, h: 0.3, fontSize: 12, color: MUTED, margin: 0 }))

  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 5.5, w: 12.33, h: 0.95, rectRadius: 0.07, fill: { color: 'E9F4EC' } })
  s.addText([
    { text: '✓ 跨端黄金路径(已实测):', options: { bold: true, color: OK } },
    { text: '小程序下单 → extract 订单号 → Web 后台 assert 订单存在 —— 变量跨端传递,一次 run 打通双端', options: { color: TEXT } },
  ], T({ x: 0.72, y: 5.5, w: 11.9, h: 0.95, fontSize: 13, valign: 'middle', margin: 0 }))
  s.addText('一次性接入:npx csspilot init(生成 testpilot.yaml + .env.example + AI Skill,自动检测 Web / 小程序环境)',
    T({ x: 0.5, y: 6.65, w: 12.33, h: 0.3, fontSize: 12, color: MUTED, margin: 0 }))
  pageNum(s, 4)
}

// ================= S5 定义的规范 =================
{
  const s = p.addSlide()
  s.background = { color: BG }
  kicker(s, 'SPEC · 定义规范')
  title(s, '定义的规范')

  const cols = [
    {
      h: 'DSL 规范(测试描述语言)',
      rows: [
        '9 个基础 Action:launch · navigate · click · input · select · wait · assert · extract · screenshot',
        'Case 结构:id + name + steps,description 回链测试点编号',
        '定位铁律:locator 必须来自真实页面证据,禁止凭空编写',
        '红线:login / order 等业务动作不进 DSL',
      ],
    },
    {
      h: '环境与凭据规范',
      rows: [
        'environment 段:baseUrl 用 ${VAR} 引用,禁止明文',
        '.env 自动加载,真实环境变量优先;自动加入 .gitignore',
        '账号:accountRef 引用,凭据由 Server Secrets / 环境变量管理(值不回显)',
        'Workspace:跨端环境组合,跨端需求按需启用',
      ],
    },
    {
      h: 'AI Skill 与取证规范',
      rows: [
        '体系:SKILL.md + rules×4 + workflows×5(评审 / 生成 / 校验 / 执行 / 分析)',
        '测试需求评审:可测性检查 → 测试点清单(TP 编号回链)',
        '取证四件套:screenshot / video / trace / log + events.ndjson 事件流',
        '报告:单文件交互式 HTML(步骤树 / 失败分类筛选 / 历史趋势)',
      ],
    },
  ]
  cols.forEach((col, i) => {
    const x = 0.5 + i * 4.35
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: 1.4, w: 4.13, h: 5.55, rectRadius: 0.07, fill: { color: 'FFFFFF' },
      shadow: { type: 'outer', color: '16232E', blur: 7, offset: 2, angle: 90, opacity: 0.12 } })
    s.addText(col.h, T({ x: x + 0.25, y: 1.65, w: 3.65, h: 0.4, fontSize: 15.5, bold: true, color: PRIMARY, margin: 0 }))
    s.addShape(p.shapes.LINE, { x: x + 0.25, y: 2.12, w: 3.63, h: 0, line: { color: 'D0D7DE', width: 1 } })
    s.addText(col.rows.map((row, ri) => ({
      text: row, options: { bullet: { code: '25B8', indent: 10 }, breakLine: ri < col.rows.length - 1, color: TEXT },
    })), T({ x: x + 0.25, y: 2.3, w: 3.68, h: 4.4, fontSize: 12.5, paraSpaceAfter: 10, margin: 0 }))
  })
  pageNum(s, 5)
}

// ================= S6 交付成果与实证 =================
{
  const s = p.addSlide()
  s.background = { color: BG }
  kicker(s, 'DELIVERY · 交付与验证')
  title(s, '交付成果与实证')

  const cards = [
    { h: 'csspilot CLI', sub: 'npm 已发布 0.4.0', rows: ['init / validate / list / run / report', 'update · doctor · skill · ci init', 'esbuild 单文件打包,skill 随包分发'] },
    { h: 'Control Plane + Web 控制台', sub: 'Fastify + SQLite + Vue3', rows: ['项目 / 用例 / 运行 / 报告 API', 'Git 元数据同步(快照式)', '运行详情:Step 级结果 + 取证下载'] },
    { h: 'AI Skill 体系', sub: 'SKILL.md + rules×4 + workflows×5', rows: ['测试需求评审(可测性 + 测试点)', '需求 → 用例 → 执行 → 分析全流程', '随 CLI 版本自动更新'] },
  ]
  cards.forEach((card, i) => {
    const x = 0.5 + i * 4.35
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: 1.4, w: 4.13, h: 2.5, rectRadius: 0.07, fill: { color: 'FFFFFF' },
      shadow: { type: 'outer', color: '16232E', blur: 7, offset: 2, angle: 90, opacity: 0.12 } })
    s.addText(card.h, T({ x: x + 0.25, y: 1.6, w: 3.65, h: 0.4, fontSize: 15.5, bold: true, color: PRIMARY, margin: 0 }))
    s.addText(card.sub, T({ x: x + 0.25, y: 2.0, w: 3.65, h: 0.3, fontSize: 11.5, color: MUTED, margin: 0 }))
    s.addText(card.rows.map((row, ri) => ({
      text: row, options: { bullet: { code: '25B8', indent: 10 }, breakLine: ri < card.rows.length - 1, color: TEXT },
    })), T({ x: x + 0.25, y: 2.4, w: 3.68, h: 1.4, fontSize: 12, paraSpaceAfter: 6, margin: 0 }))
  })

  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 4.25, w: 12.83, h: 2.5, rectRadius: 0.07, fill: { color: 'E9F4EC' } })
  s.addText('实测验证', T({ x: 0.78, y: 4.45, w: 6, h: 0.35, fontSize: 14, bold: true, color: OK, margin: 0 }))
  const checks = [
    '跨端黄金链路实测通过:小程序下单 → extract 订单号 → Web 后台断言,变量跨端传递',
    '真机环境验证:微信开发者工具 2.02 自动化链路全自动冷启动(含信任弹窗 / 路径 / 编码问题修复)',
    '取证齐备:截图 / 视频 / trace / 日志 / NDJSON 事件流,失败自动归档',
    '质量门禁:80+ 单测 · typecheck · lint 全绿;npm 连续发布 0.1.0 → 0.4.0',
  ]
  checks.forEach((text, i) => {
    s.addText([OKB(text)], T({ x: 0.78, y: 4.9 + i * 0.42, w: 11.9, h: 0.4, fontSize: 12.5, margin: 0 }))
  })
  pageNum(s, 6)
}

// ================= S7 下一步计划 =================
{
  const s = p.addSlide()
  s.background = { color: DARK }
  s.addText('下一步计划', T({ x: 0.7, y: 0.55, w: 11.9, h: 0.7, fontSize: 30, bold: true, color: 'FFFFFF', margin: 0 }))

  const plans = [
    ['近期(0.5.x)', '业务项目接入试点 · Allure results 兼容开关 · 报告补充分支元数据 · 团队推广'],
    ['中期', 'Server Secrets 运行时解析(本地不落盘)· Web 控制台趋势报表 · 微信 cli agent 能力跟踪'],
    ['远期(Phase 12)', 'Agent 探索性测试:需求发现 → 自动生成 Case → 执行 → 分析'],
  ]
  plans.forEach((it, i) => {
    const y = 1.5 + i * 1.15
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.7, y, w: 11.93, h: 0.95, rectRadius: 0.08, fill: { color: CARD_DARK } })
    s.addText(it[0], T({ x: 0.95, y: y + 0.08, w: 2.6, h: 0.8, fontSize: 15, bold: true, color: ACCENT, valign: 'middle', margin: 0 }))
    s.addText(it[1], T({ x: 3.7, y: y + 0.08, w: 8.7, h: 0.8, fontSize: 13, color: 'E8F0F8', valign: 'middle', margin: 0 }))
  })

  s.addText('团队接入三步', T({ x: 0.7, y: 5.15, w: 6, h: 0.35, fontSize: 14, bold: true, color: 'E8F0F8', margin: 0 }))
  s.addText('npx csspilot init   →   评审需求 & 生成 Case   →   validate / run / report',
    T({ x: 0.7, y: 5.52, w: 11.9, h: 0.4, fontSize: 14, color: 'FFFFFF', margin: 0 }))

  s.addText('TestPilot —— 让 AI 可靠地替团队执行业务测试',
    T({ x: 0.7, y: 6.35, w: 11.9, h: 0.5, fontSize: 20, bold: true, color: ACCENT, margin: 0 }))
  s.addText('TestPilot · 7 / 7', T({ x: 10.7, y: 7.08, w: 2.13, h: 0.3, fontSize: 12, color: '9DB2C6', align: 'right', margin: 0 }))
}

p.writeFile({ fileName: 'E:/css-test-pilot/docs/TestPilot-研究进度汇报.pptx' }).then(() => {
  console.log('PPTX written')
})
