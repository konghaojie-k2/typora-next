# Changelog

## [0.4.11] - 2026-10-29

### Features

- **Tab 页拖拽重排**：tab 栏支持按住左右拖动调整顺序（Chrome/VSCode 式）。拖拽中被拖 tab 跟随指针移动、相邻 tab 显示 2px 插入指示条；4px 位移阈值区分点击与拖拽，松手才提交重排且激活态跟随同一文件不丢；拖拽中切出窗口自动取消。实现采用 commit-on-drop（拖拽中不动 tab 状态，松手一次性提交后重建），规避渲染闭包捕获序号的 stale 引用陷阱
- **学习中心已学完徽标**：已学完的课程项目卡片显示「🎉 已学完」徽标 + 淡绿边框 + 绿色满格进度条，meta 文案不再显示「100% 完成」数字，完结态去催促感。判定复用 course-completion 的权威函数，不在 hub 里重写规则

## [0.4.10] - 2026-10-21

### Features

- **「💬 我有话说」形态重定位——AI 从评委变接球手**：对话形态改为引导 + 轻推 + 按需反馈——短回应（2~4 句）+ 推进式追问；明显误解不直接纠正，抛矛盾情境轻推；学生主动要反馈才进入评价模式，评价后也不出检验题（原四段评价模板废除）。talk 模式打开即显示静态引导气泡（不调 LLM、不落盘、续聊回放不出现），快捷 chips 换为表达支架句
- **SVG 导出居中**：「⬇️ SVG」导出的图不再贴左上角——剥除内联 max-width（贴边真凶）、viewBox 四周各加 24 单位对称留白、preserveAspectRatio 居中。两种模式：Mermaid 一屏居中（fillViewport）/ 正文插图按预览比例（fitWidth）；viewBox 缺失或非法时原样导出，宁可不居中也不改坏图
- **正文内嵌 SVG 插图下载**：课程正文里的 `<svg>` 插图也挂「⬇️ SVG」下载按钮，与 Mermaid 共用一条导出路径（排除已有按钮的 mermaid 块、KaTeX 数学符号与按钮图标）

## [0.4.9] - 2026-10-15

### Features

- **多 profile 模型配置**：设置面板改为「一张卡 = 连接 + 模型」的多配置卡，可预存多套 LLM 配置一键切换；点「激活」立即落盘，不再依赖底部保存；卡片「检测」先刷入编辑中的表单值。旧四字段配置自动迁移、降级为激活卡的派生视图
- **LLM 全链路状态感知**：真实连通性检测（ping 替代假绿）+ 分级错误码（鉴权失败 / 网络 / 断流 / 未知）；SDK 自动重试翻译为状态事件透出到伴学气泡，故障气泡按分级提供重试 / 打开设置入口；保存或激活配置后状态灯自动重检

### Fixes

- **stderr 管道死锁**（DeepSeek 思考型模型画图卡死实测）：一轮数千条 thinking_delta 调试日志写满 64KB 管道缓冲，Node 同步写阻塞事件循环、与 Rust 只排 stdout 的读取循环互锁永不退出。bridge 的 debug 级日志改为只落文件不写 stderr、订阅日志跳过逐 delta 洪峰；Rust 侧三个伴学命令的 stderr 改后台线程并发排空
- **base_url 归一化**：MiniMax 官方 base_url 尾部自带 /v1，旧代码再拼一次 /v1 变成 /v1/v1 导致 404 假绿。现 Rust 侧 14 处拼接统一走 versioned_url，与 bridge 归一化同语义（尾部已带 /v\d+ 不再追加）
- **mac 更新器验签必败**：universal 包与单架构包发布同名 tar.gz 互相覆盖，验签必败；现统一走 universal 包

## [0.4.8] - 2026-10-09

### Features

