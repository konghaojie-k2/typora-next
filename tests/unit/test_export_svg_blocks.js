#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for export-svg-blocks（Word 导出内联 <svg> → 图片）
 *
 * 纯 Node 环境（无 DOM）：extract / dedent / rewrite 走纯逻辑，
 * measureSvg 走 viewBox/属性兜底分支。
 */

const TestRunner = require('../shared/test-runner');
const ExportSvgBlocks = require('../../dist/scripts/export-svg-blocks.js');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

const SVG = '<svg viewBox="0 0 120 60"><circle cx="60" cy="30" r="20" fill="red"/></svg>';
const SVG_MULTILINE = [
  '<svg viewBox="0 0 100 50">',
  '  <rect x="5" y="5" width="90" height="40"/>',
  '</svg>'
].join('\n');

// ---------- extractInlineSvgBlocks ----------

test('提取普通内联 svg（单行）', () => {
  const md = '# 标题\n\n' + SVG + '\n\n正文';
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].text, SVG);
  assertEquals(blocks[0].startLine, 2);
  assertEquals(blocks[0].endLine, 2);
});

test('提取多行 svg 块', () => {
  const md = '前文\n' + SVG_MULTILINE + '\n后文';
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].text, SVG_MULTILINE);
  assertEquals(blocks[0].startLine, 1);
  assertEquals(blocks[0].endLine, 3);
});

test('代码围栏内的 svg 不提取', () => {
  const md = '```html\n' + SVG + '\n```\n\n' + SVG_MULTILINE;
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 1, 'fence 内的 svg 必须忽略');
  assertEquals(blocks[0].text, SVG_MULTILINE);
});

test('~~~ 围栏内的 svg 不提取', () => {
  const md = '~~~\n' + SVG + '\n~~~\n' + SVG;
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].startLine, 3, '只取围栏外那个');
});

test('多个 svg 各自成块', () => {
  const md = SVG + '\n中间\n' + SVG_MULTILINE;
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 2);
});

test('CRLF 归一化', () => {
  const md = 'a\r\n' + SVG + '\r\nb';
  const blocks = ExportSvgBlocks.extractInlineSvgBlocks(md);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].text, SVG);
});

// ---------- prepareForWordExport：重写 + key ----------

test('svg 原位重写为 mermaid 围栏', async () => {
  const md = '前文\n\n' + SVG + '\n\n后文';
  const out = await ExportSvgBlocks.prepareForWordExport(md);
  const lines = out.markdown.split('\n');
  assertEquals(lines[2], '```mermaid');
  assertEquals(lines[3], SVG);
  assertEquals(lines[4], '```');
  assertEquals(lines[0], '前文');
  assertEquals(lines[6], '后文');
});

test('两个相同 svg 各自成围栏（防 replace-first-occurrence 双重包裹）', async () => {
  const md = SVG + '\n\n' + SVG;
  const out = await ExportSvgBlocks.prepareForWordExport(md);
  const count = out.markdown.split('```mermaid').length - 1;
  assertEquals(count, 2, '两次出现都必须各自包一层围栏');
  // 围栏内不得再出现围栏标记
  assert(out.markdown.indexOf('```mermaid\n```mermaid') === -1, '不得嵌套');
});

test('key 与 findMermaidBlocks 归一化一致（dedent+trim）', async () => {
  const indented = SVG_MULTILINE.split('\n').map(l => '  ' + l).join('\n');
  const md = 'x\n' + indented;
  const out = await ExportSvgBlocks.prepareForWordExport(md);
  assertEquals(out.images.length, 1);
  assertEquals(out.images[0].key, SVG_MULTILINE, '缩进应被 dedent 掉');
});

test('无 svg 时原样返回', async () => {
  const md = '# 没有图\n\n正文';
  const out = await ExportSvgBlocks.prepareForWordExport(md);
  assertEquals(out.markdown, md);
  assertEquals(out.images.length, 0);
});

// ---------- measureSvg（无 DOM → 属性兜底分支） ----------

