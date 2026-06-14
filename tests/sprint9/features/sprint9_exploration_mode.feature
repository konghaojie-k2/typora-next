# PB: 探索模式（自由阅读 / AI 对话式深度阅读）
# 对应模块: ExplorationSession, ExplorationUI, agent-bridge
# 设计依据: 用户对话 + daily-reflection 中的需求边界

Feature: 探索模式

  作为深度阅读的用户
  我想要和 AI 围绕一篇 Markdown 文章自由对话
  以便共同理解论文、博客或长文笔记

  Background:
    Given 用户已打开文件夹"C:/papers"
    And 文件夹中有文件"transformer.md"

  # ============================
  # 入口
  # ============================

  Scenario: 从文件树右键进入探索模式
    Given 用户在文件树中右键点击"transformer.md"
    When 用户选择"进入探索模式"
    Then 新标签页标题为"transformer.md"
    And 标签页背景色为探索模式 Lime 色
    And 主区域为上下分屏布局

  Scenario: 从标签页右键进入探索模式
    Given 用户已用普通方式打开"transformer.md"
    And 标签页为普通状态
    When 用户在标签页上右键点击
    And 用户选择"进入探索模式"
    Then 当前标签页变为探索模式
    And 标签页背景色为探索模式 Lime 色

  Scenario: 同一文件不会重复创建探索模式标签页
    Given "transformer.md"已在探索模式标签页中打开
    When 用户再次对"transformer.md"选择"进入探索模式"
    Then 不创建新标签页
    And 切换到已有的探索模式标签页

  # ============================
  # 布局
  # ============================

  Scenario: 探索模式默认上下分屏 60/40
    Given 用户已进入"transformer.md"的探索模式
    Then 文章面板高度占比约 60%
    And 对话面板高度占比约 40%
    And 两面板之间有可调分隔条

  Scenario: 分隔条可调整分屏比例
    Given 用户已进入"transformer.md"的探索模式
    When 用户把分隔条向下拖动
    Then 文章面板高度变窄
    And 对话面板高度变宽
    And 比例保存到 localStorage

  Scenario: 切换到其他标签页时探索状态保持
    Given 用户有两个标签页：普通"README.md"和探索"transformer.md"
    When 用户切换到"README.md"
    Then "README.md"显示普通阅读视图
    When 用户切换回"transformer.md"
    Then "transformer.md"仍显示探索模式分屏

  # ============================
  # 对话列表
  # ============================

  Scenario: 进入探索模式后显示欢迎语
    Given 用户已进入"transformer.md"的探索模式
    Then 对话面板顶部显示"现在你可以自由探索了，而我会在你身边"
    And 对话列表面板在左侧
    And 列表中有一条默认对话

  Scenario: 新建对话
    Given 用户已进入"transformer.md"的探索模式
    And 列表中已有 1 条对话
    When 用户点击"新建对话"
    Then 列表中新增 1 条对话
    And 当前对话切换到新对话
    And 聊天区清空并显示欢迎语

  Scenario: 对话标题取自第一条用户消息
    Given 用户已进入"transformer.md"的探索模式
    When 用户在当前对话中发送"这篇文章的核心观点是什么"
    Then 左侧列表中当前对话标题显示"这篇文章的核心观点是什么"

  Scenario: 用户可重命名对话
    Given 用户已进入"transformer.md"的探索模式
    And 当前对话标题为"这篇文章的核心观点是什么"
    When 用户右键点击该对话
    And 用户选择"重命名"
    And 用户输入"核心观点讨论"
    Then 左侧列表中该对话标题显示"核心观点讨论"

  Scenario: 对话列表显示相对创建时间
    Given 用户已进入"transformer.md"的探索模式
    And 当前对话创建于 2 小时前
    Then 左侧列表中显示"2 小时前"

  Scenario: 切换对话保留各自历史
    Given 用户已进入"transformer.md"的探索模式
    And 对话 A 中有 2 条消息
    And 对话 B 为空
    When 用户切换到对话 B
    Then 聊天区显示欢迎语
    When 用户切换回对话 A
    Then 聊天区显示 2 条消息

  # ============================
  # 消息交互
  # ============================

  Scenario: 发送消息后显示在聊天区
    Given 用户已进入"transformer.md"的探索模式
    When 用户在输入框中输入"请解释 Transformer"
    And 用户按 Enter
    Then 聊天区显示用户消息"请解释 Transformer"
    And 输入框清空

  Scenario: AI 回复按 Markdown 渲染
    Given 用户已进入"transformer.md"的探索模式
    When AI 回复包含"**Transformer** 是一种 \(Seq2Seq\) 架构"
    Then 聊天区中"Transformer"以粗体显示
    And \(Seq2Seq\) 以行内公式渲染

  Scenario: Shift+Enter 在输入框中换行
    Given 用户已进入"transformer.md"的探索模式
    When 用户在输入框中输入"第一行"
    And 用户按 Shift+Enter
    And 用户输入"第二行"
    Then 输入框中有两行文本
    And 未发送消息

  # ============================
  # LLM 上下文
  # ============================

  Scenario: LLM 调用包含文章全文和历史对话
    Given 用户已进入"transformer.md"的探索模式
    And 文章全文为"Attention is all you need."
    And 用户已发送"什么是 Attention"
    And AI 已回复"Attention 是一种加权求和机制"
    When 用户发送"能举个例子吗"
    Then 传给 Agent SDK 的 prompt 包含"Attention is all you need"
    And prompt 包含用户历史消息"什么是 Attention"
    And prompt 包含 AI 历史回复"Attention 是一种加权求和机制"

  # ============================
  # 持久化
  # ============================

  Scenario: 对话历史按文件持久化
    Given 用户已进入"transformer.md"的探索模式
    And 用户已发送"什么是 Attention"
    When 系统触发自动保存
    Then 持久化文件路径使用 transformer.md 的 basename
    And 文件内容包含对话消息

  Scenario: 重新打开同一文件恢复对话
    Given 用户之前已在"transformer.md"的探索模式中发送过"什么是 Attention"
    And 持久化文件存在
    When 用户再次进入"transformer.md"的探索模式
    Then 左侧列表显示之前的对话
    And 聊天区显示"什么是 Attention"

  Scenario: 删除对话同时删除持久化记录
    Given 用户已进入"transformer.md"的探索模式
    And 有 2 条对话且均已持久化
    When 用户删除对话 A
    Then 列表中只剩 1 条对话
    And 持久化记录中不再包含对话 A

  # ============================
  # 异常与边界
  # ============================

  Scenario: Agent SDK 调用失败时显示友好错误
    Given 用户已进入"transformer.md"的探索模式
    When 用户发送消息时 Agent SDK 失败
    Then 聊天区显示错误提示"暂时无法获取回复"
    And 用户可以继续发送下一条消息

  Scenario: 关闭探索模式标签页不丢失其他标签状态
    Given 用户有普通"README.md"和探索"transformer.md"两个标签页
    When 用户关闭"transformer.md"标签页
    Then "transformer.md"标签页关闭
    And "README.md"仍显示普通阅读视图

  Scenario: 非 Markdown 文件不显示进入探索模式选项
    Given 用户在文件树中右键点击"image.png"
    Then 右键菜单中不包含"进入探索模式"