- **AI 伴学「🖼️ 画个图」按需可视化**：学习中遇到抽象概念（如硅 (111) 面原子排列、Jackson 因子）而课程该处没有配图时，划词气泡菜单新增第四项「🖼️ 画个图」。新增 typora-course-visualize skill：先在 Wikimedia Commons 检索真图（mime 过滤 + upload 直链），未命中再按 inline-svg-spec 手绘 SVG 示意（气泡不渲染 mermaid，故禁用）。气泡 markdown 渲染新增 ` ```svg ` 占位符通道——先于通用代码围栏提取、转义后还原为活图，还原前 sanitize 剥除 script / on* 事件属性 / foreignObject。面板内首轮自动出图、追问续 session、结束落盘 `.learning/visualizations/`，伴学记录归并后可续聊（覆盖原文件）

### Fixes

- **划线后再点伴学菜单一闪而过**：划线完成时 `removeAllRanges()` 清空了选区，而全局 mouseup 监听没有对「点击落在工具栏内部」做豁免（mousedown 有、mouseup 没有，不对称），导致点 ✨ 按钮的抬起瞬间工具栏被销毁。现 mouseup 补上同款豁免；伴学文本来源也增加回退——选区已空时从 `lastAnnotationId` 对应的划线元素取文本，不再依赖 window.getSelection
- **冷启动双击 .md 不自动加载**（issue #6）：应用尚未启动时双击关联文件，argv 里的文件路径在窗口就绪前到达、事件丢失，打开的是空界面。现 argv 路径改走 pending 缓冲（PendingOpenBuffer，取走即永久关闭），前端初始化完成后主动拉取

## [0.4.7] - 2026-10-08

### Features

- **AI 对话气泡数学渲染**：伴学 / 苏格拉底 / 案例研习 / 探索聊天四条对话链路共用的轻量 markdown 渲染器（markdown-utils.js）原先没有数学分支，AI 回答里的 `$...$` / `$$...$$` 原样漏出（如 Torr→bar 换算公式显示为源码）。现与主预览同构：数学公式先抽取为占位符保护，再走轻量管线，最后经 katex.renderToString 还原（displayMode 与 throwOnError:false 语义同主预览 initMathRendering）。LaTeX 源码不再被斜体、实体转义、换行替换破坏；代码块内的 `$` 豁免；无 katex 环境（Node 测试）或渲染失败时回退原文

### Fixes

- **气泡内大标题把版面撑开**：气泡样式表只适配了 h3/h4，AI 回复里的一二级标题落进 main.css 文档级 h1/h2 样式（超大字号 + 大间距 + 下边框横线），标题与正文之间间隔巨大。现气泡内 h1/h2 压到气泡尺度（15px、统一 8px/4px 间距、去文档级下边框），与 h3/h4 形成轻微层级

## [0.4.6] - 2026-09-20

### Features

- **AI 伴学统一入口**：划词后的「解释 / 举例 / 我有话说」并入同一个伴学面板，取代原先的解释气泡与独立案例研习面板（case-study-modal 已删除）。侧栏提供不划词的「我有话说」入口；同概念跨模式归并为一条记录，历史可续聊；own-voice skill 控制回答方式
- **Word 导出表格列宽**：导出表格原先没有 tblGrid 列宽定义，Word 按内容重排导致首列（如 `#` 序号列）被压到比单元格内边距还窄。现在按各列最宽单元格的显示宽度（中日韩字符记 2 列）开方加权分配 8504 twips 版心宽，配合 tblLayout Fixed 与逐格 tcW 固定；列宽下限约三个汉字防短列塌缩
- **附加题指代对象同屏可见**：附加题题干常指代该 cue 划选的原文（「关于这段…查询」），但回顾弹窗只有题干和选项，指代对象不可见导致题目无法作答。现在后端把划选内容随题带出、渲染在题干上方（单行引用条 / 多行等宽代码块，保留缩进与连续空格）；生成侧同步收紧 prompt，禁止「这段 / 上述 / 该查询」这类悬空指代

### Fixes

- **Word 导出图片超高**：图片原先只限宽度，竖版 Mermaid 流程图按宽度撑满后会等比例变高（11 步 flowchart TB 曾达 16.6 英寸 vs 9.13 英寸版心）。现在宽高双轴限幅（566×800px），取更紧的一轴等比缩放；小图放大上限 2.0 倍，防小图标被拉糊满页
- **Word 导出模板设置不生效**：设置面板写入的 `word_export_use_template` 键后端 AppConfig 未声明，serde 反序列化时被静默丢弃——设置显示保存成功但永不生效。现已声明该字段，并加契约测试：前端提交的每个配置键后端都必须声明，防同类键名漂移再次静默失效
- **mock-dom innerHTML 恒为空串**：`div.textContent = x; return div.innerHTML` 这一 escapeHtml 惯用写法在测试 mock 下永远拿到空串（getter 只回放 setter 写入值）。现补 textContent 转义回填，与真实 DOM 序列化语义一致

