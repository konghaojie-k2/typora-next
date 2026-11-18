# 内联 SVG 插图规范（inline-svg-spec v1.0）

> 课程章节内的静态 SVG 插图规范。改编自对话内嵌可视化 skill（inline-visualizer），
> 去掉对话工具机制（`read_me` / `show_widget`、流式渲染顺序、IDE 主题跟随），
> 换成**直接写进章节 Markdown** 的 `<svg>…</svg>` HTML 块。
>
> 渲染链路（为什么规则长这样）：
> - **预览**：Markdown 渲染器原样透传块级 HTML → SVG 直接显示；
> - **Word 导出**：内联 SVG 块自动转成图片（usvg/resvg 渲染 PNG）——usvg 不解析
>   `<style>` 块、class、CSS 变量，所以本规范强制全 inline 属性 + 写死浅色配色；
> - **暗色主题**：应用有明暗两套主题，但 SVG 配色不跟随——每张图自带浅色底卡，
>   像一张"贴进页面的图版"，两种主题下观感一致且导出不翻车。

## 0. 何时画 SVG，何时用 mermaid / 表格

SVG 和 mermaid 分工不同，**不要用 SVG 重复 mermaid 的活**：

| 要表达的内容 | 用什么 |
|---|---|
| 流程 / 因果链 / 交互时序 / 时间演变 / 分类谱系 | mermaid（`flowchart` / `sequenceDiagram` / `timeline` / `mindmap`） |
| 多维对比 | markdown 表格 |
| **设备 / 器物的结构与剖面** | **SVG** |
| **空间布局 / 地理路线 / 场景重构** | **SVG** |
| **机理示意（粒子迁移、力的分解、光影方向）** | **SVG** |
| **作品构图分析 / 视觉引导** | **SVG** |
| **数量级对比图（柱状 / 折线）** | **SVG**（纯手绘，见配方 B） |

判断口诀：mermaid 画**关系**，SVG 画**实物感和空间感**。一张好的 SVG 插图应该
是"文字怎么写都写不清、mermaid 怎么连都连不像"的那种图。

## 1. 插入位置与 Markdown 语法（硬性）

- SVG 块是**块级 HTML**：`<svg` 必须**顶格**（行首无缩进），前后各留一个空行；
  **不要**包进列表、引用、callout 或代码围栏里——包进去就不渲染了。
- 每张图前用一两句正文引入（"下面这张图是……"），图后正文接着展开——
  **解释写在 Markdown 正文里，图内只放标签短语**，不要把段落塞进 SVG。
- 每章 1~2 张，放在最能提升理解的位置（通常紧跟"核心直觉"或实例段之后）。
  一张图控制在 ~80 行以内；复杂主题宁可两张小图也不堆一张巨图。

## 2. 画布与结构骨架

```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 H" width="100%" role="img">
  <title>一句话图名</title>
  <desc>一两句给读屏/快速扫读的图意说明</desc>
  <!-- ① 底卡：整幅画布的浅色底，永远第一个画 -->
  <rect x="0" y="0" width="680" height="H" rx="12" fill="#F7F5F0"/>
  <!-- ② <defs>（箭头 marker，见配方 A） -->
  <!-- ③ 视觉元素，后画的盖住先画的 -->
</svg>
```

- **`680` 不能改**：所有坐标以 `viewBox="0 0 680 H"` 为准；`width="100%"` 让图
  自适应内容栏宽度。
- `H` = 最底部元素 y + 20~30，不要拍脑袋；画完记得回填。
- 安全区：内容放在 x 40–640、y 40–(H−30)；`<title>` / `<desc>` 必须是最先的子元素。
- `xmlns` 必须带（Word 导出解析需要）。

## 3. 硬约束（违反 = 预览/导出异常）

**兼容性禁用**（usvg 不认或渲染出错）：
- ❌ `<style>` 块、`class="…"`、CSS 变量 `var(…)` —— **每个形状 inline 写
  `fill` / `stroke`**，颜色写死（见 §4 配色）
- ❌ `<script>`、交互、CDN —— 课程图是静态的
- ❌ 渐变 `<linearGradient>` / `<radialGradient>`、滤镜、阴影、模糊、发光
  —— 深度靠**不透明色块分层**堆出来
