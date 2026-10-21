# css-test-pilot 優化路線圖

> 依據:esign 項目三輪實測(runs 20261019-001/002/003,24 條 Case 觀測)+ css-test-pilot HEAD(`466ae8d`)源碼分析。
> 分析日期:2026-10-21。分析時的 esign 端結果:8 條 Case 全數失敗,錯誤歸因見 §一。

## 一、實測發現的三大錯誤成因(修復目標)

| # | 錯誤訊息 | 出處 | 成因鏈 |
| --- | --- | --- | --- |
| E1 | `timeout waiting for automator response` | 微信開發者工具自動化服務端 | SDK `Connection.send` 無客戶端超時,服務端 error 原樣透傳;TestPilot 的 `CONNECTION_LOST` 正則不匹配 → 不重連,直接進報告 |
| E2 | `Cannot destructure property 'rawPath' of 't.getPageMetaByWebviewId(...)' as it is null` | 工具服務端未防空崩潰 | 頁面未編譯掛載完成時 `getPageMetaByWebviewId` 返回 null,服務端直接 destructure;Skyline 渲染器下頁面元數據註冊顯著晚於 webview(實測:skyline 兩輪黑屏失敗,切 webview 後 34ms 通過) |
| E3 | `Uncaught Error: wx.request not exists` | 工具的 `App.mockWxMethod` 包裝器 | `startRequestCapture` 的 mock 包裝器由工具注入 appservice;連續兩條 Case 都 navigate+expectRequests 時,包裝器與 reLaunch 頁面重建競爭,調用原始方法報 not exists |