## [0.4.5] - 2026-09-17

### Features

- **滑动窗口并行章节生成**：窗口内非首位章节改走 fresh-session 并发生成（并发上限 2，防 API 限流），多章总耗时从 t1+t2 降到约 max(t1,t2)。因为 session 记忆不再是可靠的跨章上下文来源（并行非首章不走原 session，且 session 历史会随章节增多被截断），新增「生成前必读上一章正文 + `concepts.json`」硬要求，保证术语、译名、记号体系与衔接语和上一章一致
- **案例研习历史会话可续聊**：历史列表点进去不再只读——回放已存轮次、输入框可用、追问续接原 pi session。打开时仍不自动发起 LLM 调用（避免「看一眼历史就烧一次 token」）

### Fixes

- **NSIS 重装后桌面快捷方式变通用白图标**：根因不是 .lnk 写坏（target 与图标数据均正确、Shell 能正常解析），而是重装窗口期——旧卸载器先删掉 `$INSTDIR`（含 app.exe），此刻已存在的 .lnk 指向不存在的图标源，Windows 就把「该源没有图标」写进 `iconcache_*.db`；而 NSIS 生成的 .lnk 不带显式 `IconLocation`（图标靠系统回退读 exe），缓存一旦坏掉没有东西把它顶回来。现由安装钩子用 `IShellLink::SetIconLocation` 原地写显式图标（保留 AppUserModelID 等属性）+ `SHChangeNotify(SHCNE_ASSOCCHANGED)` 强制 shell 刷新
- **`icons/icon.ico` 小尺寸使用 PNG 编码**：16~64px 改为 BMP(DIB)，只给 256 保留 PNG——Windows 对小尺寸 PNG 条目支持不完整，是 shell 白图标的另一常见成因。像素与原图完全一致，仅换容器
- **案例研习气泡代码块白天主题不可读**：气泡 `pre` 底色原为半透明灰（白天主题合成成浅底），而代码文字色 `#cdd6f4` 是专为深底设计的，浅底配浅字导致几乎不可读（深色主题只因半透明灰叠在暗底上才碰巧正常）。现与正文代码块统一为不透明深底 `#1e1e2e`
- **退出案例研习后重进无法追问**：历史会话原为只读且输入框 `disabled`，而 `learning.css` 里根本没有 `.socratic-input:disabled` 样式——锁定态与可编辑态外观完全一致，用户只会判定为「输入框坏了」。现补上禁用态视觉
- **续聊产生重复历史条目**：会话文件名原按 `ended_at` 生成，续聊再保存会多出一条（旧的 N 轮 + 新的 N+M 轮）且列表不去重。现列表注入 `file` 身份字段、续聊覆盖原文件（含目录穿越校验，非法值回落新建）
- **续聊截断原对话**：只读分支没有把已存轮次灌入 `turns`，一旦允许落盘，写出的是「只剩新增轮次」的会话
- **翻开历史未追问却重写文件**：仅打开再关闭会把 `ended_at` 改成当下时间，历史条目按它排序会无端置顶。现无新增轮次则不落盘
- **`tests/run-all.js` 漏跑 `.mjs` 测试**：发现规则只认 `.js`，`sprint1/test_pi_bridge.mjs`（26 例）与 `sprint31/test_parallel_chapters.mjs`（6 例）长期静默未执行，现一并纳入（测试总数 972 → 1004）

## [0.4.4] - 2026-09-09

### Fixes

- **自动更新不可用（issue #6 根因修复，Sprint 27）**：updater 插件的 reqwest 未启用 system-proxy，且 GUI 进程不继承终端代理环境变量，代理环境下更新检查直接失败——现在自动探测系统代理（环境变量 → Windows 注册表，支持分协议格式）并显式传给更新检查与下载
- **更新过程无进度反馈**：点击「更新」后横幅原地变形为进度卡片，实时显示已下载 MB / 百分比进度条，下载完成、安装、重启各阶段状态可见；失败时显示原因并可关闭重试
- **About 面板检查更新死胡同**：手动检查发现有新版本时只有「请更新」文字没有安装入口，现在同样弹出可操作的更新横幅
- 更新检查失败不再一律误报「更新服务未配置」，透出真实错误原因

