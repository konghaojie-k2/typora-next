Feature: AI 伴学统一入口（给个解释 / 举个例子 / 我有话说）
  课程模式三个 AI 场景共用单一入口与同一个对话面板；
  每个场景的内容回答方式由对应 skill 控制，前端只负责表现。

  Scenario: 划词气泡是唯一的 AI 入口且四选可达
    Given the app source files are loaded
    Then the selection toolbar should contain a single companion button
    And the companion menu should offer exactly four modes
    And the old explain and case study bubble buttons should be gone
    And the companion menu should open the unified panel with the picked mode
    And the stylesheet should style the companion entry and mode controls

  Scenario: 划线后再点伴学，菜单不闪退且能取到划线文本
    Given the app source files are loaded
    Then global mouseup should not dismiss the toolbar for clicks inside it
    And the companion menu should fall back to the active annotation text

  Scenario: 侧栏提供不划词的「我有话说」入口
    Given the app source files are loaded
    Then the cornell sidebar should have an own-voice button that opens free talk
    And the sidebar history entry should merge both session kinds
    And the sidebar history entry should list saved explanations

  Scenario: own-voice skill 控制回答方式
    Given the app source files are loaded
    Then the own-voice skill should exist with its trigger phrase
    And the own-voice skill should require structured feedback sections
    And the own-voice skill should forbid ascii double quotes

  Scenario: own-voice 链路端到端接线
    Given the app source files are loaded
    Then the bridge should wire the own-voice stage with streaming deltas
    And Rust should register the own voice commands
    And index.html should load the companion module
    And the companion modal should support resuming a saved talk session

  Scenario: visualize 链路端到端接线（🖼️ 画个图）
    Given the app source files are loaded
    Then the bridge should wire the visualize stage with streaming deltas
    And Rust should register the visualize commands
    And the visualize skill should exist with its trigger phrase
    And the visualize skill should prefer real images over hand-drawn svg
    And the visualize skill should forbid mermaid and require svg fences

  Scenario: 面板路由与落盘（真实模块 + mock tauri）
    Given a real companion modal in a temp learning project
    When the panel is opened in talk mode
    Then no LLM call should happen until the student speaks
    When the student expresses an understanding
    Then the own voice chat should be invoked as the first turn
    And the thread should tag the turn as talk
    And ending the panel should persist the talk session to own-voices

  Scenario: 我有话说续聊（伴学记录 → 覆盖原文件）
    Given a real companion modal in a temp learning project
    When the panel is opened in talk mode
    And the student expresses an understanding
    And the panel is ended and saved
    When the panel is reopened from the saved session
    Then the replayed thread should not trigger a new LLM call
    When the student continues talking and ends the panel
    Then the session should be overwritten in place with the added turns

  Scenario: 解释记录续聊（伴学记录 💡 → 覆盖原 cue）
    Given a real companion modal in a temp learning project
    And an existing explanation conversation with two rounds
    When the panel is reopened from the explanation record
    Then the replayed explain thread should not trigger a new LLM call
    When the student asks a follow-up in explain mode
    Then the explain turn should carry the prior history
    And the explanation should be overwritten in place with the added round

  Scenario: 举例模式首轮生成 + 结束落盘（原案例研习面板的职责，已并入伴学面板）
    Given a real companion modal in a temp learning project
    When the panel is opened in example mode
    Then the case study chat should be invoked with the concept and no user answer
    When the student asks a follow-up in example mode
    Then the case study chat should be invoked with the answer and the captured session id
    When the user ends the session
    Then ending the panel should persist the example session with its start key

  Scenario: 画图模式首轮生成 + 结束落盘
    Given a real companion modal in a temp learning project
    When the panel is opened in visualize mode
    Then the visualize chat should be invoked with the concept and no user answer
    When the student asks a follow-up in visualize mode
    Then the visualize chat should be invoked with the answer and the captured session id
    When the user ends the session
    Then ending the panel should persist the visualize session with its start key

  Scenario: 画图续聊（伴学记录 🖼️ → 覆盖原会话）
    Given a real companion modal in a temp learning project
    And a saved visualize session on disk
    When the panel is reopened from the saved visualize session
    Then the replayed visualize thread should not trigger a new LLM call
    When the student continues the figure and ends the panel
    Then the visualize session should be overwritten in place

  Scenario: 举例续聊（伴学记录 📋 → 覆盖原会话）
    Given a real companion modal in a temp learning project
    And a saved example session on disk
    When the panel is reopened from the saved example session
    Then the replayed example thread should not trigger a new LLM call
    When the student continues the example and ends the panel
    Then the example session should be overwritten in place

  Scenario: 翻开历史但不追问，不重写会话文件
    Given a real companion modal in a temp learning project
    And a saved example session on disk
    When the saved session is reopened and ended without sending anything
    Then the session file should be left untouched

  Scenario: 落盘失败不吞对话（面板留在原地可重试）
    Given a real companion modal in a temp learning project
    When the panel is opened in example mode with an unwritable project
    And the student asks a follow-up in example mode
    And the user ends the session
    Then the panel should stay open and allow retrying the save

  Scenario: 一条记录 = 一个起点（同概念跨模式归并）
    Given a real companion modal in a temp learning project
    And an explanation record and an example session on the same concept
    When the learning records are collected
    Then the concept should appear as a single record
    And the record should carry both parts for resuming
    And an unselected free-talk session should stay its own record

  Scenario: 画图部分并入同一起点的记录
    Given a real companion modal in a temp learning project
    And an explanation record and a visualize session on the same concept
    When the learning records are collected
    Then the concept record should carry the visualize part for resuming

  Scenario: AI 回答里的数学公式渲染为 KaTeX（与主预览同方案）
    Given a real companion modal in a temp learning project
    When the tutor bubble renders markdown containing math
    Then display and inline math should render via KaTeX with intact LaTeX
    And math inside code fences should stay as literal code
    And without katex the raw text should survive

  Scenario: AI 回答里的 SVG 围栏渲染为活图且剥除危险内容
    Given the app source files are loaded
    When the tutor bubble renders markdown containing an svg fence
    Then the svg fence should render as live markup instead of a code block
    And script and event handlers inside the svg should be stripped

  Scenario: 气泡内标题压缩到气泡尺度（不被文档级 h1/h2 撑开）
    Given the app source files are loaded
    Then the bubble stylesheet should compact h1 and h2 for chat scale
