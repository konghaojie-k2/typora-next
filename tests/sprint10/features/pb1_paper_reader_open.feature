# PB1: 论文导读打开与加载
# 对应模块: PaperReader, agent-bridge.js, lib.rs
# 设计依据: docs/specs/paper-reader-workspace-req.md

Feature: 论文导读打开与加载

  作为想读论文但无法逐字理解的用户
  我想要选择一篇本地 Markdown 论文后看到 AI 生成的导读
  以便按重点和阅读顺序开始阅读

  Background:
    Given 用户已进入 typora-next 主界面

  # ============================
  # 正常路径
  # ============================

  Scenario: 用户从工具栏进入论文导读并看到导读页
    Given 工具栏存在论文导读按钮
    When 用户点击论文导读按钮
    And 用户在文件选择器中选择 VAE 论文
    Then 系统进入 LoadingGuide 状态
    And 系统生成或加载 guide JSON
    And 页面显示左侧阅读顺序导航
    And 页面至少显示一个高亮导读卡
    And 页面显示论文原文 Abstract 内容

  Scenario: 用户再次打开同一篇论文时直接加载缓存
    Given 用户之前已打开过 VAE 论文并生成导读
    And 缓存文件存在
    When 用户再次选择同一篇 VAE 论文
    Then 系统不调用 agent 重新生成
    And 页面直接显示导读内容

  # ============================
  # 异常路径
  # ============================

  Scenario: agent 生成导读失败时显示重试按钮
    Given 用户点击论文导读按钮
    And 用户选择 VAE 论文
    When agent 生成导读失败
    Then 系统进入 Error 状态
    And 页面显示生成导读失败，是否重试
    And 用户点击重试后再次尝试生成
