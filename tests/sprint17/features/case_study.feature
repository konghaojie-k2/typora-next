Feature: 课程案例研习（Case Study）

  As a learner reading a course chapter
  I want to select a concept and get an AI-generated teaching case
  So that I can understand the concept through a concrete story and ask follow-ups

  Scenario: 划词后打开案例研习 → 首轮生成案例
    Given a course project and a selected concept
    When the case study modal opens
    Then case_study_chat should be invoked with the selected concept and no user answer

  Scenario: 追问 → 同一 session 续聊
    Given an opened case study modal with a generated case
    When the user sends a follow-up question
    Then case_study_chat should be invoked with the answer and captured session id

  Scenario: 结束会话 → 落盘 .learning/case-studies/
    Given an opened case study modal with dialogue turns
    When the user ends the session
    Then a session file should be written under case-studies with the contract fields

  Scenario: 保存失败不吞对话（允许重试）
    Given an opened case study modal whose save will fail
    When the user ends the session
    Then the modal should stay open and allow retrying the save

  Scenario: 历史回看列表新→旧排序
    Given two saved case study sessions on disk
    When case study history is listed
    Then sessions should come back newest first

  Scenario: 只读回看不再生成、输入禁用
    Given a saved case study session on disk
    When the session is reopened read-only
    Then no case_study_chat call should happen and the input should be locked

  Scenario: 后端接线（skill / bridge / Rust / index.html）
    Given the real project sources
    Then the case study skill should exist with valid frontmatter and constraints
    And the bridge should wire the case-study stage
    And Rust should register the case study commands
    And index.html should load the case study modules

  Scenario: 划词气泡原地触发（UX 修正 2026-08-11）
    Given the real project sources
    Then the selection toolbar should contain a case study button
    And the selection toolbar should toggle it together with the explain button
    And the case study click should call openCaseStudy with the selected text

  Scenario: 侧栏按钮避开底部进度条遮挡（UX 修正 2026-08-11）
    Given the real project sources
    Then the cornell sidebar should place action buttons in an actions row
    And the footer should not carry the action buttons
    And the stylesheet should not restyle the footer as flex

  Scenario: 划词只在文章正文内生效（UX 修正 2026-08-11 第二轮）
    Given the real project sources
    Then the selection toolbar mouseup handler should be scoped to markdownBody
    And the course selection tracking should be scoped to markdownBody

  Scenario: 侧栏删除解释按钮、案例按钮纯历史入口（UX 修正 2026-08-11 第二轮）
    Given the real project sources
    Then the cornell sidebar should not contain an explain button
    And the case study sidebar button should open history directly

  Scenario: 案例研习流式输出接线（UX 修正 2026-08-11 第二轮）
    Given the real project sources
    Then the bridge should emit case study deltas
    And Rust should stream case study events to the frontend
    And the modal should listen for case study delta events
    And the shell should support streaming bubbles

  Scenario: 气泡复用全局 markdown 渲染（UX 修正 2026-08-11 第二轮）
    Given the real project sources
    Then the shell should render tutor bubbles via markdownToHtml with escape fallback
