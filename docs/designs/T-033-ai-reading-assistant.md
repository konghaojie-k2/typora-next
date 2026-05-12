# T-033 AI 阅读助手（PageIndex）功能设计

## 1. 设计目标

解决长文档阅读的"找不着"问题：用户面对数万字文档，想知道"这段内容在哪里"、"作者对 X 的观点是什么"。

不解决通用问答（那是 ChatGPT 的事）。

## 2. 核心思路：PageIndex

**不用 RAG**。Markdown 天然有标题层级，直接按标题建成导航树：

```
Document
├── 1. 引言 (offset: 0 - 1200)
│   └── 1.1 背景 (offset: 300 - 1200)
├── 2. 核心设计 (offset: 1200 - 4500)
│   ├── 2.1 架构图 (offset: 1200 - 2000)
│   └── 2.2 数据流 (offset: 2000 - 4500)
└── 3. 总结 (offset: 4500 - 5000)
```

每个节点存储：
- `id`: heading 锚点
- `level`: h1-h6
- `title`: 标题文本
- `summary`: 该 section 的纯文本摘要（前 300 字）
- `range`: [offsetTop, nextHeadingOffsetTop)
- `children`: 子节点数组

**为什么不用 RAG**：
- Markdown 有天然边界（标题），不需要 chunking
- 标题语义本身就是最佳索引
- 树结构可以"一鱼三吃"：AI 索引 + TOC 导航 + 结构可视化

## 3. UI 设计

### 3.1 布局

右侧新增一个可折叠的 **AI 面板**，与左侧 sidebar 对称：

```
+------------------+-------------------+------------------+
|   Left Sidebar   |   Content Area    |   AI Panel       |
|   (文件/目录)     |   (Markdown)      |   (问答/导航)     |
|   250px          |   flex: 1         |   300px          |
+------------------+-------------------+------------------+
```

- AI 面板默认**折叠**（不占空间），点击工具栏按钮或快捷键 `Ctrl+Shift+A` 展开
- 展开后 Content Area 自动收缩
- 面板状态持久化到 `config.ai_panel_collapsed`

### 3.2 面板内部结构

```
┌─ AI 阅读助手 ──────────────┐
│                           │
│  [历史记录 ▼]              │
│  ┌─────────────────────┐  │
│  │ 用户：什么是PageIndex？│  │
│  │ AI：PageIndex 是一种... │  │
│  │   [定位到原文]          │  │
│  └─────────────────────┘  │
│                           │
│  ┌─────────────────────┐  │
│  │ 用户：数据流怎么设计的？│  │
│  │ AI：根据"2.2 数据流"...  │  │
│  │   [定位到原文]          │  │
│  └─────────────────────┘  │
│                           │
│  [输入问题...        ] [➤]│
└───────────────────────────┘
```

### 3.3 交互细节

| 动作 | 行为 |
|------|------|
| 用户输入问题 | 发送按钮激活，Enter 发送 |
| AI 回答中引用原文 | 显示 `[定位到原文]` 按钮 |
| 点击 `[定位到原文]` | Content Area 滚动到对应 heading，高亮闪烁 |
| AI 导航过程中 | 显示"正在分析文档结构..." → "正在阅读相关章节..." |
| 历史记录 | 当前文档会话级，不跨文档持久化 |

## 4. LLM 交互流程（两轮推理）

### Round 1: 导航（Navigation）

**输入**：PageIndex 树（只传 title + summary，不传全文）

```json
{
  "document_title": "xxx",
  "tree": [
    {"id": "heading-0", "level": 1, "title": "引言", "summary": "本文介绍..."},
    {"id": "heading-3", "level": 1, "title": "核心设计", "summary": "系统采用分层架构...",
     "children": [
       {"id": "heading-4", "level": 2, "title": "架构图", "summary": "如图1所示..."}
     ]}
  ],
  "question": "数据流是怎么设计的？"
}
```

**LLM 输出**：
```json
{
  "relevant_nodes": ["heading-4", "heading-7"],
  "reasoning": "用户问数据流设计，'2.2 数据流'章节最相关，同时'3.1 性能优化'也涉及数据流..."
}
```

### Round 2: 回答（Answer）

**输入**：选中节点的完整文本内容 + 用户问题

```json
{
  "context": "## 2.2 数据流\n\n系统采用生产者-消费者模式...",
  "question": "数据流是怎么设计的？"
}
```