E3 復現條件已定位:僅「連續 navigate+expectRequests」組合炸(#5→#6 三輪全現象,#6 失敗後 #7 正常——catch 的 `stopRequestCapture` 恢復了乾淨狀態)。

驗證實測:工具全熱時 connect 後 `currentPage().data()` **12ms 可讀**——automator 通道本身無缺陷,全部是**就緒時機與狀態殘留**問題。

## 二、P0:穩定性(不修,e2e 對真實項目不可用)

### P0-1 `launch()` 後補就緒等待(一行級,救回一半失敗)

- 現狀:`packages/adapter-wechatide/src/ide.ts` 的 `waitForPageReady()` 只在 `navigate` 路徑調用;launch 型 Case 的 `launch()` 僅建立連接即返回(`if (this.program) return`),後續 assert 的 10s 元素輪詢硬扛首屏編譯窗口(實測 10~40s)。
- 修復:`launch()` 末尾追加 `await this.waitForPageReady()`。
- 驗收:esign 8 條連續 3 輪,launch 型 Case 不再出現 E1/E2。

### P0-2 透傳錯誤觸發重連

- 現狀:`CONNECTION_LOST = /connection closed|not connected/i`(ide.ts:58)漏掉 E1/E2 的錯誤文本。
- 修復:正則擴展納入 `timeout waiting for automator`、`getPageMetaByWebviewId`;同時 `element()` 輪詢對這兩類錯誤做「重連一次+重試」而非立即計入 10s 窗口。
- 依據:實測 #2/#8 的失敗窗口裡,同批次其他 Case 的 automator 調用正常——通道是間歇忙,不是真斷。

### P0-3 `requestCapture` 跨 Case 狀態隔離

- 現狀(兩個缺陷疊加):
  1. `ide.ts` 的 `this.requestCapture` 記錄**舊 program 引用**;`runWithReconnect` 重連後 `this.program` 已換新,`stopRequestCapture` 對舊 program restore,新 program 上的 mock 狀態失控(E3 的土壤)。
  2. 失敗路徑的清理 `stopRequestCapture?.().catch(() => undefined)`(step-executor.ts:204)吞錯,殘留無告警。
- 修復:`requestCapture` 記錄所屬 program,stop 時校驗一致;不一致時對當前 program 顯式 `restoreWxMethod('request')` 並告警;清理失敗不再靜默(記 warning 進 StepResult)。
- 驗收:連續兩條 navigate+expectRequests 的 Case(esign 的 qr-expired-view → qr-invalid-esignid 即現成組合)連續 3 輪不再出現 E3。

### P0-4 步驟耗時記錄失真

- 現狀:run.log 顯示首條 Case 的 launch 實耗 **7.8s**(09:49:03.644→09:49:11.481),報告記 0ms——`executeStep` 的 `durationMs` 未覆蓋 launch 內部的啟動等待,且 P0-1 加了就緒等待後失真會擴大。
- 修復:launch/就緒等待耗時如實入 `durationMs`(或拆 `readyMs` 欄位),報告展示「環境準備」耗時,讓使用者能區分「測得慢」與「環境慢」。

## 三、P0.5:發佈與文檔欠帳(能力已做好,消費方用不到)

### P0.5-1 發 npm 新版

- 現狀:npm 0.7.0(`9d3de91`)在 V0.2 提交(`466ae8d`,2026-10-21)之前;esign 端 `npx csspilot` 用不到 `mockWxApi`/`trigger`/`callMethod`/`setData`/`assert.dataPath`。
- 動作:全量測試通過後發 0.8.0;esign 端升級後即可把 11 個人工測試點中的 ≥8 個寫成 Case(V0.2 issue 草稿的目標)。

### P0.5-2 skill 文檔同步(V0.2 硬性約束 1 的欠帳)

- 現狀:`skills/testpilot/rules/dsl.md` **不含** V0.2 四個 action(grep 零命中);schema 與 validate 已同步,唯獨 skill 層缺——需求評審/create-case 的 agent 工作流讀不到新 action,寫不出對應 Case。
- 動作:`rules/dsl.md` 補 action 表(mockWxApi/trigger/callMethod/setData/assert.dataPath);manifest 描述同步;補一個 `examples/cases` 的 miniapp 深度示例。

## 四、P1:可觀測性與可用性

### P1-1 錯誤歸一化與診斷建議

- 現狀:使用者看到的是工具裸錯誤文本(E1/E2/E3),每次都要人肉歸因(本次分析花了完整一輪源碼考古)。
- 修復:adapter 層對已知錯誤模式做歸一化,附機器碼+建議,如:

| 匹配模式 | 歸一化碼 | 報告建議文案 |
| --- | --- | --- |
| `getPageMetaByWebviewId.*null` | `IDE_PAGE_NOT_READY` | 頁面未就緒(編譯中或 Skyline 元數據未註冊),已重試;持續失敗請檢查渲染器配置 |
| `timeout waiting for automator response` | `IDE_BUSY_TIMEOUT` | 開發者工具忙(編譯/頁面切換);若高頻出現請考慮 webview 渲染跑 e2e |
| `wx\.\S+ not exists` | `WX_MOCK_STATE_BROKEN` | wx mock 狀態異常(多為前一 Case 的請求捕獲殘留),請回報至 css-test-pilot |

### P1-2 等待窗口可配置

- 現狀:`ELEMENT_WAIT_MS`/`TEXT_WAIT_MS` 硬編碼 10s(ide.ts:52-54)。實測 self-entry-silent-login 的靜默登入鏈路(wechatLogin RTT + reLaunch + 清單數據加載)在 10s 窗口邊緣反覆失敗。
- 修復:繼承 step 級 `timeout` 欄位(已有)到 assert/extract/元素等待;缺省維持 10s。

### P1-3 per-step 硬超時

- 現狀:`executeStep` 無 step 級超時;navigate 最壞 `NAVIGATE_RETRY_WINDOW_MS`(45s)+ `waitForPageReady`(30s)拖整輪,一條掛死拖死全 run。
- 修復:step 級硬超時(缺省 60s),超時打斷並記 `STEP_TIMEOUT`,後續 Case 照跑。

### P1-4 失敗時自動取證 console

- 現狀:失敗只截圖;E3 這類 appservice 全局異常在截圖裡完全不可見。
- 修復:miniprogram-automator 0.12 支持 `miniProgram.on('console')`——Case 開始訂閱、失敗時把最近 N 條 console(含 error/warning)寫入產物目錄 `logs/console-<case>.ndjson`。本次排查若有它,歸因成本至少減半。

## 五、P1.5:工程質量

### P1.5-1 真實工具回歸網

- 現狀:`tests/unit/wechatide-*.test.ts` 用 mock automator,真實工具行為(三大錯誤、Skyline、mock 生命周期)無任何回歸網——V0.2 提交訊息也記錄了「1 個未復現的偶發失敗」。
- 建議:可選的 `smoke` 套件(環境變數開關,需本機開發者工具),用 examples 的 miniapp 示例項目跑真實 launch→assert→mock 鏈路;CI 不跑,發版前手動跑。esign 項目可作為真實消費方基準(當前 8 條 Case 的預期通過賬目見 §七)。

### P1.5-2 Case 間隔離聲明

- 現狀:program 跨 Case 復用(性能對),但頁面棧、wx mock、授權態等運行時狀態全延續——測試彼此耦合,失敗會傳染(本次 #6 炸 #7 才正常就是反例)。
- 建議:至少在文檔聲明「Case 間僅保證 ws 連接復用,不保證運行時狀態隔離」;中期提供 `testpilot.yaml` 的 `miniapp.resetBetweenCases`(每 Case reLaunch 到空白頁+restore 全部 mock)。

## 六、P2:戰略協同

### P2-1 wechatide 工具鏈能力面

- `wechatide` 工具鏈有 miniprogram-automator 之上沒有的能力:`automation_wx_api`(mock/call/restore)、`debug_clear_cache`(cleanStorageCache 製造「未授權設備」前置)、console/network 面板原始數據。
- 建議:不換底座(automator 已夠用),但可借鑑其能力清單規劃 adapter 能力面:storage 清理(解設備狀態互斥問題)、授權態前置製造——這兩個是 esign 11 個人工點裡剩餘 3 個的解法。

### P2-2 Skyline 問題上報微信

- E2 的根(服務端 `getPageMetaByWebviewId` 不判空)與「Skyline 頁面元數據註冊晚」是**開發者工具側缺陷**,TestPilot 只能繞。建議整理最小復現(esign 的黑屏截圖+錯誤文本)反饋微信工具團隊;同時在 README 聲明「Skyline 項目跑 e2e 建議確認工具版本,不穩定期可臨時切 webview 渲染」。

## 七、驗收基準:esign 8 條 Case 的預期賬目

| Case | 現狀(0.7.0,skyline) | P0 修復後 | P0.5-1 發版+文案修正+造數後 |
| --- | --- | --- | --- |
| list-default-sort-newest | ✗ E2 | ✓ | ✓ |
| list-sort-toggle-oldest | ✗ E1 | ✓ | ✓ |
| list-switch-account | ✗ 文案差距 | ✗ 文案差距(非工具問題) | ✓ |
| list-title-and-fields | ✗ 文案差距 | ✗ 文案差距 | ✓ |
| qr-expired-view | ✗ 文案差距 | ✗ 文案差距 | ✓ |
| qr-invalid-esignid | ✗ E3 | ✓(P0-3) | ✓ |
| scan-valid-to-webview | ✗ 造數缺失 | ✗ 造數缺失(非工具問題) | ✓(需後端真造數) |
| self-entry-silent-login | ✗ E1 | ✓(P0-1+P1-2) | ✓ |

即:P0 四項落地 → 穩定性類失敗(5 條)歸零;P0.5-1 + esign 端文案/造數到位 → 8/8。

## 八、建議實施順序

```mermaid
flowchart LR
    A["P0-1 launch 就緒等待"] --> B["P0-2 重連正則擴展"]
    B --> C["P0-3 mock 狀態隔離"]
    C --> D["P0-4 耗時如實記錄"]
    D --> E["esign 8 條回歸 3 輪"]
    F["P0.5-2 skill 文檔同步"] --> G["P0.5-1 發 0.8.0"]
    E --> F
    G --> H["P1 錯誤歸一化/可配置窗口/硬超時/console 取證"]
    H --> I["P1.5 smoke 套件"]
    I --> J["P2 wechatide 能力面/Skyline 上報"]
```

P0 四項皆為 adapter-wechatide 單包內的小步修改,互不阻塞可並行;全鏈完成後以 esign 8 條連續 3 輪 ≥6/8(剩 2 條為 esign 端文案與造數依賴)作為 css-test-pilot 側的出線標準。
