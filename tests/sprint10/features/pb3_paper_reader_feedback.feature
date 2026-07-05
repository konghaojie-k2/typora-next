# PB3: 论文导读阅读完成反馈
# 对应模块: PaperReader, Tauri feedback persistence
# 设计依据: docs/specs/paper-reader-workspace-req.md

Feature: 论文导读阅读完成反馈

  作为读完论文的用户
  我想要反馈自己的理解程度和 AI 导读方式是否合适
  以便后续优化导读质量

  Background:
    Given 用户已进入论文导读模式
    And 页面已渲染 VAE 论文导读

  # ============================
  # 正常路径
  # ============================

  Scenario: 滚动到 Conclusion 时完成阅读按钮高亮
    When 用户滚动到 Conclusion 章节
    Then 底部出现完成阅读按钮
    And 按钮处于高亮状态

  Scenario: 点击完成阅读按钮弹出反馈表单
    Given 完成阅读按钮已高亮
    When 用户点击完成阅读按钮
    Then 弹出反馈表单
    And 表单包含理解百分比滑块
    And 表单包含方法方式是否合适选项

  Scenario: 提交反馈后写入文件
    Given 用户已填写反馈表单
    When 用户点击提交
    Then 反馈数据写入 `.learning/paper-reader-feedback/{identifier}.json`
    And 文件符合 feedback schema
    And 论文导读关闭或回到阅读状态

  Scenario: 用户可以跳过反馈
    Given 反馈表单已打开
    When 用户点击跳过
    Then 表单关闭
    And 不写入反馈文件

  # ============================
  # 异常路径
  # ============================

  Scenario: 未选择方法方式时提交给出提示
    Given 反馈表单已打开
    When 用户只填写了理解百分比并点击提交
    Then 提示用户方法方式为必填项
    And 不写入反馈文件
