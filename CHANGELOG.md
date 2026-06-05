# Changelog

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
