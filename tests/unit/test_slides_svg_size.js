#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for slides-svg-size（幻灯片内联 <svg> 尺寸策略）
 *
 * 背景（2026-11-05 实爆）：PPT 模式 1280×720 装箱，竖版内联 svg
 * （viewBox 高>宽 + width=100%）实测高度远超页高，装箱层无法拆分
 * svg，独占一页且允许溢出 → 播放时下半张被裁掉（展示不全）。
 *
 * 纯 Node 环境（无 DOM）：inlineSvgSizing 走纯逻辑，
 * slides.js 布线走源码级断言（与 test_export_svg_blocks 同款）。
 */

const fs = require('fs');
const path = require('path');
const TestRunner = require('../shared/test-runner');
const SlidesSvgSize = require('../../dist/scripts/slides-svg-size.js');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

const { inlineSvgSizing } = SlidesSvgSize;
const BOX_H = 634; // 1280×720 × (1 - 2×0.06) 取整后的页内容高
const BASE_FS = 16; // 主视图 --font-size-base = 1rem = 16px

// ---------- inlineSvgSizing：有 viewBox ----------

test('竖版 svg（实爆案例 680×804）：剥尺寸属性 + 满宽 + 比例 + 页高封顶', () => {
  const s = inlineSvgSizing(680, 804, BOX_H, BASE_FS);
  assert(s.stripSizeAttrs === true, '必须剥掉 width/height 属性（width=100% 会让量测高度失控）');
  assertEquals(s.styles.width, '100%');
  assertEquals(s.styles.height, 'auto');
  assertEquals(s.styles.aspectRatio, '680 / 804');
  assertEquals(s.styles.maxHeight, BOX_H + 'px');
});

test('横版超宽 svg：同样按页高封顶', () => {
  const s = inlineSvgSizing(1600, 900, BOX_H, BASE_FS);
  assert(s.stripSizeAttrs === true);
  assertEquals(s.styles.aspectRatio, '1600 / 900');
  assertEquals(s.styles.maxHeight, BOX_H + 'px');
});

test('svg 块级化并水平居中（竖版封顶后横向留白居中，而非靠左）', () => {
  const s = inlineSvgSizing(680, 804, BOX_H, BASE_FS);
  assertEquals(s.styles.display, 'block');
  assertEquals(s.styles.margin, '0 auto');
});

test('封顶值必须等于页内容高（装箱层按 offsetHeight 装箱，超出即溢出裁切）', () => {
  const s = inlineSvgSizing(680, 804, BOX_H, BASE_FS);
  assertEquals(parseFloat(s.styles.maxHeight), BOX_H);
});

// ---------- inlineSvgSizing：字号级联切断（挤字实爆 2026-11-05） ----------

test('svg 根部锁定基准字号 16px，切断 .reveal 28px 级联进 svg text', () => {
  const s = inlineSvgSizing(680, 804, BOX_H, BASE_FS);
  assertEquals(s.styles.fontSize, '16px');
});

test('兜底分支同样锁定基准字号', () => {
  const s = inlineSvgSizing(undefined, undefined, BOX_H, BASE_FS);
  assertEquals(s.styles.fontSize, '16px');
});

test('基准字号非法时回退 16px', () => {
  const s = inlineSvgSizing(680, 804, BOX_H, undefined);
  assertEquals(s.styles.fontSize, '16px');
});

// ---------- inlineSvgSizing：无/非法 viewBox ----------

test('无 viewBox svg：走 maxWidth/maxHeight 兜底，不剥属性', () => {
  const s = inlineSvgSizing(undefined, undefined, BOX_H, BASE_FS);
  assert(s.stripSizeAttrs === false, '无比例可用时保留原始尺寸属性');
  assertEquals(s.styles.maxWidth, '100%');
  assertEquals(s.styles.maxHeight, BOX_H + 'px');
});

