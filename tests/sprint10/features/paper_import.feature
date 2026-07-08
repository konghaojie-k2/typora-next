# PB5: 从 PDF 或 URL 导入论文
# 对应模块: paper-import.js, paper-reader-integration.js, paper_import/* (Rust)

Feature: 从 PDF 或 URL 导入论文

  作为想读论文的用户
  我想要直接导入 PDF 或粘贴论文 URL
  以便无需手动转换就能开始论文导读

  Background:
    Given 用户已进入论文导读模式

  Scenario: 用户导入本地 PDF 论文
    When 用户点击"导入本地 PDF"
    And 系统成功调用 minerU 并返回 markdown
    Then 论文以 tab 形式打开
    And 论文目录下生成对应的 .md 文件

  Scenario: 用户通过 arXiv URL 导入论文
    When 用户在 URL 输入框粘贴 arXiv 摘要页
    And 点击导入按钮
    Then URL 被转换为 PDF 直链
    And 系统成功调用 minerU
    And 论文以 tab 形式打开

  Scenario: 导入失败时提示用户
    When 用户导入不支持的 URL
    Then 页面显示错误提示
