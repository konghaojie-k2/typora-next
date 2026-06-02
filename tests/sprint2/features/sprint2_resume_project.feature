Feature: 从已保存项目继续学习

  作为已创建学习项目的用户
  我想要打开 app 后直接继续生成章节
  以便不需要重新走创建流程

  Scenario: app 启动时检测到已有学习项目
    Given 当前目录包含 .learning/project.json
    And 项目大纲包含 8 章
    And 所有章节状态为"未生成"
    When app 启动
    Then 自动加载项目状态
    And 显示进度面板
    And 显示项目名称和章节数

  Scenario: 用户从保存状态直接继续生成
    Given 已加载的学习项目有 8 章"未生成"
    When 用户点击"继续生成"按钮
    Then 调用 Rust generate_chapters
    And 第 1 章状态变为"生成中"
    And 进度面板实时更新

  Scenario: 项目部分章节已生成
    Given 已加载的学习项目有 8 章
    And 前 3 章状态为"已完成"
    And 第 4 章状态为"失败"
    When 用户点击"继续生成"按钮
    Then 从第 4 章开始重新生成
    And 前 3 章保持"已完成"状态
