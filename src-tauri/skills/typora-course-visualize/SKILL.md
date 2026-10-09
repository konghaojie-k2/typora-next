---
name: typora-course-visualize
description: 为课程概念配图讲解——先检索 Wikimedia Commons 真实图片，未命中再按规范手绘 SVG 示意图。Use when the host prompts "请使用 typora-course-visualize skill". First turn picks or draws one figure for the selected concept; subsequent turns revise it on request.
---

# Course Visualize（画个图）

学生对某个概念「看不明白」，需要一张图。你的任务是给出**一张能解释清楚的图**加简短图说——不是长篇讲解，图是主角。

## When invoked

Host prompt shape（首轮）:

```
请使用 typora-course-visualize skill 为学生选中的概念配图讲解。
选中概念: "硅的 (111) 面"
章节上下文: {"chapterTitle":"...","chapterGoal":"...","surroundingText":"..."}
```

`章节上下文` 可省略；追问轮 host 只发学生原话（session 续聊，你记得此前的图）——「换个角度画」「把悬键标出来」这类改图要求。

## First turn: 决策流程

### 1. 判断配图价值

空间结构 / 实物剖面 / 机理示意 / 数量级对比 → 适合配图。纯定义、纯公式推导 → 直接说明「这个概念用文字更清楚」并给文字解释，不要硬画。

### 2. 先检索真实图片（优先）

概念是真实物体/结构（晶体、器件、地理、生物、历史照片…）时，**先查 Wikimedia Commons**——真实图片质量远胜手绘。用 wikimedia-commons skill 的白名单脚本：

```bash
node .pi/skills/wikimedia-commons/scripts/wiki-fetch.mjs "<https-url>"
```

（项目里不存在该路径则试 `.claude/skills/` 前缀；这把 bash 只放行 wiki-fetch.mjs，其它命令会被拒绝。脚本输出一行 JSON：`{"ok":true,"status":200,"body":"..."}`，响应截断 32KB——用 limit 参数控制结果数。）

三步：

1. **搜索 File 命名空间**（`gsrnamespace=6` 必须）：
   ```
   https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=<关键词>
   ```
   关键词用**英文术语**效果最好（`Silicon 111 surface`、`dangling bonds`），不要只搜中文
2. **过滤图片取直链**：
   ```
   https://commons.wikimedia.org/w/api.php?action=query&format=json&pageids=<id1|id2|...>&prop=videoinfo&viprop=url|mime|size
   ```
   只保留 mime 为 `image/svg+xml`、`image/png`、`image/jpeg` 的文件；直链取 `url`（`upload.wikimedia.org` 开头）
3. **选最贴切的一张**：教学示意图 > 实物照片 > 数据图；标题/描述与概念直接相关者优先

命中 → 输出 markdown 图片 + 署名行：

```
![一句图意](https://upload.wikimedia.org/...)
*图：Wikimedia Commons（公共领域）· 一句图说*
```

### 3. 未命中再手绘 SVG 示意图

检索无结果、结果里没有合适图片、或概念本身是抽象机理（力的分解、能级、数量级对比）→ 手绘 SVG。**检索不要重试超过 1 次**，直接画。

输出格式（硬性）：SVG 必须放在 ` ```svg ` 代码围栏里——气泡渲染器只认这个通道，围栏外直接写 `<svg>` 会显示成一段文本。

规范与课程插图一致（全量规则可 Read chapter-generation skill 的 references/inline-svg-spec.md）：

- `viewBox="0 0 680 H"`，宽度 680 不能改；第一个子元素是浅色底卡 `<rect x="0" y="0" width="680" height="H" rx="12" fill="#F7F5F0"/>`
- **全 inline 属性**：禁 `<style>` 块、`class`、CSS 变量，颜色写死色值
- 禁 `<script>`、`on*` 事件属性、`<foreignObject>`、渐变、滤镜、emoji
- 字号 ≥ 11px，字重只用 400 / 500；图内只放标签短语，解释写在围栏外的 markdown 正文里

### 4. 输出结构

1. 一句「这张图看什么」引入
2. 图（markdown 图片 或 ` ```svg ` 围栏）
3. 两三点「看图要点」——把学生的视线引到最关键处（如「注意 (111) 面上每个表面原子只剩一根悬键」）

## Subsequent turns: 改图

- 「换个角度」「和 (100) 面对比一下」→ 重新走决策流程（可再检索或改 SVG）
- 「把 X 标出来」「字大一点」→ 在上一张 SVG 基础上改，保持底卡与配色一致
- 学生追问概念本身 → 简短回答并把话题拉回图（「图上这一块就是……」）

## Rules

1. **禁止 mermaid**——气泡渲染器不渲染 mermaid，输出 ` ```mermaid ` 围栏只会显示成一段代码文本；流程/关系图也用 SVG 画
2. **禁止 base64 图片**——只用 https URL（upload.wikimedia.org）或 ` ```svg ` 围栏
3. 图是主角：每次回答**至多一张图**，图说合计 ≤ 150 字，不要倾倒多张大图
4. 概念必须讲对——拿不准就用 Read 核对章节原文（`{project_path}/*.md`），不要凭印象画错结构
5. 用 markdown 适度排版，不要用一级标题
6. 正文引用用中文全角引号「」（SVG 属性值例外，按 XML 语法写）

## Failure modes

- 概念不适合配图 → 说明原因 + 文字解释，不硬画
- wiki 检索失败或无合适结果 → 不纠结，直接手绘 SVG
- 学生要的图超出表达能力（精确晶体学三维结构）→ 画示意图并明说「这是示意，不是精确比例」
- SVG 坐标拿不准 → 宁可简化元素，也不要堆叠出错位重叠的图
