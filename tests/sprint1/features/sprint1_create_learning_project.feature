Feature: 用户创建学习项目并获取 AI 生成的大纲

  作为想要学习新知识的用户
  我想要创建一个学习项目并让 AI 设计学习路径
  以便我可以系统地学习一个主题

  Scenario: 用户打开新建学习项目对话框
    Given 用户在 Typora Next 主界面
    When 点击工具栏"新建学习项目"按钮
    Then 弹出模态对话框
    And 对话框包含学习目标输入框
    And 对话框包含难度级别选择（小白、有编程基础、专业进阶）
    And 对话框包含预计时长选择
    And 对话框底部有"开始设计"按钮

  Scenario: 用户填写学习目标并提交
    Given 新建学习项目对话框已打开
    When 用户在学习目标输入框填入"理解 Transformer"
    And 选择难度"有编程基础"
    And 选择预计时长"3小时"
    And 点击"开始设计"按钮
    Then 按钮变为加载状态
    And 对话框显示"AI 正在设计学习路径..."

  Scenario: AI 成功生成学习大纲
    Given 用户已提交学习目标"理解 Transformer"
    And AI 配置已正确设置
    When Agent 完成大纲生成
    Then 对话框切换到"大纲预览"视图
    And 显示章节列表，每章有标题和预计时长
    And 总时长接近用户指定的 3 小时
    And 基础概念章节排在进阶章节之前
    And 底部有"重新规划"和"开始生成"按钮

  Scenario: AI 生成大纲失败（网络/API 错误）
    Given 用户已提交学习目标
    And AI API 不可用或配置错误
    When Agent 调用失败
    Then 对话框显示错误信息"无法连接 AI 服务，请检查设置"
    And 显示"重试"按钮
    And 用户仍可以修改输入重新提交

  Scenario: 用户编辑 AI 生成的大纲
    Given AI 已生成大纲并展示在预览视图
    When 用户点击第 2 章的"编辑"按钮
    And 将标题从"注意力机制"修改为"注意力机制详解"
    And 点击"确认"
    Then 章节列表显示修改后的标题
    And 其他章节保持不变

  Scenario: 用户删除大纲中的章节
    Given AI 已生成大纲并展示在预览视图
    When 用户点击第 3 章的"删除"按钮
    Then 该章节从列表中移除
    And 后续章节序号自动调整
    And 总时长重新计算

  Scenario: 用户重新规划大纲
    Given AI 已生成大纲并展示在预览视图
    When 用户修改了某些章节
    And 点击"重新规划"按钮
    Then 对话框显示加载状态
    And Agent 根据修改后的要求重新生成大纲

  Scenario: 用户确认大纲并开始生成
    Given AI 已生成大纲并展示在预览视图
    When 用户点击"开始生成"按钮
    Then 对话框关闭
    And 创建学习项目文件夹
    And 保存大纲到 .learning/project.json
    And 开始生成第 1 章内容
