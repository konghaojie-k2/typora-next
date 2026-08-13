Feature: 课程完成时生成 slide 总结（Course Completion Slide Summary）

  As a learner who finished a course
  I want an AI-generated theme-based slide summary when all chapters are completed
  So that I can review the whole course's core knowledge in a slideshow

  Scenario: 学完全部章节且无总结 → 提示生成
    Given a completed course project
    And no summary file exists
    When the summary offer decision is evaluated
    Then a summary offer should be shown

  Scenario: 学完全部章节但已有总结 → 不再提示
    Given a completed course project
    And a summary file already exists
    When the summary offer decision is evaluated
    Then no summary offer should be shown

  Scenario: 课程未学完 → 不提示
    Given a course project with pending chapters
    When the summary offer decision is evaluated
    Then no summary offer should be shown

  Scenario: 本会话已提示过 → 不重复弹
    Given a completed course project
    And the summary offer was already shown this session
    When the summary offer decision is evaluated
    Then no summary offer should be shown

  Scenario: 生成的总结文件能用 --- 解析成多页幻灯片
    Given an AI-written summary markdown with --- separators
    When the summary is parsed as slide structure
    Then it should yield at least 6 slide groups

  # 2026-08-12 总结升级：精华 + case study；设计思路化进主题页脉络、不单设元说明页
  Scenario: 总结包含精华提炼与 Case Study 页，且无独立的课程设计说明页
    Given an AI-written summary markdown with --- separators
    Then the summary should contain essence and case study pages without a meta design page

  Scenario: 生成总结后文件存在，可再次进入
    Given the course summary file was written to disk
    When summary existence is checked
    Then the summary file should exist

  Scenario: 前端已加载 course-summary 模块并暴露放映入口
    Given the real index.html markup
    Then the page should load the course summary module
    And the app should expose openSlides and showToast

  Scenario: 项目已捆绑 typora-course-summary skill，bridge 引用它
    Given the real bundled skills directory
    Then a typora-course-summary skill should exist with valid frontmatter
    And the agent bridge should reference it by name
