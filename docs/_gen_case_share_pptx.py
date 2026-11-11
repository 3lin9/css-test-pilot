# -*- coding: utf-8 -*-
"""基于团队模板(docs/空模板.pptx,周生生品牌)生成 TestPilot 介绍 PPT.

做法:打开模板 → 清空自带 28 页(保留母版/版式/品牌元素) →
封面用「English Title Page」版式、内容页用「中文簡報內容頁」版式(标题占位符
自带虚线分隔样式)、封底用「Thank You Page」版式;正文不铺全屏底色,
让母版的金色波浪条与周生生 logo 透出。

用法: python -X utf8 docs/_gen_case_share_pptx.py
输出: docs/TestPilot-介绍-案例分享.pptx
"""

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.dml import MSO_LINE
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt
from lxml import etree

W, H = Inches(13.333), Inches(7.5)

# 周生生品牌色(取自模板封面金色带与母版装饰)
GOLD = RGBColor(0xB0, 0xA7, 0x86)       # 香槟金
GOLD_DK = RGBColor(0x8F, 0x86, 0x66)    # 深金(箭头/强调线)
GOLD_PALE = RGBColor(0xF4, 0xF1, 0xE8)  # 浅金(节点底)
DARK = RGBColor(0x4A, 0x43, 0x33)       # 深金褐(横幅/强调节点)
INK = RGBColor(0x33, 0x33, 0x33)
MUTED = RGBColor(0x6F, 0x6F, 0x6F)
LINE = RGBColor(0xD9, 0xD4, 0xC6)
RED = RGBColor(0xC0, 0x4B, 0x3A)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = "等线"

prs = Presentation(r"E:\css-test-pilot\docs\空模板.pptx")

# 清空模板自带 28 页,保留主题/母版/版式(品牌元素在母版与版式上)
sldIdLst = prs.slides._sldIdLst
for sldId in list(sldIdLst):
    prs.part.drop_rel(sldId.get(qn("r:id")))
    sldIdLst.remove(sldId)

LAY_TITLE = prs.slide_layouts[1]   # English Title Page(封面,原模板封面同款)
LAY_CONTENT = prs.slide_layouts[2]  # 中文簡報內容頁
LAY_THANKS = prs.slide_layouts[7]  # Thank You Page


def set_run(run, size=13, bold=False, color=INK):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = FONT
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find(qn("a:ea"))
    if ea is None:
        ea = etree.SubElement(rPr, qn("a:ea"))
    ea.set("typeface", FONT)


def tb(slide, l, t, w, h, text, size=13, bold=False, color=INK,
       align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    sh = slide.shapes.add_textbox(l, t, w, h)
    tf = sh.text_frame
    tf.word_wrap = True
    anchor_map = {MSO_ANCHOR.TOP: "t", MSO_ANCHOR.MIDDLE: "ctr", MSO_ANCHOR.BOTTOM: "b"}
    try:
        tf._txBody.bodyPr.set("anchor", anchor_map[anchor])
    except Exception:
        pass
    for i, line in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_after = Pt(3)
        run = p.add_run()
        run.text = line
        set_run(run, size, bold, color)
    return sh


def box(slide, l, t, w, h, fill, line_color=None):
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, l, t, w, h)
    sh.fill.solid()
    sh.fill.fore_color.rgb = fill
    if line_color is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line_color
        sh.line.width = Pt(1)
    sh.shadow.inherit = False
    return sh


def round_box(slide, l, t, w, h, fill, line_color=None):
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, l, t, w, h)
    sh.fill.solid()
    sh.fill.fore_color.rgb = fill
    if line_color is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line_color
        sh.line.width = Pt(1)
    sh.adjustments[0] = 0.08
    sh.shadow.inherit = False
    return sh


def node(slide, l, t, w, h, text, fill=WHITE, color=INK, size=12, line_color=LINE):
    round_box(slide, l, t, w, h, fill, line_color)
    tb(slide, l + Inches(0.06), t, w - Inches(0.12), h, text, size, True, color,
       PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)


def diamond(slide, l, t, w, h, text, fill=GOLD_DK, color=WHITE, size=12):
    sh = slide.shapes.add_shape(MSO_SHAPE.DIAMOND, l, t, w, h)
    sh.fill.solid()
    sh.fill.fore_color.rgb = fill
    sh.line.fill.background()
    sh.shadow.inherit = False
    tb(slide, l, t, w, h, text, size, True, color, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)


def _arrow(slide, shape, l, t, w, h, fill=GOLD_DK):
    sh = slide.shapes.add_shape(shape, l, t, w, h)
    sh.fill.solid()
    sh.fill.fore_color.rgb = fill
    sh.line.fill.background()
    sh.shadow.inherit = False
    return sh


def ar_r(slide, l, t, w=Inches(0.3), h=Inches(0.18), fill=GOLD_DK):
    return _arrow(slide, MSO_SHAPE.RIGHT_ARROW, l, t, w, h, fill)


def ar_l(slide, l, t, w=Inches(0.3), h=Inches(0.18), fill=GOLD_DK):
    return _arrow(slide, MSO_SHAPE.LEFT_ARROW, l, t, w, h, fill)


def ar_d(slide, l, t, w=Inches(0.18), h=Inches(0.3), fill=GOLD_DK):
    return _arrow(slide, MSO_SHAPE.DOWN_ARROW, l, t, w, h, fill)


