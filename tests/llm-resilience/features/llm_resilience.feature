Feature: LLM 调用状态感知与故障分级
  背景：2026-10-14 DeepSeek 流式断流事故——气泡只显示「正在思考」，
  agent 检测假绿，用户完全无法感知模型故障。
  设计文档：docs/plans/2026-10-14-llm-provider-failover-design.md

  Scenario: SDK 自动重试时 bridge 发出状态事件
    Given mock SDK 在本轮会先触发 1 次自动重试
    When bridge 执行一轮对话
    Then stdout 应出现 status 事件且文案含 自动重试

  Scenario: 看门狗判死的错误被分类为 STALL
    When classifyError 收到看门狗断流错误
    Then 错误码应为 STALL

  Scenario: 鉴权失败被分类为 AUTH_FAILED
    When classifyError 收到 401 错误
    Then 错误码应为 AUTH_FAILED

  Scenario: 网络失败被分类为 NETWORK
    When classifyError 收到 DNS 解析失败错误
    Then 错误码应为 NETWORK

  Scenario: 普通错误的分类为 UNKNOWN
    When classifyError 收到普通错误
    Then 错误码应为 UNKNOWN

  Scenario: Rust 把 status 行透传到各伴学事件通道
    Then Rust 的三个伴学命令都应转发 status 事件

  Scenario: 伴学前端 loading 气泡可响应状态事件
    Then 伴学面板应处理 status 载荷并更新 loading 气泡

  Scenario: 故障气泡按分级提供动作按钮
    Then 伴学面板应实现错误分级、分级文案与重试/打开设置按钮

  Scenario: check 阶段对激活配置做真实连通性 ping
    Then bridge 的 check 阶段应在 SDK 可用时调用 pingProvider
    And Rust 的 check_agent_sdk 应把真实配置传给 bridge

  Scenario: ping 失败按分级错误码返回
    When pingProvider 收到 401 响应
    Then ping 结果错误码应为 AUTH_FAILED
    When pingProvider 收到 DNS 失败
    Then ping 结果错误码应为 NETWORK
    When pingProvider 收到正常响应
    Then ping 结果应为 ok

  Scenario: 旧四字段配置自动迁移为单 profile 并激活（Rust）
    Then AppConfig 应有 ai_profiles 与 active_profile_id 字段
    And get_config 应做旧字段迁移与激活派生
    And set_config 应在落盘前从激活 profile 派生旧字段

  Scenario: profile 卡片操作（真实模块）
    When ProfileOps 向空列表新增一张卡片
    Then 列表应有 1 张且自动激活
    When ProfileOps 再新增一张卡片
    Then 列表应有 2 张且激活仍为第一张
    When ProfileOps 激活第二张卡片
    Then 激活项应为第二张且派生旧字段等于第二张的内容
    When ProfileOps 删除第二张卡片
    Then 激活项应回退到第一张

  Scenario: 设置面板 profile 列表接线
    Then 设置面板应渲染 profile 卡片列表并支持激活/编辑/复制/删除/检测

  # 2026-10-15 事故：激活只改内存态没落盘，磁盘仍是旧卡，
  # 状态灯检的是磁盘配置 → 用户分不清「到底谁在用」
  Scenario: 激活卡片立即落盘（不等保存按钮）
    When SettingsPanel 在无 DOM 环境下激活第二张卡片并持久化
    Then set_config 载荷的 active_profile_id 应为第二张
    And set_config 载荷的派生旧字段应等于第二张的内容
    And set_config 载荷应保留磁盘上的既有字段

  Scenario: 激活按钮接线立即落盘（静态检查）
    Then 激活按钮处理器应调用 _persistProfiles

  Scenario: 激活落盘失败透出具体错误
    When set_config 抛错时执行持久化
    Then 不应静默吞错

  # 保存设置后状态灯应立即反映新激活配置的连通性
  Scenario: 保存设置后重检 agent 状态灯（静态检查）
    Then onSettingsSaved 应触发 agent 状态重检

  # 信号链最后一跳：ping 失败 → 红灯（防回归守护）
  Scenario: ping 失败时状态灯变红（静态检查）
    Then checkAgentSdk 应将 ping 失败映射为 unreachable 红灯

  # 2026-10-15 MiniMax 事故：Rust 直调裸拼 /v1 → /v1/v1 → 404，
  # 而 bridge 有归一化 → 两条路径一红一绿互相矛盾
  Scenario: Rust 直调路径统一走 base_url 归一化（静态检查）
    Then Rust 源码不应再出现裸拼 /v1 版本段
    And versioned_url 的语义应与 bridge 归一化一致（Rust 测试守护）

  # 2026-10-15 实机踩坑：编辑表单后点检测，测的是卡片旧值（表单未刷入）
  Scenario: 卡片检测应先刷入正在编辑的表单值（静态检查）
    Then _checkProfileCard 应在检测前刷入表单值

  # 2026-10-15：test_llm_config 无超时，服务端不应答则永远「检测中…」
  Scenario: test_llm_config 必须有超时（静态检查）
    Then test_llm_config 的 ureq 调用应设置超时

  # 每卡已有「检测」，底部旧「测试连接」重复且语义混乱（测的是激活卡而非编辑中的卡）
  Scenario: 移除底部旧的测试连接按钮（静态检查）
    Then 设置面板不应再有 测试连接 按钮

  # 2026-10-15 DeepSeek 画图卡死事故：思考型模型一轮 2920 条 thinking_delta
  # debug 日志 ≈ 64KB 写满 stderr 管道缓冲 → Node 同步写阻塞整个事件循环 →
  # 看门狗随循环饿死，Rust/bridge 双向互锁永不退出。双层修复：bridge 治本 + Rust 防御。
  Scenario: bridge 的 debug 日志不得写入 stderr（管道死锁治本）
    Then log 函数的 debug 级应只落文件不写 stderr
    And session 事件订阅应跳过思考与工具调用的逐 delta 日志

  Scenario: Rust 流式命令必须并发排空 stderr（管道死锁防御）
    Then 三个流式聊天命令都应用线程排空 stderr
