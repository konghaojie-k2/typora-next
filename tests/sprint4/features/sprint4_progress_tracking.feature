# PB: 学习进度追踪和知识图谱
# 对应模块: ProjectDashboard (modal), KnowledgeGraph (Rust), ReviewSummary (modal)
# 设计文档: docs/prototypes/sprint4-kg-v7a-dashboard.html, sprint4-kg-v8a-inline-modal.html

Feature: 学习进度追踪和知识图谱

  作为持续学习的用户
  我想要查看学习进度和知识掌握情况
  以便了解自己的学习状态和薄弱环节

  # ── 项目仪表盘（进入项目时必弹 modal） ──

  Scenario: 用户打开学习项目弹出仪表盘
    Given 用户有一个进行中的学习项目"理解 Transformer"
    And 该项目章节已生成且有学习记录
    When 用户在课程模式中点击该项目
    Then 弹出项目仪表盘 modal
    And modal 标题显示项目名称
    And 顶部显示统计数据（已掌握/学习中/有困难/未开始 概念数）
    And 中部显示概念依赖图
    And 已掌握概念为绿色
    And 学习中概念为黄色
    And 有困难概念为红色
    And 未开始概念为灰色
    And 显示图例说明
    And 底部显示操作按钮

  Scenario: 新项目初始状态的仪表盘
    Given 用户刚创建学习项目"理解 Transformer"
    And 章节尚未生成
    When 弹出项目仪表盘
    Then 不显示概念依赖图
    And 显示章节目录列表
    And 所有章节标记为"未生成"
    And 显示"开始生成内容"按钮
    And 不显示"继续阅读"按钮
    And 不显示统计数据

  Scenario: 已生成但未学习的仪表盘
    Given 用户的学习项目章节已生成
    And 用户未开始任何学习
    When 弹出项目仪表盘
    Then 显示概念依赖图
    And 所有节点为灰色（未开始）
    And 显示"开始学习"按钮
    And 统计显示已掌握 0 概念

  # ── 仪表盘交互 ──

  Scenario: 用户在仪表盘点击概念节点
    Given 用户在项目仪表盘中
    And 概念依赖图已显示
    When 用户点击"位置编码"节点
    Then 显示该概念的详情
    And 显示掌握状态
    And 显示前置概念和后续概念
    And 显示复习计划（如有）
    And 提供"跳转到该概念所在章节"操作
    And 提供"复习该概念"操作（如有复习内容）

  Scenario: 用户从仪表盘进入阅读
    Given 用户在项目仪表盘中
    When 用户点击"继续阅读"或点击某章节
    Then 关闭仪表盘 modal
    And 进入对应章节的阅读视图
    And 章节可自由切换，不限制阅读顺序

  Scenario: 用户关闭仪表盘直接进入阅读
    Given 用户在项目仪表盘中
    When 用户点击关闭按钮或按 ESC
    Then 关闭仪表盘 modal
    And 进入上次阅读的章节
    And 无记录则进入第一章

  # ── 复习完成后的知识图谱 ──

  Scenario: 复习完成后展示掌握状态变化
    Given 用户完成今日复习（2 个概念）
    When 复习流程结束
    Then 弹出复习完成总结
    And 显示每个概念的状态变化（如"有困难 → 学习中"）
    And 可折叠展示迷你知识图谱
    And 今日更新的节点有视觉提示（脉冲动画）
    And 提供"查看完整仪表盘"按钮
    And 提供"关闭"按钮

  # ── 知识图谱数据生成 ──

  Scenario: 知识图谱按需生成
    Given 项目有已生成的 .concepts.json 文件
    When 用户打开项目仪表盘
    And knowledge-graph.json 不存在或已过期
    Then 系统调用 build_knowledge_graph 合并所有 .concepts.json
    And 生成 knowledge-graph.json
    And 前端读取并渲染图谱

