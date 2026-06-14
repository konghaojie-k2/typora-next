Feature: 课程模式入口

  作为想要学习的用户
  我想要一个统一的课程模式入口
  以便管理多个学习项目，新建或继续已有项目

  Scenario: 用户打开课程模式
    Given 用户在主界面
    When 点击工具栏"课程模式"按钮
    Then 显示学习项目列表
    And 列表底部有"新建学习项目"按钮

  Scenario: 学习项目列表为空
    Given 用户没有创建过任何学习项目
    When 打开课程模式
    Then 列表显示空状态提示
    And 提示"还没有学习项目，点击下方按钮开始"

  Scenario: 学习项目列表显示已有项目
    Given 用户之前创建过 2 个学习项目
    When 打开课程模式
    Then 列表显示 2 个项目卡片
    And 每个卡片显示项目名称和章节数
    And 每个卡片显示进度百分比

  Scenario: 用户点击已有项目继续学习
    Given 学习项目列表中有"Transformer 学习"项目
    And 该项目已完成 3/8 章
    When 用户点击该项目卡片
    Then 关闭项目列表
    And 加载项目状态
    And 显示进度面板
    And 进度面板显示 3/8 章已完成

  Scenario: 用户从项目列表新建学习项目
    Given 用户在学习项目列表页面
    When 用户点击"新建学习项目"按钮
    Then 关闭项目列表
    And 打开新建学习项目对话框

  Scenario: 用户删除已有学习项目
    Given 学习项目列表中有"Transformer 学习"项目
    When 用户点击该项目的删除按钮
    Then 弹出确认对话框
    And 确认后从列表移除
    And localStorage 中删除对应记录