- ❌ marker 里用 `stroke="context-stroke"` —— marker 的 stroke 写**具体色值**（见配方 A）
- ❌ `<text>` 之外的文字方案不需要；但**旋转文字**不要用
- ❌ emoji —— 用形状或 path 画
- ❌ `<!DOCTYPE>` / `<html>` / `<head>` / `<body>`、`position: fixed`

**排版**：
- 字号 ≥ 11px；标题 14px、正文 13px、次要 12px；**字重只用 400 / 500**
- 一律 sentence case，禁止全大写
- 文字一律用 `<text>` 的 `fill` 指定颜色，不依赖默认继承

## 4. 调色板（写死这些色值）

9 个色阶 × 7 级（50 最浅 → 900 最深）：

| 色阶 | 50 | 100 | 200 | 400 | 600 | 800 | 900 |
|------|----|-----|-----|-----|-----|-----|-----|
| c-purple | #EEEDFE | #CECBF6 | #AFA9EC | #7F77DD | #534AB7 | #3C3489 | #26215C |
| c-teal | #E1F5EE | #9FE1CB | #5DCAA5 | #1D9E75 | #0F6E56 | #085041 | #04342C |
| c-coral | #FAECE7 | #F5C4B3 | #F0997B | #D85A30 | #993C1D | #712B13 | #4A1B0C |
| c-pink | #FBEAF0 | #F4C0D1 | #ED93B1 | #D4537E | #993556 | #72243E | #4B1528 |
| c-gray | #F1EFE8 | #D3D1C7 | #B4B2A9 | #888780 | #5F5E5A | #444441 | #2C2C2A |
| c-blue | #E6F1FB | #B5D4F4 | #85B7EB | #378ADD | #185FA5 | #0C447C | #042C53 |
| c-green | #EAF3DE | #C0DD97 | #97C459 | #639922 | #3B6D11 | #27500A | #173404 |
| c-amber | #FAEEDA | #FAC775 | #EF9F27 | #BA7517 | #854F0B | #633806 | #412402 |
| c-red | #FCEBEB | #F7C1C1 | #F09595 | #E24B4A | #A32D2D | #791F1F | #501313 |

**课程图用色公式**（浅色底卡版）：
- 底卡：c-gray-50 `#F1EFE8`（或该图主色阶的 50）
- 主体填充：100 / 200 级；描边：600 级
- 标题文字：800；正文 / 标签：500~600（中性标签用 c-gray-600）
- 每张图 ≤ 2 个色阶大类（+ 中性灰不算）；冲突/警示才引入 c-red
- 类比思维：同一课程的多张图沿用同一主色阶，保持课程视觉连贯

**复杂度预算**：单个盒子副标题 ≤ 5 词；满宽一层 ≤ 4 个盒子（每个约 140px）。

## 5. 文字宽度校准与盒宽公式

| 用途 | 字数 | 字号 | 渲染宽度 |
|------|------|------|---------|
| 标题 | 12 字 | 14px | ~88px |
| 副标题 | 16 字 | 13px | ~104px |
| 正文 | 24 字 | 13px | ~156px |
| 说明 | 20 字 | 12px | ~120px |

- 盒宽公式：`rect_width = max(标题字数 × 7, 副标题字数 × 6) + 24`
- 中文按"1 字 ≈ 1 字号宽度"估；英文/数字减半
- 文字居中：`text-anchor="middle"`，`x` 取盒中心；多行用多个 `<text>`（行距 = 字号 × 1.6）

## 6. 配方 A · Diagram（结构 / 剖面 / 流向 / 对比布局）

- 图表类描边统一 `0.5px`~`1.5px`；连接线 `<path>` / `<polyline>` 必须 `fill="none"`
- `<defs>` 里放箭头 marker（**stroke 写具体色值，不要 context-stroke**）：

```svg
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5"
    markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M2 1L8 5L2 9" fill="none" stroke="#5F5E5A"
      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </marker>
</defs>
```

- 用法：`<path d="…" fill="none" stroke="#5F5E5A" marker-end="url(#arrow)"/>`
- 虚线引出线：`stroke-dasharray="4 3"`；剖面剖切线：长虚线 + 两端短粗线
- **标注真实参数**是 engineering 图的灵魂：在部件旁放 `12px` 的 c-gray-600 标签
  （如 "4.1~4.3 V"、"0.8 A/cm²"），标签用细引出线连到部件上

