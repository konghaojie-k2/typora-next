# PB2: 论文导读导航与导读卡交互
# 对应模块: PaperReader
# 设计依据: docs/specs/paper-reader-workspace-req.md

Feature: 论文导读导航与导读卡交互

  作为正在读论文的用户
  我想要按 AI 推荐的顺序导航并控制导读卡的展开/折叠
  以便聚焦阅读重点而不被解释打断

  Background:
    Given 用户已进入论文导读模式
    And 页面已渲染 VAE 论文导读

  # ============================
  # 导航
  # ============================

  Scenario: 左侧导航显示阅读顺序
    Then 左侧导航列出所有阅读顺序步骤
    And 当前步骤高亮显示

  Scenario: 点击导航项滚动到对应章节
    When 用户点击左侧导航中的 Introduction
    Then 主区域滚动到 Introduction 章节
    And Introduction 在导航中高亮为当前步骤

  # ============================
  # 导读卡
  # ============================

  Scenario: 导读卡默认展开
    Then 每个重点的原文高亮下方显示人话解释
    And 解释内容默认可见

  Scenario: 点击折叠按钮隐藏解释
    Given Abstract 下有一个展开的导读卡
    When 用户点击该导读卡的折叠按钮
    Then 人话解释被隐藏
    And 原文高亮仍然可见

  Scenario: 再次点击展开按钮显示解释
    Given Abstract 下有一个折叠的导读卡
    When 用户点击该导读卡的展开按钮
    Then 人话解释重新显示

  # ============================
  # 本地图片
  # ============================

  Scenario: 论文原文中的本地图片被正确加载
    Given 论文原文包含本地图片
    When 用户进入论文导读模式
    Then 本地图片的 src 被转换为 asset URL
    And 网络图片的 src 保持不变

  # ============================
  # 术语标签
  # ============================

  Scenario: 术语标签按重要性显示颜色
    Then must_know 标签显示红色
    And good_to_know 标签显示绿色
    And skip_first_read 标签显示灰色

  # ============================
  # 复述检查
  # ============================

  Scenario: 节末复述检查题目渲染
    Then Abstract 章节末尾显示 1-3 个复述检查问题