### Features

- 工具栏右上角常驻显示当前版本号

## [0.4.3] - 2026-09-07

### Features

- **工科/人文课程内联 SVG 实物插图（Sprint 24）**：engineering/humanities 课程每章自动生成 ≥1 个内联 SVG 插图（设备剖面、工艺流程、空间布局）——mermaid 画关系，SVG 画实物感；680px 画布 + 浅色底卡统一视觉规范；E 层硬校验缺图违规并触发 AI 补图修复闭环；插图随 Word 导出位图化进 DOCX
- **学习者画像（Sprint 23）**：根据学习者背景动态调整讲解深度与类比素材，规划 prompt 注入画像
- **跨课程记忆（Sprint 21）**：结课生成学习档案 + 全局索引，新课程规划时自动注入已掌握内容
- **结课 roadmap「📍 下一站」（Sprint 22）**：学完后推荐后续学习路线
- **课程类型自适应章节模板（Sprint 19）**：technical / humanities 分支模板，LLM 规划时自动分类并持久化
- **课程内容元素约束（Sprint 20）**：engineering 域禁止编程代码块，D 层硬校验
- CJK 代码块对齐（Sprint 18）：canvas 实测字宽补偿，ASCII 线框图含中文不再错位
- YAML frontmatter 混合渲染：扁平 key:value 卡片化，复杂结构降级为 Prism 高亮原块

### Fixes

- **LaTeX 兼容层（Sprint 25）**：真 LaTeX 合法但 KaTeX 拒绝的写法（间距命令后裸上下标 `\,^`）在数学提取层自动补空基元，LLM 生成的化学方程式类公式不再以红色源码炸开；主渲染与 DOCX 导出共用同一修复
- **Word 导出四连修**：CSP 遗漏 blob: 导致 mermaid 回退源码、内联 `<svg>` 不进 DOCX、默认样式、图片尺寸过小（后端统一 540px 显示宽度 ×3 渲染）
- **Mermaid AI 修复卡死三连修**：LLM 返回空结果显式报错（按钮不再永远卡在加载态）、DeepSeek 思考型模型关闭 thinking（reasoning 耗尽 max_tokens 导致正文 0 字）
- 章节生成静默卡死双根因修复

### Changed

- learning.css 去重 -4134 行重复规则

## [0.4.2] - 2026-08-13

### Fixes

- **macOS AI 学习检测修复**：dmg 版找不到 `agent-bridge.mjs` 导致 AI 学习功能在 mac 上完全不可用——Tauri bundle resources 在 mac 落于 `Contents/Resources/`，现已补入候选路径（Windows 版不受影响）
- 划词解释内容在第一个引号处被截断：模型写 JSON 文本值内的裸半角引号导致解析失败，改为结构边界提取 + skill 源头禁令

### Features

- **案例研习**（课程模式）：划词后原地触发 📋 案例研习，AI 生成「情境/应用/启示」三段式真实案例；支持追问续聊（流式输出 + markdown 渲染）、结束落盘、历史回看只读
- **课程完结终态**：全部章节学完后的完结徽标与复习入口（中性样式，不再催促）
- 选择题质量三层防御：生成规则 / 选项洗牌 / 校验重写
- 外部文件刷新兜底：工具栏刷新按钮 + 切回标签自动检测

### Changed

- 课程总结入口暂时隐藏：自动生成的 slide 总结质量未达预期，📊 总结按钮与完成弹窗先关闭，功能保留待质量达标后恢复

## [0.4.0] - 2026-08-04

### Breaking — Agent 内核替换：Claude Agent SDK → Pi coding agent SDK

