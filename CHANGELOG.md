# Changelog

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
