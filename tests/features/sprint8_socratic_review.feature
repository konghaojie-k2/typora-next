# PB: 苏格拉底式复习（多概念体系巩固）
# 对应模块: SocraticModal, SocraticTrigger, Rust socratic commands
# 设计依据: docs/design.md Sprint 8 章节 + docs/prototypes/sprint8-socratic-mockups.html V2

Feature: 苏格拉底式复习（多概念体系巩固）

  作为持续学习的用户
  我想要在掌握多个概念后做一次"体系巩固"复习
  以便用自然语言阐述概念之间的关系（"是什么关系"），而不是只答多选

  Background:
    Given 用户的项目已有 5 个 mastered 概念
    And 知识图谱中这 5 个概念有 4 条强边（weight >= 0.5）

  # ============================
  # 触发
  # ============================

  Scenario: 完成 N 次 quiz 后弹出 Socratic 复习推荐
    Given 用户已完成 4 次 quiz
    And 距上次 Socratic 复习 > 7 天
    When 用户完成第 5 次 quiz
    Then 弹出"要做次体系复习吗？"toast 提示
    And toast 含 3 个按钮：开始 / 稍后 / 不再提醒

  Scenario: 用户选择"稍后"后 24 小时内不再弹
    Given 用户刚看到 Socratic 复习 toast
    When 用户选择"稍后"
    Then 24 小时内再完成 quiz 不再弹 toast
    And socratic-state.json 记录 last_dismissed_at

  Scenario: 用户选择"不再提醒"后永久静默
    Given 用户刚看到 Socratic 复习 toast
    When 用户选择"不再提醒"
    Then 后续任意次 quiz 完成都不再弹 toast
    And socratic-state.json 中 opt_out 为 true

  # ============================
  # 选 cluster
  # ============================

  Scenario: 用户点击"开始"后从 KG 选 cluster
    Given 用户刚看到 Socratic 复习 toast
    When 用户选择"开始"
    Then 调用 socratic_select_cluster 选 cluster
    And cluster 包含 4-6 个概念
    And cluster 内的概念都至少有 1 条强边相连
    And 弹 V2 Notebook modal 展示 cluster 概念

  Scenario: KG 稀疏时走 fallback 不崩溃
    Given 知识图谱中只有 2 个概念
    When 用户点击"开始"
    Then cluster 包含 2 个概念（不全为 4-6）
    And modal 正常打开

  # ============================
  # 对话流程（V2 Notebook）
  # ============================

  Scenario: 多轮对话以 notebook 卡片形式累积
    Given Socratic modal 已打开
    When tutor 问"说说 JWT 和 OAuth2 是什么关系？"
    And 用户回答"JWT 是 token 格式，OAuth2 是授权框架"
    And tutor 追问"那 JWT 是必须的吗？"
    And LLM 返回 {content: "...", done: true}
    Then modal 顶部出现"本次 Socratic 复习完成"卡片
    And 聊天区有 3 张 notebook 卡片（2 个 Q&A + 1 个 done）

  Scenario: 用户主动"结束"触发二次确认
    Given Socratic modal 已打开
    When 用户点击"结束"
    Then 弹二次确认"确定提前结束？对话仍会保存"
    And 用户点"确认"后 modal 关闭
    And session 文件仍落盘（end_reason = "user_ended"）

  # ============================
  # 关键回归
  # ============================

  Scenario: Socratic 结束后 concept status 不变
    Given 概念"JWT"status 为 mastered
    And 概念"OAuth2"status 为 mastered
    And Socratic modal 已打开包含这 2 个概念
    When Socratic session 结束
    Then 概念"JWT"status 仍为 mastered（未被改动）
    And 概念"OAuth2"status 仍为 mastered（未被改动）
    And project.json 的 concepts 字段未被 Socratic 写入

  Scenario: session 落盘不污染 quiz-history.json
    Given Socratic session 已结束
    When 系统保存 session
    Then .learning/socratic-sessions/<ts>.json 文件存在
    And 文件包含完整对话 turns
    And .learning/quiz-history.json 内容不变（无 Socratic 条目）
    And project.json 的 concepts 字段未变

  # ============================
  # YAGNI 边界
  # ============================

  Scenario: 24h 内同一 cluster 不重复
    Given 用户 1 小时前做过 Socratic 复习（cluster_hash = X）
    When 系统再次触发 Socratic
    And BFS 选出的 cluster 仍是 X
    Then 不弹 toast，提示"今天已做过"
    And socratic-state.json 的 recent_cluster_hashes 包含 X
