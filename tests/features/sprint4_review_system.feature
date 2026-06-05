# PB: 遗忘曲线复习提醒系统
# 对应模块: ReviewScheduler, ReviewModal, Rust review commands

Feature: 遗忘曲线复习提醒系统

  作为持续学习的用户
  我想要按照遗忘曲线节奏复习已学概念
  以便将短期记忆转化为长期记忆

  Scenario: 系统根据艾宾浩斯曲线计算首次复习间隔
    Given 项目中有一个新掌握的概念"位置编码"
    When 系统计算该概念的复习计划
    Then 首次复习间隔为 1 天后
    And 状态标记为 upcoming

  Scenario: 系统根据掌握状态调整复习间隔
    Given 概念"梯度裁剪"已复习 3 次，上次评级为 struggling
    When 系统计算下次复习间隔
    Then 间隔缩短为基准间隔的一半
    And 最小间隔不少于 1 天

  Scenario: 用户打开应用触发复习提醒
    Given 用户有 2 个概念已到复习时间
    When 应用启动检查每日复习
    Then 弹出复习提醒模态框
    And 显示待复习概念列表
    And 提供开始复习和稍后提醒按钮

  Scenario: 用户完成单个概念复习
    Given 用户正在复习概念"位置编码"
    And 当前 review_count 为 1
    When 用户标记为 mastered
    Then review_count 递增为 2
    And 上次评级更新为 mastered
    And 下次复习时间设为 4 天后
    And 状态变为 upcoming

  Scenario: 用户推迟复习
    Given 用户看到复习提醒但有 1 个概念不想现在复习
    When 用户选择稍后提醒
    Then 该概念的下次复习时间设为明天
    And review_count 保持不变
    And 状态变为 upcoming

  Scenario: 系统过滤未到期的复习项
    Given 项目中有 3 个概念，其中 1 个已到期，2 个未到期
    When 系统获取今日待复习列表
    Then 只返回已到期的 1 个概念
    And 未到期概念不显示

  Scenario: 复习计划持久化到后端
    Given 用户完成复习并标记为 learning
    When 系统调用 update_review_schedule
    Then project.json 中的复习计划更新
    And 包含正确的 concept、rating、review_count
