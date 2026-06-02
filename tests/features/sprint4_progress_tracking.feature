Feature: 学习进度追踪和知识图谱

  作为持续学习的用户
  我想要查看学习进度和知识掌握情况
  以便了解自己的学习状态和薄弱环节

  Scenario: 用户打开知识图谱 Tab
    Given 学习项目有 8 章，已完成 3 章
    When 用户点击侧边栏"知识图谱" Tab
    Then 显示概念依赖图
    And 已掌握概念为绿色
    And 学习中概念为黄色
    And 有困难概念为红色
    And 未开始概念为灰色
    And 显示图例说明

  Scenario: 点击知识图谱节点跳转章节
    Given 知识图谱 Tab 已打开
    When 用户点击"多头注意力"节点
    Then 跳转到"03-多头注意力图解.md"
    And 文档滚动到该章节开头
    And 该节点高亮闪烁 2 秒

  Scenario: 查看项目级进度面板
    Given 用户在学习项目中
    When 查看进度面板
    Then 显示"已完成 3/8 章"
    And 显示"掌握 5/12 个概念"
    And 显示"学习时长 2.5 小时"
    And 显示预计剩余时长

  Scenario: 遗忘曲线触发复习提醒
    Given 用户 3 天前完成"理解 Transformer"项目
    When 今天打开 Typora Next
    Then 弹出"快速复习"提示
    And 显示 3 道之前做错的题目
    And 显示 2 个关键概念卡片
    And 预计 5 分钟完成
    And 提供"开始复习"和"稍后提醒"按钮

  Scenario: 完成复习更新掌握状态
    Given 用户正在复习"位置编码"概念
    When 用户正确回答复习题
    Then 该概念掌握状态更新为"mastered"
    And 下次复习时间更新为 7 天后

  Scenario: 用户重置学习进度
    Given 用户已完成项目的大部分内容
    When 用户点击"重置进度"按钮
    And 确认重置操作
    Then 所有章节状态恢复为"未开始"
    And 所有概念状态恢复为"未开始"
    And 测验记录清空
    And 保留原始 Markdown 文档内容
