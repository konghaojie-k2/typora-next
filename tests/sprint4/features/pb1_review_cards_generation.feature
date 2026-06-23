# PB1: review-cards.json 生成 — quiz 提交时 Agent 生成概念级客观题+重点
# 对应模块: mode-integration.js (触发), lib.rs (generate_review_content), agent-bridge.js (review-gen stage)

Feature: review-cards.json 生成

  作为持续学习的用户
  我想要在完成章节 quiz 后系统自动生成概念级的复习题和重点
  以便后续复习时能做客观测验而非只有自评

  Scenario: quiz 提交后触发 review-cards.json 生成
    Given 用户完成第1章的 quiz 提交
    And 提交数据包含 weak_concepts: ["concept-A"]
    When 系统执行 persist_quiz_result 完成
    Then 系统自动调用 generate_review_content
    And review-cards.json 被创建在 .learning/ 目录下
    And review-cards.json 包含概念级字段

  Scenario: review-cards.json 的结构正确
    Given review-cards.json 已生成
    When 读取该文件
    Then 每个概念包含 quiz_questions 数组
    And 每个概念包含 key_points 数组
    And weak_concepts 中的概念标记 from_weak: true
    And 文件顶层包含 version 字段

  Scenario: 重复 quiz 提交不重复生成已有概念
    Given 概念"concept-A"的 review-cards 已存在
    When 再次提交包含 concept-A 的 quiz
    Then review-cards.json 中 concept-A 不重复添加
    And 已有卡片内容不被覆盖