test('缺 xmlns 时自动补（usvg 必需）', async () => {
  const r = await ExportSvgBlocks.measureSvg(SVG);
  assert(r.svg.includes('xmlns="http://www.w3.org/2000/svg"'), '应注入 xmlns');
  assert(!/<svg[^>]*\sxmlns=.*\sxmlns=/.test(r.svg), '不得重复注入');
});

test('已有 xmlns 不重复注入，viewBox 提供尺寸', async () => {
  const withNs = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"></svg>';
  const r = await ExportSvgBlocks.measureSvg(withNs);
  assertEquals((r.svg.match(/xmlns=/g) || []).length, 1);
  assertEquals(r.width, 200);
  assertEquals(r.height, 100);
});

test('无 viewBox 无尺寸时回退默认尺寸', async () => {
  const r = await ExportSvgBlocks.measureSvg('<svg><rect/></svg>');
  assertEquals(r.width, 600);
  assertEquals(r.height, 400);
});

// ---------- normalizeForExport（Mermaid SVG 导出居中） ----------

test('内联 max-width 被剥掉（2026-10-21 贴边实爆：只改 width 不删 max-width 依旧贴边）', () => {
  const preview = '<svg width="100%" style="max-width: 481px;" viewBox="0 0 481 187" xmlns="http://www.w3.org/2000/svg"><circle/></svg>';
  const out = ExportSvgBlocks.normalizeForExport(preview);
  assert(!/max-width/i.test(out), `max-width 必须剥掉: ${out}`);
});

test('style 里其他声明保留，剥空则整个 style 属性移除', () => {
  const both = '<svg style="max-width: 480px; font-family: serif;" viewBox="0 0 100 50"><rect/></svg>';
  const out1 = ExportSvgBlocks.normalizeForExport(both);
  assert(/style="font-family: serif"/.test(out1), `非 max-width 声明应保留: ${out1}`);
  const only = '<svg style="max-width: 480px;" viewBox="0 0 100 50"><rect/></svg>';
  const out2 = ExportSvgBlocks.normalizeForExport(only);
  assert(!/style=/.test(out2), `style 剥空应整属性移除: ${out2}`);
});

test('width=100% + height 按留白后 viewBox 比例（正文插图默认 fitWidth，与预览一致）', () => {
  const svg = '<svg width="481" height="187" viewBox="0 0 481 187"><circle/></svg>';
  const out = ExportSvgBlocks.normalizeForExport(svg);
  assert(/width="100%"/.test(out), `width 应为 100%: ${out}`);
  // (187+48)/(481+48) = 235/529 ≈ 44.42%
  assert(/height="44\.42%"/.test(out), `height 应按 viewBox 比例: ${out}`);
});

test('fillViewport:true 时宽高均 100%（Mermaid 独立文件一屏居中）', () => {
  const svg = '<svg width="481" height="187" viewBox="0 0 481 187"><circle/></svg>';
  const out = ExportSvgBlocks.normalizeForExport(svg, { fillViewport: true });
  assert(/width="100%"/.test(out), `width 应为 100%: ${out}`);
  assert(/height="100%"/.test(out), `height 应为 100%: ${out}`);
});

test('inline-svg-spec 真实形态端到端（width=100% 无 height → fitWidth 比例正确）', () => {
  // 课程插图骨架：viewBox 0 0 680 400，无 height
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 400" width="100%" role="img"><rect width="680" height="400" fill="#F7F5F0"/></svg>';
  const out = ExportSvgBlocks.normalizeForExport(svg);
  assert(/width="100%"/.test(out), '满宽');
  // (400+48)/(680+48) = 448/728 ≈ 61.54%
  assert(/height="61\.54%"/.test(out), `height 应为比例: ${out}`);
  assert(/viewBox="-24 -24 728 448"/.test(out), 'viewBox 加 24 留白');
});