## 6.1 可交互分组（可选，让剖面图/机理图可逐段讲解）

应用会为带 `data-part` 分组的插图自动加「hover 高亮 + 图例 + 上一步/下一步/播放」，
无需在图里写脚本。需要逐步讲解的图（机理、流程、剖面层次）请按此分组：

```svg
<g data-part="melt" data-label="硅熔体" data-order="3">
  <!-- 该部件的全部形状与标签 -->
</g>
```

- `data-part`：本章内唯一短 id（英文/数字/连字符），不要重复
- `data-label`：图例与步骤条显示的中文短语，≤ 8 字；省略时回退为 `data-part`
- `data-order`：从 1 开始的讲解顺序；省略时按文档顺序
- **只包逻辑部件**：底卡、`<title>`/`<desc>`、坐标轴、装饰线不要包进任何 part
- `<g>` 只做容器，不改变视觉层级；分组后整图仍需「不分步也看得懂」
- 仍禁止 `class` / `<style>` / 脚本 / `on*` / 渐变 —— `data-*` 属性不受此限制，
  导出 Word 时 resvg 会忽略这些属性

## 7. 配方 B · Chart（纯 SVG 柱状 / 折线）

禁用 Chart.js / 任何 CDN / 脚本 —— 用原始 SVG 手绘：

- **柱状图**：先定坐标轴基线 y（如 400），每根柱 `<rect>` 底边对齐基线，
  高度按 `value / max_value × 可用高度` 算；柱色用主色阶 400，最高柱可用 600 强调
- **折线图**：`<polyline fill="none" stroke-width="2">` + 每个数据点
  `<circle r="3">`；y 轴刻度 3~5 条横参考线（c-gray-200 虚线）+ 12px 刻度标签
- 轴线/刻度用 c-gray-400 `#888780`；数值标签 12px c-gray-600
- 柱间留白 ≥ 柱宽的一半；类别标签放基线下方 y+18

## 8. 配方 C · Art（场景插画 / 空间重构）

- 与 diagram 的区别：鼓励填满画布、用有机曲线（`<path>` 曲线 / `<ellipse>` /
  `<circle>`）、色彩可以混 2~3 个色阶大类
- **纹理用重复**（平行线、点阵、排线），不用滤镜；径向对称用
  `<g transform="rotate(a cx cy)">` 复制
- **z-order 规划**（后画的盖住先画的）：天空/背景 → 中景 → 主体 → 前景剪影。
  艺术焦点优先于物理遮挡：让视觉主角压在装饰元素之上
- **圆形构图**（用 `clipPath` 裁进圆里时，边缘元素坐标必须反算，否则被裁掉）：

  ```
  给定圆心 (cx, cy) 半径 r，高度 y 处的可见半宽：
  dx = sqrt(r² − (y − cy)²)，可见 x 范围 [cx − dx, cx + dx]
  ```
  没有计算器就**不用圆形裁切**——矩形画布同样能出好图；多层构图时
  底部窄、顶部宽，垂直方向分层核算。

## 9. 学科配方（按 course_type 取用）

### engineering（真实工业 / 过程工程）

mermaid 承担流程与结构层级，SVG 承担"看得见摸得着"的部分：

- **设备/槽型剖面**：电解槽（阳极/阴极/熔体/保温层分层上色）、刻蚀腔体
  （等离子体区/气体入口/晶圆）、精馏塔（塔板/进料/采出）——剖面 + 部件标注 +
  真实参数标签（§6）
- **机理微观示意**：离子迁移路径（带箭头的小圆点群）、晶格缺陷、钝化层生长
- **产线/厂区布局**：俯视示意 + 物料流向箭头
- **能耗/产能对比**：配方 B 柱状图（吨铝电耗、良率、纯度）

### humanities（人文社科）

- **历史场景重构**：宫廷/市集/战场的分层插画（配方 C）；人物用剪影，不画五官
- **建筑与空间**：教堂平面、剧场座席与视线、园林步移景异、城市格局——
  平面图 + 参观/使用动线箭头
