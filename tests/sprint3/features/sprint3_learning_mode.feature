Feature: 学习模式下的文档渲染和测验

  作为正在学习项目文档的用户
  我想要沉浸式的学习体验
  以便更好地理解和掌握知识

  Scenario: 打开学习项目文档自动进入学习模式
    Given 文档所在文件夹包含 .learning/project.json
    When 用户打开该文档
    Then 渲染学习模式头部栏
    And 头部栏显示项目名称"理解 Transformer"
    And 头部栏显示"第 3/8 章"
    And 头部栏显示预计时长"25 分钟"
    And 头部栏有"标记完成"按钮

  Scenario: 学习模式下渲染概念卡片
    Given 文档中包含 `!concept` 块
    When 文档在学习模式下渲染
    Then `!concept` 渲染为黄色背景的交互卡片
    And 卡片显示概念名称
    And 悬停时显示快速解释弹窗

  Scenario: 学习模式下渲染思考题
    Given 文档中包含 `!question` 块
    When 文档在学习模式下渲染
    Then `!question` 渲染为可点击的问题卡片
    And 初始只显示问题标题
    And 点击"查看解释"后展开答案内容

  Scenario: 学习模式下渲染测验题
    Given 文档中包含 `!quiz` 块
    When 文档在学习模式下渲染
    Then `!quiz` 渲染为单选/多选题 UI
    And 选项显示为可点击卡片
    And 选中后选项高亮
    And 有"提交答案"按钮

  Scenario: 用户完成章节末掌握检查
    Given 用户阅读完一章内容
    When 滚动到章节末尾
    Then 自动显示"掌握了吗？"区域
    And 显示 3-5 道 AI 生成的测验题
    And 用户作答并点击"提交"
    Then AI 评估答案
    And 显示评级：完全掌握（🟢）/ 基本理解（🟡）/ 需要加强（🔴）
    And 如果是"需要加强"，列出薄弱概念

  Scenario: 测验评级影响掌握状态
    Given 用户提交第 2 章测验
    When 评级为"完全掌握"
    Then project.json 中"Self-Attention"状态更新为"mastered"
    And 知识图谱中对应节点变为绿色
    And 推荐用户进入下一章

  Scenario: 选中文本请求 AI 深化讲解
    Given 用户正在阅读学习文档
    When 用户选中文本"梯度消失问题"
    And 批注工具栏显示"AI 解释"按钮
    And 用户点击"AI 解释"
    Then 调用 AI 获取解释
    And 显示弹窗，内容为深入浅出的解释
    And 解释包含生活化类比
