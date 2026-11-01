Feature: 课程生成事件的项目归属隔离
  后台生成的 A 课程事件不得污染前台打开的 B 课程。
  事故（2026-10-29 实爆）：缺陷课后台生成第一章批（滑动窗口 2 章），
  用户同时打开已学完的拉晶课——chapter_complete 事件没有项目身份，
  每个存活 bridge 都用自己 ui.projectPath 持久化，拉晶课 project.json 的
  chapters[0]/chapters[1].file 被改写成缺陷课文件名，重进后按错误 file
  查 chapters_status 命中污染的 ready 键 → 头 2 章显示「被重置」。
  修复：Rust 转发层给课程事件注入 data.projectPath；前端 bridge 只处理
  属于本项目的事件，未携带身份的旧事件兼容放行。

  Scenario: 其他课程的事件被忽略
    Given 前台打开了 B 课程且章节 0 已完成
    When 收到 A 课程的 chapter_complete 事件 index 0
    Then B 课程章节 0 状态保持 completed
    And B 课程没有任何持久化写入

  Scenario: 本课程的事件正常处理并持久化
    Given 前台打开了 B 课程且章节 0 生成中
    When 收到 B 课程的 chapter_complete 事件 index 0
    Then B 课程章节 0 状态变为 ready
    And 向 B 课程持久化该章节文件与状态

  Scenario: 路径分隔符差异不影响归属判定
    Given 前台打开了 B 课程且章节 0 生成中
    When 收到以反斜杠路径标识 B 课程的 chapter_complete 事件 index 0
    Then B 课程章节 0 状态变为 ready

  Scenario: 未携带 projectPath 的旧事件兼容放行
    Given 前台打开了 B 课程且章节 0 生成中
    When 收到不带 projectPath 的 chapter_complete 事件 index 0
    Then B 课程章节 0 状态变为 ready

  Scenario: Rust 转发层为课程事件注入 projectPath
    Then ai_agent.rs 的事件转发循环应调用事件标记函数
    And agent_event_scope 模块应被 lib.rs 注册