def banner(slide, t, text, size=13.5, h=0.9, fill=DARK):
    """页面底部结论横幅(避开母版金条与 logo,最深到 6.45")."""
    round_box(slide, Inches(0.45), Inches(t), Inches(12.4), Inches(h), fill)
    tb(slide, Inches(0.75), Inches(t), Inches(11.9), Inches(h), text, size, False,
       WHITE, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)


def placeholder_box(slide, l, t, w, h, label):
    """截图占位框:虚线边框,后续手工贴图."""
    sh = round_box(slide, l, t, w, h, WHITE, GOLD_DK)
    sh.line.dash_style = MSO_LINE.DASH
    sh.line.width = Pt(1.25)
    tb(slide, l, t + h / 2 - Inches(0.42), w, Inches(0.9),
       "【截图占位】\n" + label, 12.5, False, MUTED, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
    return sh


def content_page(title):
    """内容页:模板中文內容頁版式,用标题占位符(带虚线分隔),正文区自由排版."""
    s = prs.slides.add_slide(LAY_CONTENT)
    for ph in list(s.placeholders):
        if ph.placeholder_format.idx == 0:
            ph.text_frame.text = title
            for p in ph.text_frame.paragraphs:
                for r in p.runs:
                    set_run(r, 25, True, INK)
        else:
            ph._element.getparent().remove(ph._element)
    return s


# ================= P1 封面(模板标题页版式) =================
s = prs.slides.add_slide(LAY_TITLE)
for ph in s.placeholders:
    if ph.placeholder_format.idx == 0:
        ph.text_frame.text = "TestPilot:AI Native 跨端业务测试基础设施"
        for p in ph.text_frame.paragraphs:
            for r in p.runs:
                r.font.size = Pt(33)
    elif ph.placeholder_format.idx == 1:
        ph.text_frame.text = "让 AI 能理解、生成、校验并执行业务测试"
        for p in ph.text_frame.paragraphs:
            for r in p.runs:
                r.font.size = Pt(15)
tb(s, Inches(0.63), Inches(5.05), Inches(6), Inches(0.4), "分享:梅玲玲", 14, True,
   RGBColor(0x3F, 0x3F, 0x3F))
tb(s, Inches(0.63), Inches(5.55), Inches(6), Inches(0.4), "2026/10/28", 14, True,
   RGBColor(0x3F, 0x3F, 0x3F))

# ================= P2 背景 =================
s = content_page("背景:业务测试今天卡在哪")
problems = [
    ("跨端各一套脚本", "小程序一套、Web 一套、接口再一套。跨端业务(下单→后台核验)要拼两套框架,变量与证据对不齐。"),
    ("AI 写的测试不敢信", "AI 直接写自动化脚本:定位器靠想象、凭据进代码、失败被吞掉——看起来对,跑起来全靠运气。"),
    ("用例散落、难共享", "脚本在个人仓库或 IDE 里;没有清单、没有元数据索引,Git 与执行结果脱节。"),
    ("失败说不清原因", "红了分不清是产品缺陷还是环境/数据问题;要么盲目重跑,要么把环境的锅算到业务头上。"),
]
for i, (t, b) in enumerate(problems):
    x = Inches(0.45) + Inches(i * 3.2)
    round_box(s, x, Inches(1.1), Inches(3.05), Inches(3.5), WHITE, LINE)
    box(s, x, Inches(1.1), Inches(3.05), Inches(0.1), GOLD_DK)
    tb(s, x + Inches(0.18), Inches(1.4), Inches(2.7), Inches(0.95), t, 17, True, INK)
    tb(s, x + Inches(0.18), Inches(2.4), Inches(2.7), Inches(2.1), b, 13, False, MUTED)
banner(s, 4.9,
       "TestPilot 要回答的问题:怎么让 AI 写的测试,人和 CI 都敢信?\n——评审清单锁范围 + 各端原生脚本 + 归一的证据链。",
       15, 1.35)

# ================= P3 定位与核心链路 =================
s = content_page("定位与核心链路")
banner(s, 1.05,
       "TestPilot 是工具,不是业务测试项目:它定义「怎么组织、校验、执行、归一」;业务项目定义「测什么、怎么算通过」。",
       14.5, 0.9)
chain = [
    ("需求评审", "规则矩阵 · 覆盖映射"),
    ("测试点清单", "tests/e2e/reviews/"),
    ("原生脚本", "web / miniapp / api"),
    ("validate", "lint 三道卡"),
    ("run", "交给各端框架"),
    ("ingest + Report", "result.json + HTML"),
]
for i, (t, b) in enumerate(chain):
    x = Inches(0.42) + Inches(i * 2.12)
    node(s, x, Inches(2.2), Inches(1.9), Inches(0.92), t + "\n" + b,
         GOLD_PALE if i not in (3, 4) else DARK, INK if i not in (3, 4) else WHITE, 11,
         GOLD_DK if i not in (3, 4) else None)
    if i < 5:
        tb(s, x + Inches(1.86), Inches(2.45), Inches(0.3), Inches(0.4), "→", 15, True, GOLD_DK, PP_ALIGN.CENTER)
tb(s, Inches(0.45), Inches(3.22), Inches(12.4), Inches(0.32),
   "Git push → CI(sync-metadata) → 控制台团队可见", 12, False, MUTED, PP_ALIGN.CENTER)
triples = [
    ("评审清单 · 唯一用例来源", "测试点清单进 tests/e2e/reviews/,脚本头注释回链 ID;清单外的用例直接报错——AI 不能自由发明测试。"),
    ("原生脚本 · 各端官方框架", "Web 用 @playwright/test,小程序用 miniprogram-automator,API 用 node:test + fetch。没有自造语言,断言、等待、定位用足框架全部能力。"),
    ("ingest 归一 · 同一形态报告", "run 结束读取各端结构化输出(Playwright JSON / 内置 TAP),连同头注释与三态标记归一成 result.json;报告与跨 run 汇总直接可用。"),
]
for i, (t, b) in enumerate(triples):
    x = Inches(0.45) + Inches(i * 4.22)
    round_box(s, x, Inches(3.62), Inches(4.05), Inches(2.68), WHITE, LINE)
    box(s, x, Inches(3.62), Inches(4.05), Inches(0.08), GOLD_DK)
    tb(s, x + Inches(0.2), Inches(3.82), Inches(3.65), Inches(0.62), t, 15, True, INK)
    tb(s, x + Inches(0.2), Inches(4.48), Inches(3.65), Inches(1.7), b, 13, False, MUTED)

# ================= P4 测试需求评审(案例前置) =================
s = content_page("前置:测试需求评审——用例从哪来")
tb(s, Inches(0.5), Inches(1.02), Inches(12.3), Inches(0.32),
   "先评审、再生成;AI 不自由发挥,每条用例都能回答「为什么测它」", 12.5, False, MUTED)
flow = [
    ("测试需求", "一句话/需求单"),
    ("规则矩阵", "正常/边界/异常\n× charter 视角"),
    ("test point\nchecklist", "每条可判定"),
    ("QA 覆盖映射", "test point ↔ 用例"),
    ("生成原生脚本", "回链 test point ID"),
]
for i, (t, b) in enumerate(flow):
    x = Inches(0.45) + Inches(i * 2.55)
    node(s, x, Inches(1.45), Inches(2.25), Inches(0.98), t + "\n" + b,
         WHITE if i < 4 else DARK, INK if i < 4 else WHITE, 12, GOLD_DK if i < 4 else None)
    if i < 4:
        ar_r(s, x + Inches(2.28), Inches(1.85))
points = [
    ("no-invention 禁止发明", "定位器与接口必须来自真实页面/代码;测试点必须在评审清单里,清单外的 ID 直接报错。"),
    ("数据驱动用框架参数化", "步骤相同、每行一条可判定规则时,用框架自己的参数化(Playwright test 循环 / node:test 循环),不复制脚本。"),
    ("产物进 Git", "清单 + 覆盖映射随代码评审;评审结论是 AI 写脚本的输入,不是一次性聊天。"),
]
for i, (t, b) in enumerate(points):
    y = Inches(2.62) + Inches(i * 1.2)
    round_box(s, Inches(0.45), y, Inches(7.35), Inches(1.1), WHITE, LINE)
    tb(s, Inches(0.7), y + Inches(0.1), Inches(6.9), Inches(0.36), t, 13.5, True, GOLD_DK)
    tb(s, Inches(0.7), y + Inches(0.48), Inches(6.9), Inches(0.58), b, 12, False, MUTED)
placeholder_box(s, Inches(8.05), Inches(2.62), Inches(4.85), Inches(3.5),
                "评审产物截图\n(规则矩阵 / test point checklist / 覆盖映射)")

# ================= P5 案例一 头页 =================
s = content_page("案例一:小程序下单 → Web 后台核验")
round_box(s, Inches(0.45), Inches(1.05), Inches(6.1), Inches(1.28), WHITE, LINE)
box(s, Inches(0.45), Inches(1.05), Inches(0.1), Inches(1.28), GOLD_DK)
tb(s, Inches(0.75), Inches(1.17), Inches(5.6), Inches(0.34), "背景", 14, True, GOLD_DK)
tb(s, Inches(0.75), Inches(1.53), Inches(5.6), Inches(0.75),
   "跨端业务要拼两套自动化框架:小程序走开发者工具、后台走浏览器脚本;订单号靠人肉复制,证据分散。", 12.5, False, MUTED)
round_box(s, Inches(6.75), Inches(1.05), Inches(6.1), Inches(1.28), WHITE, LINE)
box(s, Inches(6.75), Inches(1.05), Inches(0.1), Inches(1.28), GOLD_DK)
tb(s, Inches(7.05), Inches(1.17), Inches(5.6), Inches(0.34), "目标", 14, True, GOLD_DK)
tb(s, Inches(7.05), Inches(1.53), Inches(5.6), Inches(0.75),
   "评审后拆成两个测试点、两份脚本:小程序下单脚本把订单号写进 tests/e2e/data/,Web 后台脚本读取并核验;全程截图 / Trace 留证。", 12.5, False, MUTED)
tb(s, Inches(0.45), Inches(2.48), Inches(6), Inches(0.32), "miniapp 脚本(miniprogram-automator)", 12.5, True, GOLD_DK)
l1 = ["连接开发者工具", "点击提交订单", "读订单号写 data/"]
for i, t in enumerate(l1):
    x = Inches(0.45) + Inches(i * 4.3)
    node(s, x, Inches(2.82), Inches(3.7), Inches(0.66), t, GOLD_PALE, INK, 13, GOLD_DK)
    if i < 2:
        ar_r(s, x + Inches(3.75), Inches(3.06))
ar_d(s, Inches(6.32), Inches(3.56), Inches(0.18), Inches(0.28))
tb(s, Inches(6.58), Inches(3.58), Inches(1.5), Inches(0.28), "data/ 交接", 11, True, GOLD_DK)
tb(s, Inches(0.45), Inches(3.94), Inches(6), Inches(0.32), "web 脚本(@playwright/test)", 12.5, True, RED)
l2 = ["打开后台订单页", "断言新订单行可见", "report 证据与报告"]
for i, t in enumerate(l2):
    x = Inches(0.45) + Inches(i * 4.3)
    node(s, x, Inches(4.28), Inches(3.7), Inches(0.66), t, WHITE, INK, 13, RED)
    if i < 2:
        ar_r(s, x + Inches(3.75), Inches(4.52), fill=RED)
banner(s, 5.35,
       "为什么选它:跨端业务不再硬编成一条编排——每端用自己的框架写普通脚本,状态经 tests/e2e/data/ 交接,证据照样归一。", 13.5, 0.95)

# ================= P6 案例一 脚本长什么样 =================
s = content_page("案例一:脚本长什么样")
round_box(s, Inches(0.45), Inches(1.05), Inches(6.55), Inches(4.5), WHITE, LINE)
tb(s, Inches(0.7), Inches(1.16), Inches(6.1), Inches(0.32), "tests/e2e/miniapp/order-create.test.ts(节选)", 12.5, True, INK)
code = """// 测试点: TP-001   视角: charter:numbers-copy
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('下单后订单号可见并落 data/', async () => {
  const orderId = await submitOrder()   // automator 操作
  assert.match(orderId, /^\\d+$/)
  save('tests/e2e/data/order-context.json', { orderId })
})"""
tb(s, Inches(0.72), Inches(1.55), Inches(6.1), Inches(3.85), code, 12, False, INK)
notes = [
    ("头注释 · 证据链", "「测试点: TP-001」回链评审清单,「视角: charter:*」标注视角;validate 检查 ID 必须在清单中,清单外直接报错。"),
    ("框架原生断言", "node:assert/strict、Playwright 的 expect——等待、重试、定位全是框架原生能力,没有方言损耗。"),
    ("data/ 交接 · 跨端衔接", "前一份脚本把关键值写进 tests/e2e/data/,后一份(Web 端)读取后核对;不做跨端编排。"),
]
for i, (t, b) in enumerate(notes):
    y = Inches(1.05) + Inches(i * 1.53)
    round_box(s, Inches(7.2), y, Inches(5.65), Inches(1.42), WHITE, LINE)
    tb(s, Inches(7.45), y + Inches(0.1), Inches(5.2), Inches(0.34), t, 13.5, True, GOLD_DK)
    tb(s, Inches(7.45), y + Inches(0.48), Inches(5.2), Inches(0.85), b, 12, False, MUTED)
banner(s, 5.72,
       "这就是一份普通脚本:放进业务仓、跟代码一起评审、CI 直接跑;TestPilot 只管清单约束、执行与归一。", 13, 0.7)

# ================= P7 案例一 执行链 =================
s = content_page("案例一:从校验到正式执行")
chain = [
    ("① validate lint", "三道卡:头注释 evidence /\n清单出处 / env 声明;\n清单外 ID 直接报错"),
    ("② run 交给框架", "按目录 spawn:web 跑\nnpx playwright test,miniapp\n/api 跑 node --test"),
    ("③ ingest 归一", "读取各端结构化输出\n(Playwright JSON / TAP),\n连同头注释与三态标记"),
    ("④ result.json", "与报告同形态落 run 目录;\n报告与跨 run 汇总直接可用,\n不区分端"),
    ("⑤ report 报告", "JSON + HTML,用例级结果\n+ 截图 / 日志 / Trace;\n支持跨 run 汇总 --summary"),
]
for i, (t, b) in enumerate(chain):
    x = Inches(0.42) + Inches(i * 2.53)
    round_box(s, x, Inches(1.15), Inches(2.3), Inches(2.3), WHITE, LINE)
    box(s, x, Inches(1.15), Inches(2.3), Inches(0.08), GOLD_DK)
    tb(s, x + Inches(0.12), Inches(1.33), Inches(2.06), Inches(0.66), t, 12, True, INK)
    tb(s, x + Inches(0.12), Inches(2.05), Inches(2.06), Inches(1.32), b, 10.5, False, MUTED)
    if i < 4:
        ar_r(s, x + Inches(2.26), Inches(2.2))
constraints = [
    ("no-invention", "AI 禁止编定位器;一切以真实页面 / 代码证据为准,清单是唯一用例来源。"),
    ("宁红勿漏", "未标记的失败一律按产品失败;环境阻塞显式标 blocked,不静默重试糊弄成绿色。"),
    ("证据必留", "失败截图 + 框架原始输出(playwright.json / *.tap)落 .testpilot/artifacts/(本地产物,不进 Git)。"),
]
for i, (t, b) in enumerate(constraints):
    x = Inches(0.45) + Inches(i * 4.22)
    round_box(s, x, Inches(3.7), Inches(4.05), Inches(2.55), WHITE, LINE)
    round_box(s, x + Inches(0.2), Inches(3.94), Inches(1.7), Inches(0.48), DARK)
    tb(s, x + Inches(0.2), Inches(3.94), Inches(1.7), Inches(0.48), t, 12, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
    tb(s, x + Inches(0.22), Inches(4.6), Inches(3.6), Inches(1.5), b, 12.5, False, MUTED)

# ================= P8 案例一 效果与结论 =================
s = content_page("案例一:效果与结论")
placeholder_box(s, Inches(0.45), Inches(1.1), Inches(6.0), Inches(2.15), "HTML 报告截图(Step 级结果 + 截图)")
placeholder_box(s, Inches(0.45), Inches(3.4), Inches(6.0), Inches(2.15), "Web 控制台 Run 详情截图(Case Index / 证据)")
conclusions = [
    ("实测通过", "小程序下单 → data/ 交接 → Web 后台核验;Run 记录 branch / commit / workspace 快照,可追溯。"),
    ("用例资产化", "脚本进业务仓、跟代码一起评审;换人可跑、CI 可跑,不再绑在某个人 IDE 里。"),
    ("AI 可参与", "AI 按清单写原生脚本;通过与否由框架断言判定——生成的脚本与手写走同一条链路。"),
]
for i, (t, b) in enumerate(conclusions):
    y = Inches(1.1) + Inches(i * 1.53)
    round_box(s, Inches(6.7), y, Inches(6.15), Inches(1.42), WHITE, LINE)
    box(s, Inches(6.7), y, Inches(0.1), Inches(1.42), GOLD_DK)
    tb(s, Inches(7.0), y + Inches(0.12), Inches(5.7), Inches(0.34), t, 14, True, INK)
    tb(s, Inches(7.0), y + Inches(0.5), Inches(5.7), Inches(0.85), b, 12, False, MUTED)
banner(s, 5.72, "核心操作总结:证据先行,一次执行。新增一条跨端用例的成本 ≈ 写两份普通脚本。", 13, 0.7)

# ================= P9 案例二 AI 闭环 =================
s = content_page("案例二:让 AI 写的测试敢进 CI")
seq = [
    ("测试需求\n(人提出)", WHITE, INK),
    ("需求评审\n规则矩阵+测试点清单", GOLD_PALE, INK),
    ("AI 读代码取证\n写原生脚本", GOLD_PALE, INK),
    ("validate\nlint 三道卡", WHITE, INK),
    ("run\n(交给各端框架)", DARK, WHITE),
]
for i, (t, f, c) in enumerate(seq):
    x = Inches(0.5) + Inches(i * 2.56)
    node(s, x, Inches(1.02), Inches(2.26), Inches(0.8), t, f, c, 11.5, None if f == DARK else LINE)
    if i < 4:
        ar_r(s, x + Inches(2.29), Inches(1.33))
ar_d(s, Inches(11.62), Inches(1.87), Inches(0.18), Inches(0.26))
diamond(s, Inches(10.5), Inches(2.16), Inches(2.2), Inches(1.0), "全部通过?")
ar_l(s, Inches(9.95), Inches(2.57), w=Inches(0.5))
tb(s, Inches(9.6), Inches(2.32), Inches(0.5), Inches(0.24), "是", 11, True, GOLD_DK, PP_ALIGN.CENTER)
node(s, Inches(7.1), Inches(2.32), Inches(2.7), Inches(0.66),
     "git push → CI\nvalidate + sync-metadata + run", WHITE, INK, 10.5, GOLD_DK)
tb(s, Inches(11.68), Inches(3.18), Inches(0.5), Inches(0.24), "否", 11, True, RED, PP_ALIGN.CENTER)
ar_d(s, Inches(11.62), Inches(3.44), Inches(0.18), Inches(0.26), fill=RED)
node(s, Inches(9.55), Inches(3.74), Inches(3.15), Inches(0.66),
     "Evidence:截图 / 日志\nresult.json 失败分类", WHITE, RED, 10.5, RED)
ar_l(s, Inches(9.05), Inches(3.98), w=Inches(0.45), fill=RED)
node(s, Inches(6.35), Inches(3.74), Inches(2.6), Inches(0.66),
     "AI 读 report.json\n归因 + 修改建议", GOLD_PALE, INK, 10.5)
ar_l(s, Inches(5.85), Inches(3.98), w=Inches(0.45))
buckets = [
    ("product 真缺陷", "提缺陷单\n附截图 / Trace", RED),
    ("infra 环境问题", "修环境后重跑\n不算业务失败", GOLD_DK),
    ("unverified 证据不足", "加强断言取证\n禁止假装通过", MUTED),
]
for i, (t, b, c) in enumerate(buckets):
    x = Inches(0.5) + Inches(i * 1.8)
    node(s, x, Inches(4.62), Inches(1.62), Inches(1.0), t + "\n" + b, WHITE, INK, 9.5, c)
banner(s, 5.78,
       "AI 擅长「写」和「解释」,不擅长「保证」。判定通过与否的是框架断言和清单约束,不是模型;\nAI 的产出必须先过 validate 才允许执行——AI 参与量可以放大,风险不会同比放大。",
       12.5, 0.66)

# ================= P10 案例二 效果与结论 =================
s = content_page("案例二:效果与结论")
placeholder_box(s, Inches(0.45), Inches(1.1), Inches(6.0), Inches(2.55),
                "跨 run 汇总报告截图(--summary / 三态统计)")
round_box(s, Inches(0.45), Inches(3.8), Inches(6.0), Inches(2.4), WHITE, LINE)
tb(s, Inches(0.7), Inches(3.94), Inches(5.5), Inches(0.34), "run 退出码语义", 13.5, True, GOLD_DK)
tb(s, Inches(0.7), Inches(4.34), Inches(5.5), Inches(1.7),
   "0 = 全部通过 / 跳过,可合入\n1 = 产品回归或证据不足(真问题或没测到,拦住)\n2 = 环境阻塞(非产品问题,分流环境排查后重跑)", 12.5, False, INK)
buckets2 = [
    ("product · 真缺陷", "断言失败且未标记三态——一律按产品失败(宁红勿漏);自动附截图 / 日志 / Trace,直接可提单。", RED),
    ("blocked · 环境阻塞", "服务不可达、凭据缺失;退出码 2,修复后重跑,不污染业务质量结论。", GOLD_DK),
    ("inconclusive · 证据不足", "前置缺失没测到;补数据或加强断言,禁止静默重试糊弄成绿色。", MUTED),
]
for i, (t, b, c) in enumerate(buckets2):
    y = Inches(1.1) + Inches(i * 1.5)
    round_box(s, Inches(6.7), y, Inches(6.15), Inches(1.38), WHITE, LINE)
    box(s, Inches(6.7), y, Inches(0.1), Inches(1.38), c)
    tb(s, Inches(7.0), y + Inches(0.1), Inches(5.7), Inches(0.34), t, 13.5, True, INK)
    tb(s, Inches(7.0), y + Inches(0.48), Inches(5.7), Inches(0.82), b, 12, False, MUTED)
banner(s, 5.72, "失败可归因、报告可汇总;AI 写的脚本与手写脚本走同一条 validate → run → report 链路。", 13, 0.7)

# ================= P11 体系全景与接入 =================
s = content_page("体系全景与怎么接入")
layers = [
    ("入口层 apps + skills", "cli(npm 包 csspilot)· server Control Plane · web 测试控制台 · skills 教 AI 怎么用"),
    ("SDK 门面", "@testpilot/sdk 是唯一编程入口:项目信息、用例收集、run 执行、报告生成;CLI / Server 一律经它。"),
    ("核心层 packages", "core 配置 · native-cases 各端执行与 ingest 归一 · runs 运行目录 · reporter 报告"),
    ("执行端 frameworks", "Playwright / miniprogram-automator / node:test——各端官方框架,业务项目自装;TestPilot 不翻译不包装,扩端只是多一个目录。"),
]
for i, (t, b) in enumerate(layers):
    y = Inches(1.05) + Inches(i * 0.92)
    round_box(s, Inches(0.45), y, Inches(12.4), Inches(0.82), GOLD_PALE if i == 3 else WHITE, LINE)
    round_box(s, Inches(0.6), y + Inches(0.18), Inches(0.46), Inches(0.46), DARK if i == 3 else GOLD_DK)
    tb(s, Inches(0.6), y + Inches(0.18), Inches(0.46), Inches(0.46), str(i + 1), 13, True, WHITE,
       PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
    tb(s, Inches(1.22), y + Inches(0.06), Inches(3.45), Inches(0.68), t, 13.5, True, INK, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
    tb(s, Inches(4.7), y + Inches(0.06), Inches(8.0), Inches(0.68), b, 11.5, False, MUTED, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
tb(s, Inches(0.45), Inches(4.78), Inches(12.4), Inches(0.28),
   "注:init 不动 .env 真实凭据、不动已有用例;CI 可用 csspilot ci init 生成工作流模板。", 11, False, MUTED)
path = [
    ("接入", "npx csspilot init\n幂等:装 Skill、生成\ntestpilot.yaml 与 tests/e2e"),
    ("编写", "AI 按清单写原生脚本\n头注释回链 test point\n定位器必须有证据"),
    ("校验", "csspilot validate\nlint 三道卡:\n清单出处 / env 声明"),
    ("执行", "csspilot run\n交给各端框架\n三态退出码"),
    ("看见", "HTML 报告 / 控制台\ngit push → sync-metadata\n→ 团队可见"),
]
for i, (t, b) in enumerate(path):
    x = Inches(0.45) + Inches(i * 2.53)
    round_box(s, x, Inches(5.12), Inches(2.3), Inches(1.32), WHITE, LINE)
    round_box(s, x + Inches(0.9), Inches(5.22), Inches(0.44), Inches(0.44), GOLD_DK)
    tb(s, x + Inches(0.9), Inches(5.22), Inches(0.44), Inches(0.44), str(i + 1), 12, True, WHITE,
       PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
    tb(s, x + Inches(0.1), Inches(5.68), Inches(2.1), Inches(0.3), t, 12.5, True, INK, PP_ALIGN.CENTER)
    tb(s, x + Inches(0.08), Inches(5.98), Inches(2.14), Inches(0.44), b, 8.5, False, MUTED, PP_ALIGN.CENTER)
    if i < 4:
        ar_r(s, x + Inches(2.27), Inches(5.68))

# ================= P12 带走四句话 + Q&A =================
s = content_page("带走的四句话")
lines = [
    "用例即脚本:各端官方框架原生代码,没有中间格式;断言、等待、定位用足框架能力。",
    "用例从评审来:规则矩阵 → 测试点清单 → 覆盖映射;清单外的脚本直接报错。",
    "执行与归一:csspilot run 交给各端框架,ingest 归一成同一形态报告;失败三态可归因。",
    "扩端 = 多一个目录:报告、控制台、Skill 全部复用,脚本随框架演进不作废。",
]
for i, line in enumerate(lines):
    y = Inches(1.45) + Inches(i * 0.72)
    tb(s, Inches(0.7), y, Inches(0.45), Inches(0.5), str(i + 1), 19, True, GOLD_DK)
    tb(s, Inches(1.2), y + Inches(0.03), Inches(11.4), Inches(0.55), line, 16.5, False, INK)
box(s, Inches(0.7), Inches(4.55), Inches(12.0), Inches(0.02), LINE)
tb(s, Inches(0.7), Inches(4.75), Inches(11), Inches(0.35),
   "文档:docs/architecture.md · README · docs/cli.md | 上手:npx csspilot --help", 12.5, False, MUTED)
tb(s, Inches(0.7), Inches(5.25), Inches(11), Inches(0.75), "Q  &  A", 34, True, GOLD_DK)
tb(s, Inches(0.7), Inches(6.05), Inches(11), Inches(0.35), "分享:梅玲玲", 13.5, False, MUTED)

# ================= P13 封底(模板 Thank You 版式) =================
s = prs.slides.add_slide(LAY_THANKS)
for ph in s.placeholders:
    ph.text_frame.text = "分享:梅玲玲 · 2026/10/28"
    for p in ph.text_frame.paragraphs:
        for r in p.runs:
            r.font.size = Pt(14)

# ================= P14 备用:AI 写的脚本凭什么敢进 CI =================
s = content_page("备用:AI 写的脚本,凭什么敢进 CI")
tb(s, Inches(0.5), Inches(1.02), Inches(12.3), Inches(0.32),
   "AI 写测试的风险不是写不出,是「看起来对」:编定位器、硬编码凭据、失败被吞。TestPilot 用三道闸约束它。",
   11.5, False, MUTED)
round_box(s, Inches(0.45), Inches(1.45), Inches(6.1), Inches(3.0), WHITE, LINE)
tb(s, Inches(0.7), Inches(1.56), Inches(5.6), Inches(0.32),
   "没有约束时(AI 裸奔)", 12.5, True, RED)
bad = """page.click('.submit-btn')     // 定位器凭想象
const pwd = 'Test@123'        // 凭据进代码
try { await buy() } catch {}  // 失败被吞
console.log('passed')         // 永远绿色"""
tb(s, Inches(0.72), Inches(1.95), Inches(5.6), Inches(2.3), bad, 11.5, False, INK)
round_box(s, Inches(6.75), Inches(1.45), Inches(6.1), Inches(3.0), WHITE, LINE)
tb(s, Inches(7.0), Inches(1.56), Inches(5.6), Inches(0.32),
   "TestPilot 约束下", 12.5, True, GOLD_DK)
good = """// 测试点: TP-001   ← 必须在评审清单
// 视角: charter:error-path
const auth = process.env.TESTPILOT_ACCOUNT_TEST_USER
expect(rows.some(r => r.id === orderId)).toBe(true)
// exit 0 才算过;blocked/inconclusive 不冒充绿色"""
tb(s, Inches(7.02), Inches(1.95), Inches(5.6), Inches(2.3), good, 11.5, False, INK)
gates = [
    ("闸 1 · 清单硬卡", "测试点 ID 必须在 reviews 清单;清单外 validate 直接报错——AI 不能发明测试。"),
    ("闸 2 · lint 声明", "脚本引用的环境变量必须在 .env.testing / testpilot.yaml 声明;凭据不进代码。"),
    ("闸 3 · 三态退出", "失败分 product / blocked / inconclusive;未标记一律按产品失败,宁红勿漏。"),
    ("证据归一", "各端结果归一成同一形态 report;截图 / Trace 自动关联失败步骤,可审计。"),
]
for i, (t, b) in enumerate(gates):
    x = Inches(0.45) + Inches(i * 3.2)
    round_box(s, x, Inches(4.65), Inches(3.05), Inches(1.75), WHITE, LINE)
    box(s, x, Inches(4.65), Inches(3.05), Inches(0.08), GOLD_DK)
    tb(s, x + Inches(0.16), Inches(4.82), Inches(2.73), Inches(0.34), t, 13, True, INK)
    tb(s, x + Inches(0.16), Inches(5.2), Inches(2.73), Inches(1.1), b, 11, False, MUTED)

# ================= P15 备用:run 到底做了什么 =================
s = content_page("备用:csspilot run 到底做了什么")
chain = [
    ("收集脚本", "collect\ntests/e2e 各目录"),
    ("按端 spawn", "playwright test /\nnode --test"),
    ("框架真执行", "浏览器 / 开发者工具\n/ HTTP"),
    ("结构化输出", "Playwright JSON\n/ 内置 TAP"),
    ("ingest 归一", "写成 run 目录\nresult.json"),
    ("report", "JSON + HTML\n+ 跨 run 汇总"),
]
for i, (t, b) in enumerate(chain):
    x = Inches(0.42) + Inches(i * 2.12)
    node(s, x, Inches(1.05), Inches(1.9), Inches(0.95), t + "\n" + b,
         GOLD_PALE if i < 3 else DARK, INK if i < 3 else WHITE, 10.5,
         GOLD_DK if i < 3 else None)
    if i < 5:
        tb(s, x + Inches(1.86), Inches(1.3), Inches(0.3), Inches(0.4), "→", 15, True, GOLD_DK, PP_ALIGN.CENTER)
tb(s, Inches(0.45), Inches(2.08), Inches(12.4), Inches(0.3),
   "TestPilot 不翻译脚本——脚本就是各端框架的普通代码;run 负责收集、派活、归一。", 11.5, False, MUTED, PP_ALIGN.CENTER)
round_box(s, Inches(0.45), Inches(2.5), Inches(6.1), Inches(1.95), WHITE, LINE)
tb(s, Inches(0.7), Inches(2.62), Inches(5.6), Inches(0.32), "逐文件 spawn,互不拖垮", 12.5, True, GOLD_DK)
tb(s, Inches(0.72), Inches(2.98), Inches(5.6), Inches(1.4),
   "每个脚本独立进程:web 跑 npx playwright test,miniapp 与 api 跑 node --test。\n单文件崩溃只影响自己,其余照常执行;blocked 的用例标 ⊘,同一 run 其余用例继续。",
   11, False, MUTED)
tb(s, Inches(0.72), Inches(3.98), Inches(5.6), Inches(0.32),
   "执行命令、目录约定:test.directory 下按端分目录即可。", 10.5, False, INK)
round_box(s, Inches(6.75), Inches(2.5), Inches(6.1), Inches(1.95), WHITE, LINE)
tb(s, Inches(7.0), Inches(2.62), Inches(5.6), Inches(0.32),
   "ingest 归一:一个 run 一份 result.json", 12.5, True, GOLD_DK)
tb(s, Inches(7.02), Inches(2.98), Inches(5.6), Inches(1.15),
   "读取各端结构化输出,连同头注释元数据与 [TESTPILOT:*] 三态标记,\n归一成统一形态;report 与跨 run 汇总只认这一份文件。",
   10.5, False, INK)
tb(s, Inches(7.02), Inches(4.14), Inches(5.6), Inches(0.3),
   "截图 / 视频 / trace 是框架原生取证,run 目录整包留存。", 10.5, False, MUTED)
round_box(s, Inches(0.45), Inches(4.6), Inches(12.4), Inches(1.0), WHITE, LINE)
tb(s, Inches(0.7), Inches(4.72), Inches(2.9), Inches(0.76),
   "追问:为什么不自己包\n一层执行调度?", 12, True, GOLD_DK, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
tb(s, Inches(3.7), Inches(4.72), Inches(9.0), Inches(0.76),
   "各端框架迭代快(定位、等待、trace、并发),自研执行层永远是最低公约数;站在框架上,\nTestPilot 只做清单约束与结果归一,框架能力全量保留,框架升级测试零改动。",
   11, False, INK, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
banner(s, 5.75,
       "一句话:脚本是普通框架代码,run 是收集器 + 归一器;错误在 validate 提前死,执行交给最专业的框架。", 12.5, 0.68)

# ================= P16 备用:init 之后怎么跟 AI 共事 =================
s = content_page("备用:init 之后,怎么跟 AI 共事")
banner(s, 1.05,
       "init 后你不用再「教」AI:Skill 已把工作流、红线、命令装进项目。你只负责两件事——给业务意图,拍板决策。",
       13.5, 0.75)
scenes = [
    ("要出测试", "「帮我做订单改版的测试需求评审」", "规则矩阵 + 测试点清单,并向你提澄清问题"),
    ("写脚本", "「按清单写脚本,TP-001~005」", "读代码取证写各端原生脚本;缺凭据问你要,写 .env.testing"),
    ("推进执行", "「跑一遍 TP-001~005」", "validate → run → ingest 归一 → 报告"),
    ("失败了", "「分析最新 run,是脚本问题还是 bug」", "分类定位:脚本问题修脚本;产品 bug 给证据停手"),
    ("日常回归", "「这次改动涉及订单,回归相关脚本」", "按目录/文件筛选执行 + 汇总报告"),
]
for i, (tag, say, ai) in enumerate(scenes):
    y = Inches(2.0) + Inches(i * 0.58)
    round_box(s, Inches(0.45), y, Inches(7.35), Inches(0.52), WHITE, LINE)
    tb(s, Inches(0.62), y, Inches(1.15), Inches(0.6), tag, 11.5, True, GOLD_DK, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
    tb(s, Inches(1.8), y, Inches(3.4), Inches(0.6), say, 10.5, False, INK, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
    tb(s, Inches(5.28), y, Inches(2.45), Inches(0.6), ai, 9, False, MUTED, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
round_box(s, Inches(8.05), Inches(2.0), Inches(4.85), Inches(2.5), WHITE, LINE)
tb(s, Inches(8.3), Inches(2.14), Inches(4.35), Inches(0.34), "三条纪律", 13.5, True, GOLD_DK)
rules = [
    ("① 澄清问题认真答", "它被 no-invention 约束,项目没有的前置不许编;你含糊它就编。"),
    ("② 草稿 ≠ 完成", "脚本生成完只是草稿;validate 通过 + run 绿了才算数。"),
    ("③ 别跳过评审", "没有清单直接让它写脚本,拿到的是自由发挥;先评审再生成,清单是唯一来源。"),
]
for i, (t, b) in enumerate(rules):
    y = Inches(2.56) + Inches(i * 0.62)
    tb(s, Inches(8.3), y, Inches(4.35), Inches(0.28), t, 11, True, INK)
    tb(s, Inches(8.3), y + Inches(0.26), Inches(4.35), Inches(0.3), b, 9.5, False, MUTED)
banner(s, 5.0,
       "一句话:对 AI 说「业务话」(测什么/哪个端/预期什么),不说「技术话」(怎么点/selector 写什么)——技术交给你最信的框架。",
       12.5, 0.75)

out = r"E:\css-test-pilot\docs\TestPilot-介绍-案例分享.pptx"
prs.save(out)
print("saved", out, "slides:", len(prs.slides._sldIdLst))