test('非法 viewBox（0 宽或 0 高）走兜底', () => {
  assert(inlineSvgSizing(0, 804, BOX_H, BASE_FS).stripSizeAttrs === false);
  assert(inlineSvgSizing(680, 0, BOX_H, BASE_FS).stripSizeAttrs === false);
  assert(inlineSvgSizing(NaN, NaN, BOX_H, BASE_FS).stripSizeAttrs === false);
});

// ---------- slides.js / slides.html 布线 ----------

test('slides.js 集成：measureAndPack 在测量前调用 sizeInlineSvgs', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  const packIdx = src.indexOf('sizeInlineSvgs(div)');
  const measureIdx = src.indexOf('var items = measureItems(div)');
  assert(packIdx !== -1, 'measureAndPack 必须调用 sizeInlineSvgs(div)');
  assert(measureIdx !== -1);
  assert(packIdx < measureIdx, 'svg 尺寸约束必须在 measureItems 之前（装箱高度才准确）');
});

test('slides.js 集成：排除 mermaid 与 KaTeX 的 svg', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes("closest('.mermaid')"), 'mermaid svg 有自己的尺寸管线，必须排除');
  assert(src.includes("closest('.katex')"), 'KaTeX 数学符号内嵌 svg，必须排除');
});

test('slides.js 集成：封面 section 也做尺寸约束', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes('sizeInlineSvgs(cov)'), '封面走 innerHTML 直插，不经 measureAndPack，必须单独约束');
});

test('slides.js 集成：图片转换含 parent.__TAURI__ 回退（iframe 可能未注入 API）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes('getConvertFileSrc'), 'convertFileSrc 获取必须收敛到统一函数');
  assert(src.includes('window.parent.__TAURI__'), '必须回退到父窗口的 Tauri API');
  const uses = src.match(/window\.__TAURI__ && window\.__TAURI__\.core && window\.__TAURI__\.core\.convertFileSrc/g);
  assert(!uses, '不允许绕过 getConvertFileSrc 直接取 window.__TAURI__');
});

test('slides.js 集成：续页标题仅预算内注入（超高独占页跳过标题防页底溢出）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes('pageH + (page.continuedH || 0) <= availH'),
    '物化层必须校验 标题高+页内容高 才注入"（续）"标题');
  assert(src.includes('continuedH'), '装箱核心必须记录续页标题高度（镜像 tests/shared/slides-pack-core.js）');
});

test('slides.css 集成：padding 必须覆盖嵌套页面 section（满宽渲染=测量失准，右溢实爆）', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../../dist/styles/slides.css'), 'utf-8');
  assert(css.includes('.reveal .slides > section > section'),
    '页面 section 是嵌套层，padding 选择器必须覆盖 .slides > section > section');
});

test('slides.js 集成：测量容器宽度 = SLIDE_W（与真实页面渲染宽一致）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  const m = src.match(/createMeasureDiv[\s\S]{0,600}?width:'\s*\+\s*(\w+)/);
  assert(m, 'createMeasureDiv 必须显式设宽');
  assertEquals(m[1], 'SLIDE_W', '测量宽必须用 SLIDE_W，不能用 contentBox().width');
});

test('slides.js 集成：图片等待超时放宽到 8s（大截图解码超 1.5s 会让装箱失准）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes('timeoutMs || 8000'), 'waitForImages 默认超时必须 >= 8s');
});

test('slides.js 集成：单个超高 li 可按内部子元素拆分（巨型 fragment li 防独占页裁切）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes('function splitSingleLi'), '必须定义 splitSingleLi');
  assert(/splitSingleLi\(lis\[0\], remainingH\)/.test(src), 'splitList 单 li 分支必须走 splitSingleLi');
});

test('slides.html 集成：加载 slides-svg-size 模块', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../../dist/slides.html'), 'utf-8');
  assert(html.includes('scripts/slides-svg-size.js'), 'slides.html 必须先于 slides.js 加载策略模块');
});

