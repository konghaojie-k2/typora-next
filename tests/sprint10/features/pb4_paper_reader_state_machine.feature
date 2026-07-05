# PB4: 论文导读模式状态机与安全切换
# 对应模块: PaperReader, main.js toolbar
# 设计依据: docs/specs/paper-reader-workspace-req.md

Feature: 论文导读模式状态机与安全切换

  作为在论文导读模式中的用户
  我想要安全地进入和退出论文导读
  以便避免误操作丢失阅读进度

  Background:
    Given 用户已进入 typora-next 主界面

  # ============================
  # 进入与退出
  # ============================

  Scenario: 点击论文导读按钮进入模式
    When 用户点击工具栏论文导读按钮
    And 用户选择本地 Markdown 论文
    Then 系统状态从 Idle 变为 LoadingGuide
    And 生成成功后变为 Reading

  Scenario: 关闭论文导读回到进入前界面
    Given 用户已在论文导读模式
    When 用户关闭论文导读
    Then 系统状态回到 Idle
    And 原文编辑区重新显示
    And 论文导读容器隐藏

  # ============================
  # 模式切换冲突
  # ============================

  Scenario: 论文导读中点击课程模式弹出确认
    Given 用户已在论文导读模式
    When 用户点击课程模式按钮
    Then 弹出确认对话框"切换模式将关闭论文，是否继续？"

  Scenario: 确认切换后关闭论文并进入课程模式
    Given 确认对话框已弹出
    When 用户点击确定
    Then 论文导读关闭
    And 课程模式入口打开

  Scenario: 取消切换后保持论文导读
    Given 确认对话框已弹出
    When 用户点击取消
    Then 对话框关闭
    And 论文导读保持当前状态

  # ============================
  # 同一会话状态保持
  # ============================

  Scenario: 同一会话保持滚动位置
    Given 用户已在论文导读模式
    And 用户滚动到 Method 章节
    When 用户临时切换到其他标签页再返回
    Then 论文导读仍显示 Method 章节

  Scenario: 同一会话保持导读卡折叠状态
    Given 用户已折叠 Abstract 的某张导读卡
    When 用户关闭论文导读后重新打开同一篇论文
    Then 该导读卡仍处于折叠状态