- **AI 学习功能的 agent 内核整体替换**为 [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
  - **存量用户需要改装 SDK**：`npm install -g @earendil-works/pi-coding-agent`（应用内引导提供自动安装；不再需要 `@anthropic-ai/claude-agent-sdk`）
  - 模型自由：内核模型无关，应用内设置支持 Anthropic / OpenAI / 任意 OpenAI 兼容端点（如 DeepSeek），与翻译共用同一套配置
  - 流式升级为逐 token（此前第三方模型整段返回）；skills 目录 `.claude/skills/` → `.pi/skills/`
  - agent session 改为文件持久化（旧 session 不可续用，首次自动新建，无感迁移）
  - bridge 的 12 个 stage、stdout 事件协议、Tauri 命令契约全部保持不变

### Features

- **SDK 初始化状态机**：安装（初始化）与使用检测分离——首启给一次性"首次初始化"引导（自动安装 / 手动命令 / 填 Key 提示），之后缺失只在状态芯片和用时错误中体现，不再反复打扰
- **API Key 未配置提示**：SDK 就绪但 Key 未填时弹一次性引导，「去设置」按钮直达设置面板
- 译文回显的"段落 N:"前缀清除（prompt 禁回显 + 兜底清洗 + 旧缓存加载即修复）

### Fixes

- 课程章节生成后点击报 "File not found" 的痼疾根因：`ChapterStatusManager` 从未拿到 `ui` 绑定，裸文件名未归一化（此前靠重新进入时的路径猜测掩盖）
- 大纲生成 `max_tokens` 2048 → 8192：修复长时长大纲（如 5h 小白级 10+ 章）JSON 中途截断报 EOF
- openai base_url 归一化 `/v1`：消除 ureq 直调与 pi SDK 的拼接语义错位（deepseek 碰巧兼容，OpenAI 官方端点会 404）
- 康奈尔追问「发送」按钮补背景色：修复白字落在默认灰底上看似禁用的视觉失效
- `stdout-dump.txt` 补 `.gitignore` 规则（注释提过但规则漏写，三次复发根治）
- e2e 测试既有损坏修复（`tests/unit` 早已不存在）；`session_refresh` 事件提升到统一包装层（真实/模拟路径契约一致）

### Refactor / Infrastructure

- agent-bridge 转 ESM（`.mjs`），pi SDK 经 `TYPORA_PI_SDK_ENTRY` 绝对路径加载（ESM 不吃 NODE_PATH）；SDK 可用性检测从 spawn `node require` 改纯文件系统探测
- 测试层收敛：3316 行 claude 形状测试 → 契约套件（22 断言）+ `mock-pi-sdk`（经 `TYPORA_PI_SDK_ENTRY` 注入，e2e 同源复用）
- 门禁：run-all 640+ 全绿、bdd-acceptance 全绿、e2e 3/3、`cargo check` 无错误

## [0.3.1] - 2026-08-03

### Features — 工具栏菜单合并 + 康奈尔划词痕迹

- 工具栏导出 Word/PDF/分享合并为下拉菜单，引导自动展开
- 康奈尔划词痕迹：正文波浪线标记 + hover 摘要气泡 + 点击跳转侧栏
- Mermaid AI 修复增强：显示具体解析错误、120s 超时、调用日志

### Fixes

- 分享打包图片三连修：解析覆盖（title/`<img>`/%20/wiki|300）、中文正文 panic（str 字节索引切片遇多字节 UTF-8）、路径逃逸（`../assets` 未归一化）
- macOS PDF 导出：headless_chrome（主）+ WKWebView createPDF（回退）双路径实测通过
- 文件夹弹窗取消不再丢失已生成大纲；MSI 下 SDK 检测恒失败修复（NODE_PATH 统一）

## [0.3.0] - 2026-07-18

### Features — 论文导读 + DOCX 导出重做 + 引导模式

- **论文导读（Paper Reader）**：从 arXiv URL / PDF 一键导入学术论文（后端 MinerU 解析 + arXiv 抓取），在专属 tab 中阅读并给出 AI 导读（背景 / 方法 / 结果），可对导读条目点赞 / 点踩
  - 导读 sidebar 合并到主应用左侧 TOC panel，与主应用渲染后处理统一
  - 论文阅读与课程模式可并行切换（AppWorkspace 状态机 Normal / Course / Paper 注册表 + TransitionRules）
- **DOCX 导出全面修复**
  - Mermaid 渲染尺寸修复（之前 SVG 只占图片 1/9）；字号分层（序列图 22/20，流程图节点 12/边 11）；flowchart 间距 12/12 → 30/35；`flowchart.htmlLabels:false` 让 class / state / er 输出原生 SVG text（修复文字丢失）；新增 foreignObject → SVG text 兜底转换器
  - 数学公式 OMML：修复 Word 丢弃公式的三层嵌套 off-by-one；`\sqrt` 补 `<m:deg/>` + `degHide` 消除根号上方空参数虚线框；新增 37 个回归测试
- **工具栏自定义 tooltip**：每个工具栏按钮可独立配置提示文案
- **首次启动引导模式**：新用户首次启动时进入引导流程，降低学习曲线
- **Demo 资源打包**：`samples/full.md` 随安装包发布，前端可通过新 `get_demo_file` Tauri 命令读取作为引导示例

### Fixes

- 修复 `generate_chapter_quiz` 强制 Windows 路径分隔符 `replace('/', "\\")` 导致 macOS / Linux 路径损坏
- 修复学习模式滑动窗口入口多处重复入口（统一为单一入口）
- 修复 `project.json` 并发写入竞态
- 修复课程生成期间用户关闭 tab 导致状态机卡死的关闭保护
- 修复 macOS-13 runner 已退役导致的 CI 必然失败；universal dmg 步骤补 `rustup target add x86_64-apple-darwin`

### Refactor

- **AppWorkspace 状态机**：Normal / Course / Paper 注册表 + TransitionRules；切换确认弹窗结构化（当前 → 目标彩色徽标 + impact 文案）
- Course 模式从 body class 迁移到 workspace context，body class 仅作 CSS 开关
- Paper Reader 从 `#paper-reader-wrapper` 覆盖层改为 tab 增强模型
- 工作区色板：常规灰 / 课程紫 #8b5cf6 / 论文橙 #f97316 + 工具栏渐变
- `resolveRecentFileRoute` 提取为可测纯函数

### Infrastructure

- `docx-export` crate 纳入版本库（`src-tauri/crates/docx-export/`）
- GitHub Actions 构建矩阵扩展：`fail-fast: false`；Intel macOS runner 由 macos-13 升级到 macos-15-intel；预编译 tauri-cli 安装（taiki-e/install-action）
- Sprint 10 测试套件：4 套 BDD feature（pb1~pb4 paper reader）+ AppWorkspace 单元测试
- 新增 SVG 栅格化依赖：`resvg` / `usvg` / `fontdb` / `tiny-skia`
- `.gitignore` 增加 `.cargo-home` 与临时测试文件

## [0.2.1] - 2026-06-27

### Features — 复习系统最终验收

- **项目级复习入口**：复习入口从章节 sidebar 移到项目知识图谱 Dashboard action 区，与苏格拉底同为全局学习入口
- **手动触发 + loading 过渡**：取消进入项目时的自动弹窗；点击"🧠 今日复习"后关闭 Dashboard 并显示全屏 loading，卡片生成完成后再显示复习弹窗
- **按需批量生成**：只生成今天到期且缺失 cards 的 concepts，通过一次 agent 调用（`review-gen-batch`）完成
- **复习卡片 Agent 读取**：生成复习卡片时不再把章节内容直接拼进 prompt，改由 agent 使用 Read 工具读取章节文件

### Fixes

- 修复删除旧 review card 后仍显示占位内容的问题
- 修复 `review-gen` / `review-gen-batch` stdout 被 `progress_log` 事件行污染导致 Rust 解析失败并 fallback 为占位 stub 的问题
- 修复前端 `checkAndShowDailyReview` 并发触发导致后台多次调用 agent 的问题
- 修复 `now_local_string()` 实际返回 UTC 的时区 bug，统一使用本地时间判断复习到期（兼容旧 UTC schedule 数据）
- 修复手动打开知识图谱 Dashboard 时"今日复习"按钮无反应的问题

### Infrastructure

- 添加 `chrono` 依赖用于本地时间处理
- 更新 `docs/review-flow.mmd` 流程图

## [0.2.0] - 2026-06-04

### Features — AI 学习设计师（3 个 Sprint）

- **Sprint 1: 学习项目创建与大纲生成**
  - 前端新建学习项目对话框（目标 / 难度 / 时长）
  - Agent SDK 桥接 — `plan` stage 自动生成课程大纲
  - Rust 子进程管理 Node.js Agent SDK，stdout JSON 行通信
  - 大纲实时展示与章节导航

- **Sprint 2: 学习模式状态机与进度追踪**
  - 六状态状态机（hidden → generating → active → reviewing → completed → error）
  - `ChapterStatusManager` + `ProgressUI` + `AgentEventBridge`
  - 项目文件夹创建（Windows 路径安全处理）
  - 章节导航、标记完成、生成进度可视化

- **Sprint 3: 学习元素渲染 + AI 解释 + 测验集成**
  - `> [!concept]` / `> [!question]` / `> [!quiz]` 学习元素卡片渲染
  - AI 解释功能：选中文本 → 浮窗工具栏 → AI 生活化类比解释
  - 章末测验系统：预置 `.quiz.json` + 模态框考试 + 本地评分
  - 测验结果持久化（`quiz-history.json` + `project.json` 原子更新）
  - 评级系统：mastered / learning / struggling

### Infrastructure

- `docs/specs/content-format-spec.md` — AI 生成章节的内容格式规范
- 三层测试金字塔：单元测试 + BDD 验收测试（真实文件系统）+ 手动验收
- Worktree 标准做法文档化（`.claude/worktrees/` + junction 链接）

## [0.1.2] - 2026-05-20

### Features

- **划线批注功能（微信读书式）** — 选中文本弹出工具栏，支持高亮/批注/翻译
  - 5 种颜色 + 2 种样式（高亮/下划线）
  - `<mark>` 包裹持久化，重新渲染后自动恢复
  - 批注备注支持修改
- **段落级双语对照翻译**
  - 全文翻译 + 选中文本翻译
  - 翻译结果本地缓存（关闭后再次打开不重新请求 API）
  - 视口内懒加载（先翻译可见区域，滚动时批量翻译）
- **PPT 放映 WikiLink 图片支持** — `![[image.png]]` 语法在幻灯片模式下正常显示

### Fixes

- 批注 `text_hash` 字段前端未传导致反序列化失败
- 跨元素批注持久化（同一段落内有加粗等格式时）
- `setStyle` 缺少 `async` 导致的 JS 语法错误

## [0.1.1] - 2026-05-14

### Features

- **图片加载失败占位提示** — 图片不存在时显示 📄 图标 + 文件名 + "图片不存在"提示，替代浏览器裂图
- **Tab 右键"在文件夹中显示"** — 右键 Tab 直接打开系统文件管理器并定位到源文件
- **Tab 关闭功能增强** — 右键菜单支持关闭自己 / 关闭其他 / 关闭全部
- **Obsidian WikiLink 图片嵌入** — 支持 `![[image.png]]` 语法嵌入本地图片
- **数学预处理** — WebView 预览前提取数学公式，使用 `%%MATH_BLOCK_N%%` 占位符避免被 Markdown 解析器转义，修复矩阵渲染异常
- **PDF 打印优化** — 移除多余提示，保留完整渲染样式
- **非文字内容下载** — 支持图片、Mermaid SVG、表格 CSV 一键下载
- **专注模式（Zen Mode）** — `F11` 切换，隐藏所有 UI 控件，最大化阅读空间
- **窗口状态持久化** — 自动保存窗口位置、大小、最大化状态

### Infrastructure

- 移除未使用的 CLI 模块，项目简化为单一 Tauri 架构
- 更新 CLAUDE.md 文档，补充前端无框架、Release 嵌入验证等关键信息

## [0.1.0] - 2026-05-09

### Features

- **幻灯片放映模式** — 基于 Reveal.js 的完整幻灯片支持
  - `---` 水平翻页、`--` 垂直翻页
  - `<!-- .element: class="fragment" -->` 页内动画
  - KaTeX 数学公式、Prism 代码高亮、Mermaid 图表
  - iframe overlay 方案（绕过 Tauri 多窗口崩溃）
- **YAML Frontmatter 卡片化渲染**
- **最近打开文件列表**
- **任务列表交互** — 点击 checkbox 切换状态并写回文件
- **图片点击放大**（Lightbox）
- **Word 导出**（精美模式）
- **主题系统** — light/dark 切换，localStorage 持久化
- **文件外部修改检测与自动刷新**
- **双击 .md 文件默认打开应用**
- **LLM 配置验证**
- **Mermaid AI 语法修复**
- **拖拽排序**文件树

### Infrastructure

- reveal.js / Prism.js / KaTeX 全本地化，桌面应用离线可用
- Tauri 2.11 + Rust + WebView2