test('slides.js 集成：懒续行段落按行内图片边界拆分（996px 单体段落防独占页裁切）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes('function splitParagraphsAroundImages'),
    '必须定义 splitParagraphsAroundImages');
  const callIdx = src.indexOf('splitParagraphsAroundImages(div)');
  const measureIdx = src.indexOf('var items = measureItems(div)');
  assert(callIdx !== -1, 'measureAndPack 必须调用 splitParagraphsAroundImages(div)');
  assert(callIdx < measureIdx, '段落拆分必须在测量之前（拆完量的才是可装箱的块）');
});

test('slides.js 集成：拆分器同时覆盖 p 与 li（紧凑列表图片直接挂在 li 下）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes("querySelectorAll('p, li')"), '必须同时处理 p 与 li');
  assert(src.includes("tagName === 'IMG'"), '必须按直接子级 IMG 节点判定拆分边界');
});

test('slides.js 集成：obsidian-embed 的 DIV 包装图片同样作为拆分边界', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(/isBoundary[\s\S]{0,200}?tagName === 'DIV'/.test(src),
    '![[...]] 图片被 processWikiLinkImages 包进 div.obsidian-embed，DIV 必须算切分边界');
});

test('slides.js 集成：纯图连排段落（无文字 ≥2 图）也要拆', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes('boundaries >= 2'),
    '两张连排图 ~820px 同样超预算，无文字的多图段落必须拆');
});

test('slides.js 集成：纯图段落不拆（已是块级单体，可独立装箱）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes('hasProse'), '必须区分纯图段落与文图混排段落');
});

test('slides.js 集成：splitList 首 li 超剩余预算时对首 li 内部拆分（count=0 不放弃）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(/count === 0[\s\S]{0,500}?splitSingleLi\(lis\[0\]/.test(src),
    'count=0 时必须对首 li 调 splitSingleLi，直接 return null 会把整段列表独占一页（2142px 实爆）');
});

test('slides.js 集成：splitSingleLi 把直接文本节点也作为子块（紧凑列表混排文本+嵌套列表）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  const fn = src.match(/function splitSingleLi[\s\S]{0,2400}?^  \}/m);
  assert(fn, '必须能定位 splitSingleLi 函数体');
  assert(fn[0].includes('childNodes'), '必须用 childNodes（.children 丢文本节点，紧凑列表 li 拆不动）');
  assert(fn[0].includes('nodeType === 3'), '必须显式处理文本节点');
});

test('slides.js 集成：克隆必须携带高度缓存（cloneWithHeights，防拆分链第二层断裂）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  assert(src.includes('function cloneWithHeights'), '必须定义 cloneWithHeights');
  const liFn = src.match(/function buildLi[\s\S]{0,300}?\n    \}/);
  assert(liFn && liFn[0].includes('cloneWithHeights'), 'splitSingleLi 的 buildLi 必须用 cloneWithHeights');
  const listFn = src.match(/function buildList[\s\S]{0,400}?\n    \}/);
  assert(listFn && listFn[0].includes('cloneWithHeights'), 'splitList 的 buildList 必须用 cloneWithHeights');
});

test('slides.js 集成：嵌套列表递归拆分（阻塞块是 UL/OL 时拆列表本身，防整块甩到续页）', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
  const fn = src.match(/function splitSingleLi[\s\S]{0,2600}?^  \}/m);
  assert(fn && fn[0].includes('splitList(blocker'), 'splitSingleLi 必须对嵌套列表阻塞块递归调 splitList');
  assert(src.includes('function stampListHeights'), '必须有列表级 stampListHeights（附着时量测 LI 高度）');
  assert(src.includes('stampListHeights(k)'), 'stampKidHeights 必须递归 stamp 嵌套列表');
});

TestRunner.run().then(({ passed, failed }) => {
  process.exit(failed > 0 ? 1 : 0);
});
