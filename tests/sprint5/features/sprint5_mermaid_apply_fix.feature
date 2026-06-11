# PB: AI 修复 Mermaid 后应用到源文件
# 对应模块: MermaidSourceReplace, MermaidFixUI
# 修复 [[feedback_brainstorm_ux_gap]]：补上状态机的退出路径 + 持久化机制

Feature: AI 修复 Mermaid 后应用到源文件

  作为编辑 Markdown 的用户
  我想要 AI 修复 Mermaid 后能将修复结果写回源文件
  以便修复结果在刷新和重开后仍然保留

  Scenario: 用户选择应用到源文件
    Given 当前文件包含一个错误的 Mermaid 代码块
    When AI 成功修复 Mermaid 并用户选择应用到源文件
    Then 源文件被更新为包含修复后的 Mermaid 代码
    And tab.content 已同步为新内容
    And DOM 显示修复后的 Mermaid 图

  Scenario: 用户选择仅本次会话
    Given AI 已修复 Mermaid 并显示成功提示
    When 用户选择仅本次会话
    Then 源文件保持不变
    And DOM 显示修复后的 Mermaid 图

  Scenario: 同一坏代码在源文件中出现多次
    Given 源文件包含两段相同的错误 Mermaid 代码
    When AI 修复并用户选择应用到源文件
    Then 仅替换第一处 Mermaid 代码块
    And 返回警告信息提示存在多处匹配

  Scenario: 源文件中找不到坏代码
    Given 源文件已被外部修改，原坏代码已不存在
    When 用户选择应用到源文件
    Then 提示"源文件已变更，无法定位原 Mermaid 块"
    And DOM 仍显示修复后的 Mermaid 图

  Scenario: 应用到源文件时 write_file 失败
    Given 源文件是只读的或磁盘已满
    When 用户选择应用到源文件
    Then 提示"保存失败"
    And 应用按钮可重新点击重试

  Scenario: 修复前用户已切换到其他 tab
    Given AI 修复启动时打开的是文件 A
    And 修复完成时用户已切换到文件 B
    When 用户选择应用到源文件
    Then 不应写入任何文件
    And 提示"文件已被切换，请重新打开"