test('无 width/height 属性时补齐 fitWidth 两维度', () => {
  const svg = '<svg viewBox="0 0 100 50"><rect/></svg>';
  const out = ExportSvgBlocks.normalizeForExport(svg);
  assert(/width="100%"/.test(out), `应补满宽: ${out}`);
  assert(/height="[\d.]+%"/.test(out), `应补比例高: ${out}`);
});

test('viewBox 四周各加 24 留白且左上角为负坐标', () => {
  const svg = '<svg viewBox="0 0 100 50"><rect/></svg>';
  const out = ExportSvgBlocks.normalizeForExport(svg);
  const vb = out.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  assertEquals(vb[0], -24, 'minX = 0 - 24');
  assertEquals(vb[1], -24, 'minY = 0 - 24');
  assertEquals(vb[2], 148, 'width = 100 + 48');
  assertEquals(vb[3], 98, 'height = 50 + 48');
});

test('viewBox 原点非零时留白相对原点外扩', () => {
  const svg = '<svg viewBox="10 20 100 50"><rect/></svg>';
  const out = ExportSvgBlocks.normalizeForExport(svg);
  const vb = out.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  assertEquals(vb[0], -14);
  assertEquals(vb[1], -4);
});

test('注入 preserveAspectRatio=xMidYMid meet（查看器居中保险）', () => {
  const svg = '<svg viewBox="0 0 100 50"><rect/></svg>';
  const out = ExportSvgBlocks.normalizeForExport(svg);
  assert(/preserveAspectRatio="xMidYMid meet"/.test(out), `应注入居中声明: ${out}`);
});

test('已有 preserveAspectRatio 被覆盖为 meet，不重复注入', () => {
  const svg = '<svg preserveAspectRatio="xMinYMin slice" viewBox="0 0 100 50"><rect/></svg>';
  const out = ExportSvgBlocks.normalizeForExport(svg);
  assertEquals((out.match(/preserveAspectRatio=/g) || []).length, 1);
  assert(!/xMinYMin/.test(out), '旧值应被替换');
});

test('自定义留白 pad=0 时 viewBox 与原内容一致', () => {
  const svg = '<svg width="100%" viewBox="0 0 100 50"><rect/></svg>';
  const out = ExportSvgBlocks.normalizeForExport(svg, { pad: 0 });
  const vb = out.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  assertEquals(vb[2], 100);
  assertEquals(vb[3], 50);
});

test('无 viewBox 时原样返回（宁可不居中也不改坏图）', () => {
  const svg = '<svg width="100%"><rect/></svg>';
  assertEquals(ExportSvgBlocks.normalizeForExport(svg), svg);
});

test('viewBox 尺寸非法（0/负数）时原样返回', () => {
  const svg = '<svg viewBox="0 0 0 50"><rect/></svg>';
  assertEquals(ExportSvgBlocks.normalizeForExport(svg), svg);
});

test('mermaid 真实输出形态端到端：max-width 剥净 + 满视口 + 对称留白 + meet', () => {
  const real = '<svg id="mermaid-0" width="100%" style="max-width: 481px;" viewBox="0 0 481 187" xmlns="http://www.w3.org/2000/svg" role="graphics-document document"><g><path d="M10,10 L470,10"/></g></svg>';
  const out = ExportSvgBlocks.normalizeForExport(real, { fillViewport: true });
  assert(!/max-width/i.test(out), 'max-width 剥净');
  assert(/width="100%"/.test(out), '满宽');
  assert(/height="100%"/.test(out), '满高');
  assert(/preserveAspectRatio="xMidYMid meet"/.test(out), '居中声明');
  const vb = out.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  assertEquals(vb[0], -24);
  assertEquals(vb[1], -24);
  // 根开标签外内容原样保留
  assert(out.includes('<g><path d="M10,10 L470,10"/></g>'), '内容不得被改动');
});

