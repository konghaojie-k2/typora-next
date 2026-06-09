# PB1: 用户选中文字得到有上下文的解释 + 推荐追问
# 对应模块: explain-conversation, explain_selection_v2
# Sprint 6 总共 4 个 PB，本文件目前只含 PB1 场景；其他 PB 后续追加
# 配套设计文档: docs/design.md / docs/plans/sprint6_explain_conversation.md

Feature: AI 解释带上下文与推荐追问

  作为正在学习章节的学生
  我想要选中不懂的文字得到 AI 解释
  以便快速理解该段在当前学习中的含义

  Scenario: 选中文字得到含项目上下文的解释
    Given 项目"理解 Transformer"目标为"理解 Transformer"
    And 当前章节 5 为"位置编码"
    When 用户选中"位置编码"
    Then AI 解释中至少出现"Transformer"或"位置编码在 Transformer"1 次

  Scenario: 解释返回 3-4 个推荐追问
    Given 用户在项目内选中"注意力"
    When AI 解释响应返回
    Then 响应包含 explanation 字段
    And suggestedQuestions 数组长度在 3 到 4 之间

  Scenario: LLM 响应非 JSON 时降级
    Given LLM 响应非法 JSON
    When 解释请求返回
    Then 解释文本正常展示
    And suggestedQuestions 降级为硬编码模板数组
    And 不显示错误给用户

  Scenario: 直调 LLM 延迟 < 5s
    Given LLM 正常响应
    When 用户点 AI 解释
    Then 5 秒内显示首次解释

  Scenario: 侧栏固定 180px 不挡主内容
    Given 用户在主内容区选中文本
    When 侧栏渲染完成
    Then 侧栏宽度固定为 180px
    And 主内容区被侧栏压缩不消失

# PB2: 多轮追问
# 对应模块: explain-conversation (previousQA), explain-sidebar.js

  Scenario: 点 chip 发起追问
    Given 用户已得到首次解释并有 3 个推荐追问 chip
    When 用户点"举个例子" chip
    Then 侧栏 cue 原地累积 Q&A
    And 追加显示 Q: "举个例子" 与 新 A

  Scenario: 追问 LLM 知道前情
    Given 用户已问 1 次"位置编码是什么"得到 A1
    When 用户追问"和词嵌入啥区别"
    Then LLM 收到的 prompt 包含 previousQA 的 q 和 a

  Scenario: tab 切换时侧栏保持可见但 cue 列表重置
    Given 侧栏在 tab A 显示并有 2 条 cue
    When 用户切到 tab B
    Then 侧栏仍可见（永久存在）
    And 侧栏 cue 列表清空（新的 chapter 还没选词）

  Scenario: 窗口窄于 1024px 时侧栏折叠为图标
    Given 当前窗口宽度 1280px 侧栏展开
    When 用户把窗口缩到 900px
    Then 侧栏折叠为图标按钮
    And 主内容区恢复全部宽度
