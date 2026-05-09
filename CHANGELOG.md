# Changelog

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