**LLM 输出**：
```json
{
  "answer": "数据流采用生产者-消费者模式设计...",
  "sources": [{"node_id": "heading-4", "quote": "系统采用生产者-消费者模式"}]
}
```

### 为什么分两轮？

- 长文档可能 >100k tokens，直接塞全文超上下文窗口
- 先让 LLM"看目录"定位，再"精读"相关章节，模拟人读长文档的方式
- 树结构很小（通常 <2k tokens），第一轮几乎不消耗成本

## 5. 技术实现

### 5.1 新增文件/模块

```
dist/
├── scripts/
│   └── ai-assistant.js      # AI 面板逻辑 + LLM 交互
├── styles/
│   └── ai-assistant.css     # AI 面板样式
└── index.html               # 新增 AI 面板 DOM
```

### 5.2 修改文件

- `main.js`: 
  - 引入 `ai-assistant.js`
  - `renderMarkdown()` 后调用 `buildPageIndex()`
  - 新增 `pageIndex` state
- `index.html`: 新增 AI 面板 DOM
- `main.css`: 新增 AI 面板样式

### 5.3 PageIndex 构建算法

```javascript
function buildPageIndex() {
  const headings = state.headings; // 复用 buildTOC 的数据
  const root = { children: [] };
  const stack = [root];

  headings.forEach((h, i) => {
    const node = {
      id: h.id,
      level: h.level,
      title: h.text,
      summary: extractSummary(h.element, headings[i + 1]?.element),
      range: [h.element.offsetTop, headings[i + 1]?.element.offsetTop || Infinity],
      children: []
    };

    // 维护层级栈
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });

  state.pageIndex = root.children;
}

function extractSummary(fromEl, toEl) {
  // 提取 fromEl 和 toEl 之间的纯文本，截取前 300 字
}
```

### 5.4 LLM API 调用

前端通过 `fetch()` 直接调用 LLM API（不经过 Rust）：
- API key 从 `config.api_key` 读取
- 支持 OpenAI / OpenRouter / 自定义 base_url
- 模型从 `config.model` 读取

**理由**：
- 前端有完整的配置信息
- 减少一次 IPC 往返
- Tauri 的 CSP 允许 fetch 到外部 API

```javascript
async function callLLM(messages, options = {}) {
  const config = await getConfig();
  const response = await fetch(config.ai_base_url || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.api_key}`
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini',
      messages,
      temperature: 0.3,
      ...options
    })
  });
  return response.json();
}
```

### 5.5 Prompt 模板

**Navigation Prompt**:
```
你是一位文档导航助手。用户有一个问题，你需要判断文档的哪些章节可能包含答案。

文档结构如下（JSON）：
{{tree_json}}

用户问题：{{question}}

请输出 JSON：{"relevant_nodes": ["node_id1", ...], "reasoning": "..."}
只输出 JSON，不要其他内容。
```

**Answer Prompt**:
```
基于以下文档内容回答用户问题。如果内容中没有答案，明确说明。

---
{{context}}
---

用户问题：{{question}}

请输出 JSON：{"answer": "...", "sources": [{"node_id": "...", "quote": "..."}]}
只输出 JSON，不要其他内容。
```

## 6. 与现有功能的联动

| 功能 | 联动方式 |
|------|----------|
| **TOC 树形模式** | PageIndex 树可直接用于 TOC 的树形折叠渲染（一鱼三吃） |
| **Zen Mode** | AI 面板在 Zen Mode 下自动折叠 |
| **主题系统** | AI 面板样式跟随主题变量 |
| **幻灯片模式** | AI 助手在幻灯片模式下禁用（单页无长文） |

## 7. 待决策事项

1. **模型选择**：默认用 `gpt-4o-mini` 还是 `claude-3-haiku`？（成本 vs 效果）
2. **Summary 生成**：用纯文本截取前 300 字，还是用 LLM 生成更精炼的摘要？
3. **历史持久化**：当前文档的历史记录是否跨会话保存？
4. **流式输出**：AI 回答是否用 SSE 流式输出？
5. **右侧面板宽度**：固定 300px 还是可拖拽调整？

## 8. 实现优先级

| 阶段 | 内容 | 估算 |
|------|------|------|
| Phase 1 | PageIndex 构建 + 右侧 AI 面板 UI | 2h |
| Phase 2 | LLM 两轮交互（Navigation + Answer） | 2h |
| Phase 3 | 定位到原文 + 高亮 + 流式输出 | 1.5h |
| Phase 4 | Prompt 调优 + 错误处理 | 1h |
