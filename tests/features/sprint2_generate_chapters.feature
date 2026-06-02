Feature: AI 逐章生成学习文档并后台预生成

  作为已确认学习大纲的用户
  我想要 AI 逐章生成学习材料
  以便我可以边读边学，同时后台准备下一章

  Scenario: 开始生成后第 1 章立即生成
    Given 用户已确认大纲并点击"开始生成"
    When Agent 开始工作
    Then 文件树显示项目文件夹
    And 第 1 章状态为"生成中"
    And 底部显示进度"正在生成第 1/8 章"

  Scenario: 第 1 章生成完成并可阅读
    Given Agent 正在生成第 1 章
    When 第 1 章生成完成
    Then 文件保存到项目目录
    And 文件树中第 1 章图标变为"就绪"
    And 用户可双击打开阅读
    And 文档以学习模式渲染（显示头部栏）

  Scenario: 用户阅读时后台预生成下一章
    Given 第 1 章已就绪且用户正在阅读
    When Agent 完成第 2 章草稿生成
    Then 文件树中第 2 章图标变为"就绪"
    And 用户阅读完第 1 章后可直接进入第 2 章
    And 底部进度更新

  Scenario: 用户完成章节测验并反馈给 AI
    Given 用户阅读完第 1 章
    When 用户完成章节末测验
    And 测验结果显示"位置编码"概念掌握不足
    Then 测验结果发送给 Agent
    And Agent 根据反馈调整后续章节
    And 如果第 2 章草稿仍适用则保留
    And 如果需要在"注意力机制"后插入加餐章节

  Scenario: 生成过程中 Agent 崩溃
    Given Agent 正在生成第 3 章
    When Node.js 子进程意外崩溃
    Then Rust 后端捕获错误
    And 向前端发送"生成中断"事件
    And 已生成的 1-2 章保留在磁盘
    And 第 3 章标记为"失败"
    And 显示"重试生成"按钮

  Scenario: 用户手动中止生成
    Given Agent 正在生成第 5 章
    When 用户点击"中止生成"按钮
    Then Rust 后端强制终止子进程
    And 已生成的章节保留
    And 未生成的章节标记为"未生成"
    And 用户可以随时点击"继续生成"恢复