test('main.js：mermaid 走 fillViewport，内嵌 svg 走默认 fitWidth', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/main.js'), 'utf-8');
  assert(
    /downloadMermaid[\s\S]{0,300}fillViewport:\s*true/.test(src),
    'downloadMermaid 应传 fillViewport:true（独立文件一屏居中）'
  );
  // downloadSvgElement 的 opts 透传 normalizeForExport；内嵌 svg 调用不带 fillViewport
  assert(
    /downloadSvgElement\(svg, 'figure\.svg'\)/.test(src),
    '内嵌 svg 下载应走默认 fitWidth（不带 fillViewport）'
  );
});

test('内嵌 svg 的 wrapper 必须块级铺满（inline-block 会塌缩插图，2026-10-21 实爆）', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/main.js'), 'utf-8');
  const css = fs.readFileSync(
    path.join(__dirname, '../../dist/styles/main.css'), 'utf-8');
  assert(
    /svg-block-wrapper/.test(src) && /svg-block-wrapper/.test(css),
    'JS 与 CSS 必须同步存在 svg-block-wrapper 类'
  );
  assert(
    /\.downloadable-wrapper\.svg-block-wrapper\s*\{[^}]*display:\s*block/.test(css),
    'CSS 必须把 svg-block-wrapper 覆盖为 display:block'
  );
  assert(
    /addInlineSvgDownloadButtons[\s\S]{0,800}svg-block-wrapper/.test(src),
    '内嵌 svg 挂载函数应使用块级 wrapper'
  );
});

test('main.js 集成 normalizeForExport 到下载链路', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/main.js'), 'utf-8');
  assert(
    /normalizeForExport/.test(src) && /downloadMermaid/.test(src),
    'downloadMermaid 应接入导出归一化'
  );
});

test('main.js 为正文内嵌 svg 提供下载按钮（独立于 mermaid 管线）', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/main.js'), 'utf-8');
  assert(src.includes('addInlineSvgDownloadButtons'), '缺少内嵌 svg 下载按钮挂载函数');
  assert(
    /initDownloadButtons[\s\S]{0,300}addInlineSvgDownloadButtons\(container\)/.test(src),
    'initDownloadButtons 应调用 addInlineSvgDownloadButtons'
  );
  // 排除非正文图形：KaTeX 数学与 Mermaid 渲染产物内部也有 <svg>
  assert(/addInlineSvgDownloadBlocks[\s\S]*?closest\('pre\.mermaid'\)|addInlineSvgDownloadButtons[\s\S]{0,600}closest\('pre\.mermaid'\)/.test(src),
    '必须排除 pre.mermaid 内的 svg（已有自己的按钮）');
  assert(/addInlineSvgDownloadButtons[\s\S]{0,600}closest\('\.katex'\)/.test(src),
    '必须排除 .katex 内的 svg（数学符号）');
  // 下载走同一居中归一化
  assert(
    /downloadSvgElement[\s\S]{0,400}normalizeForExport/.test(src),
    '内嵌 svg 下载应经过 normalizeForExport 居中归一化'
  );
});

// ---------- 集成接线（防回归） ----------

test('index.html 引入 export-svg-blocks.js 且在 main.js 之前', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '../../dist/index.html'), 'utf-8');
  const svgPos = html.indexOf('scripts/export-svg-blocks.js');
  const mainPos = html.indexOf('scripts/main.js');
  assert(svgPos > 0, '缺少 script 标签');
  assert(svgPos < mainPos, '必须先于 main.js 加载');
});

test('main.js 集成 prepareForWordExport', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/main.js'), 'utf-8');
  assert(src.includes('ExportSvgBlocks.prepareForWordExport'), 'exportWord 未接 svg 预处理');
  assert(src.includes('markdown: exportMarkdown'), 'invoke 应使用重写后的 markdown');
  // mermaid 渲染循环必须基于原始 markdown（合成围栏不可进入 mermaid 解析）
  assert(/findMermaidBlocks\(tab\.content\)/.test(src), 'mermaidBlocks 应来自原始 markdown');
});

TestRunner.run().then(({ passed, failed }) => {
  process.exit(failed > 0 ? 1 : 0);
});