- **作品构图分析**：画框 + 构图线（三分线/对角线）+ 视线引导箭头 + 色块分区
- **地理与路线**：简化地图（色块陆地 + 曲线河流）+ 贸易/巡游/迁徙路线
- **器物结构**：乐器构造、机械钟表、印刷机——爆炸图或剖面（同 §6）

### technical / hybrid

- technical 不强制 SVG：mermaid + 代码已够用；概念确实需要"实物感"示意时
  （如网络分层、缓存层级）按本规范加一张，同章 ≤ 1 张
- hybrid 按小节属性取用：工程小节按 engineering 配方，人文小节按 humanities 配方

## 10. 最小可用示例（可直接模仿的骨架）

```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 300" width="100%" role="img">
  <title>预焙阳极电解槽剖面示意</title>
  <desc>电解槽剖面：阳极、冰晶石熔体、阴极与铝液层，标注槽电压与电流密度</desc>
  <rect x="0" y="0" width="680" height="300" rx="12" fill="#F1EFE8"/>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="#5F5E5A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>
  <!-- 槽体 -->
  <rect x="140" y="80" width="400" height="160" fill="#D3D1C7" stroke="#888780" stroke-width="1.5"/>
  <!-- 熔体层 -->
  <rect x="150" y="100" width="380" height="80" fill="#FAEEDA" stroke="#BA7517" stroke-width="1"/>
  <!-- 阳极（浸入熔体） -->
  <rect x="230" y="60" width="40" height="70" fill="#B4B2A9" stroke="#5F5E5A" stroke-width="1"/>
  <rect x="380" y="60" width="40" height="70" fill="#B4B2A9" stroke="#5F5E5A" stroke-width="1"/>
  <!-- 阴极与铝液层 -->
  <rect x="150" y="180" width="380" height="50" fill="#B5D4F4" stroke="#185FA5" stroke-width="1"/>
  <!-- 标注 -->
  <text x="340" y="50" text-anchor="middle" font-size="14" font-weight="500" fill="#444441">预焙阳极电解槽（剖面）</text>
  <text x="340" y="145" text-anchor="middle" font-size="12" fill="#854F0B">冰晶石熔体 · 约 960 ℃</text>
  <text x="340" y="212" text-anchor="middle" font-size="12" fill="#0C447C">阴极铝液层</text>
  <path d="M620 95 L610 80" fill="none" stroke="#5F5E5A" stroke-width="1" marker-end="url(#arrow)"/>
  <text x="540" y="70" font-size="12" fill="#5F5E5A">槽电压 4.1~4.3 V</text>
</svg>
```

## 11. 常见错误

| 现象 | 原因 | 修法 |
|------|------|------|
| 图根本不显示 / 显示成代码 | SVG 没顶格，或被包进列表/引用/围栏 | 行首无缩进 + 前后空行、裸放 |
| 导出 Word 后空白/黑块 | 用了 `<style>` / class / `var()` / `context-stroke` | 全 inline 属性 + 写死色值 |
| 暗色主题下看不清 | 底卡透明或没画底卡 | 第一层画满幅浅色底卡 |
| 图形被裁掉一角 | 圆形/异形 clip 下坐标没反算 | 按 §8 公式核算，或放弃圆形裁切 |
| 文字溢出盒子 | 没按字宽估算盒宽 | 按 §5 公式反推 |
| 颜色全黑 | 形状没写 inline `fill` | 每个形状显式写 fill/stroke |
| 箭头不显示 | 线没 `fill="none"` 或 marker stroke 用了 context-stroke | 补 `fill="none"` + marker 写具体色 |
| 文字被截断 / 画布留白过大 | H 拍脑袋 | H = 最底部元素 y + 20~30 |
| 图里塞大段文字 | 把解释写进了 SVG | 解释放 Markdown 正文，图内只放标签 |

## 版本历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-09-06 | v1.0 | 首版：改编自对话内嵌可视化 skill——去工具机制与流式约束，新增浅色底卡、usvg 兼容硬约束、纯 SVG 图表配方、engineering/humanities 学科配方 |
| 2026-11-18 | v1.1 | 新增 §6.1 可交互分组：`<g data-part/data-label/data-order>` 约定，支持 hover 高亮与逐段演示 |
