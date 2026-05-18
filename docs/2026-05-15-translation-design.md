# 翻译功能设计文档

> 日期: 2026-05-15
> 状态: 已确认，待实现
> 优先级: P1（翻译先做，划线后做）

---

## 1. 功能概述与架构

翻译功能基于已有的 `AppConfig` AI 配置（Anthropic/OpenAI），为 Markdown 预览器提供段落级双语对照翻译。用户可通过两种方式触发翻译：

1. **全文翻译** — 工具栏"🌐 翻译"按钮，逐段翻译整篇文档
2. **选中文本翻译** — 鼠标划选文字后弹出浮动工具栏，点击"翻译"仅翻译该段

译文以段落为单位紧跟原文插入，字号与原文一致，通过灰色字体（`--color-text-secondary`）和 8px 上边距与原文区分。

后端复用 `fix_mermaid` 的 API 调用基础设施：新建 `translate_text` Tauri Command，接收文本数组和目标语言参数，批量返回译文数组（减少 API 调用次数）。前端负责：
- 段落识别（扫描 `<p>`, `<li>`, `<h1-h6>` 等文本元素）
- 译文 DOM 插入（在原文元素后插入同级元素，如 `<p>` 后插入 `<p class="translation">`）
- 交互状态管理（翻译中/已完成/失败的状态指示）

技术约束：
- 不修改 Markdown 源文件
- 译文仅存在于渲染后的 DOM 中，重新渲染 Markdown 后需重新翻译
- 翻译失败时保留原文，不中断阅读体验

---

## 2. 后端 API 设计

### 2.1 Tauri Command

```rust
#[tauri::command]
async fn translate_text(
    texts: Vec<String>,      // 待翻译文本数组（批量）
    target_lang: String,     // 目标语言，如 "zh-CN"
    app: tauri::AppHandle,
) -> Result<Vec<String>, String>
```

### 2.2 批量翻译策略

将多个段落合并为一次 API 请求，prompt 格式为：

```
请将以下文本翻译成 {target_lang}，保持 Markdown 格式和代码块不变。
按顺序逐条返回，每条用 ---TRANSLATION--- 分隔。

文本 1:
{text1}

文本 2:
{text2}
...
```

返回后按分隔符 `---TRANSLATION---` 拆分译文数组。

### 2.3 复用配置

复用现有 `AppConfig` 的全部字段（`api_key`、`ai_provider`、`ai_base_url`、`model`），调用逻辑与 `fix_mermaid` 完全一致：
- Anthropic: `x-api-key` + `anthropic-version: 2023-06-01`
- OpenAI: `Authorization: Bearer {api_key}`

### 2.4 错误处理

- API Key 未配置 → 返回 `"未设置 API Key，请在设置中配置"`
- 响应解析失败 → 逐条 fallback 为原文（不中断阅读）
- 网络超时 → 重试一次，仍失败则返回错误

---

## 3. 前端段落识别与双语渲染

### 3.1 段落识别

Markdown 渲染完成后扫描 DOM，识别需要翻译的文本元素：

**目标元素**：`<p>`、`<li>`、`<h1>` ~ `<h6>`、`<blockquote>` 中的文本

**排除元素**：
- `<pre>`（代码块）
- `.katex`（数学公式）
- `.mermaid`（图表）
- 行内 `<code>`（行内代码不翻译）

扫描逻辑：
```javascript
const elements = previewContainer.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote');
const texts = [];
elements.forEach(el => {
  if (el.querySelector('pre, .katex, .mermaid')) return;  // 跳过包含排除元素的节点
  if (el.closest('.translation')) return;  // 跳过已有的译文
  const text = el.textContent.trim();
  if (text) texts.push(text);
});
```

### 3.2 译文插入

在原文元素后插入同级译文元素，保持标签类型一致：

```html
<!-- 原文 -->
<p>Hello world</p>
<!-- 译文 -->
<p class="translation" style="color: var(--color-text-secondary); margin-top: 8px;">
  你好世界
</p>
```

`class="translation"` 用于后续"清除译文"或"重新翻译"时快速定位移除。

---

## 4. 交互设计

### 4.1 全文翻译

工具栏新增"🌐 翻译"按钮：

1. 点击后按钮变为"翻译中..."（禁用状态）
2. 前端扫描 DOM 收集文本数组
3. 调用 `translate_text`（分批处理，每批最多 20 段防 token 超限）
4. 收到译文后逐段插入 DOM
5. 按钮变为"✓ 已翻译"，再次点击可"清除译文"（移除所有 `.translation` 元素）

### 4.2 选中文本翻译

监听 `mouseup` 事件：

1. 如果选区非空且位于可翻译元素内，在选区附近弹出浮动工具栏（"翻译"按钮）
2. 点击后仅翻译该选区所在段落（单条调用 `translate_text`）
3. 译文插入在该段落原文之后

### 4.3 状态指示

- 翻译过程中：正在翻译的段落原文右侧显示旋转小图标
- 翻译失败：段落末尾显示"⚠️ 翻译失败"（灰色小字），不影响其他段落

---

## 5. 数据流

```
用户点击"翻译"按钮
  ↓
前端扫描 DOM → 收集 texts[]
  ↓
调用 Tauri Command: translate_text(texts, target_lang)
  ↓
Rust 后端读取 AppConfig → 调用 AI API
  ↓
AI 返回批量译文
  ↓
Rust 拆分译文数组 → 返回 Vec<String>
  ↓
前端逐段插入译文 DOM
```

---

## 6. 待优化项

- [ ] Prompt 调优：当前基础 prompt，后续根据翻译质量调整
- [ ] Token 限制：长文档分批策略（当前每批 20 段）
- [ ] 缓存：翻译结果本地缓存，避免重复翻译
- [ ] 语言检测：自动检测源语言，或允许用户手动选择目标语言
