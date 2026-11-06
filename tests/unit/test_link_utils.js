#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for link-utils（正文本地链接路径解析）
 *
 * 背景（2026-11-05 实爆）：正文 [说明](./doc.html) / file:// 链接点击无反应
 * ——前端从未实现 <a> 点击处理，相对链接按 webview 源导航 404。
 * 修复：initLinkHandling 分流，本地链接解析为绝对路径后交
 * open_local_file（Rust 系统默认应用打开）。
 *
 * 纯 Node 环境（无 DOM）：resolveLinkHref 走纯逻辑，
 * main.js 布线走源码级断言（与 test_export_svg_blocks 同款）。
 */

const fs = require('fs');
const path = require('path');
const TestRunner = require('../shared/test-runner');
const LinkUtils = require('../../dist/scripts/link-utils.js');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

const { resolveLinkHref } = LinkUtils;

// ---------- file:// 链接 ----------

test('file:// POSIX 绝对路径解码还原', () => {
  assertEquals(
    resolveLinkHref('file:///Users/haojie/docs/readme.html', '', ''),
    '/Users/haojie/docs/readme.html'
  );
});

test('file:// 带空格路径 decodeURIComponent 还原', () => {
  assertEquals(
    resolveLinkHref('file:///Users/haojie/My%20Docs/a.html', '', ''),
    '/Users/haojie/My Docs/a.html'
  );
});

test('本地相对链接解码中文文件名并移除 fragment/query', () => {
  assertEquals(
    resolveLinkHref('../../../pages/%E6%8B%89%E6%99%B6.html#top', '', '/Users/haojie/experiments/baselines/position_baselines/EXP.md'),
    '/Users/haojie/pages/拉晶.html',
  );
  assertEquals(
    resolveLinkHref('../../../pages/%E6%8B%89%E6%99%B6.html?x=1', '', '/Users/haojie/experiments/baselines/position_baselines/EXP.md'),
    '/Users/haojie/pages/拉晶.html',
  );
});

test('file:// Windows 盘符去掉前导斜杠', () => {
  assertEquals(
    resolveLinkHref('file:///C:/CODE/page.html', '', ''),
    'C:/CODE/page.html'
  );
});

test('Windows 中文和空格链接可解析为盘符路径', () => {
  assertEquals(
    resolveLinkHref('file:///C:/My%20Docs/%E6%8B%89%E6%99%B6.html#top', '', ''),
    'C:/My Docs/拉晶.html'
  );
  assertEquals(
    resolveLinkHref('..\\pages\\%E6%8B%89%E6%99%B6.html?view=1', '', 'C:\\vault\\notes\\main.md'),
    'C:/vault/pages/拉晶.html'
  );
});

test('本地链接只解码一次并保留编码后的文件名标点', () => {
  assertEquals(resolveLinkHref('file:///tmp/a%2520b.html', '', ''), '/tmp/a%20b.html');
  assertEquals(resolveLinkHref('file:///tmp/a%23b%3Fc.html#top', '', ''), '/tmp/a#b?c.html');
  assertEquals(resolveLinkHref('./a%23b.html', '', '/tmp/main.md'), '/tmp/a#b.html');
  assertEquals(resolveLinkHref('./bad%ZZ.html', '', '/tmp/main.md'), '/tmp/bad%ZZ.html');
});

test('外部 URL 保留编码和查询参数', () => {
  const url = 'https://example.com/a%20b?q=1#top';
  assertEquals(resolveLinkHref(url, '', ''), url);
});

// ---------- 绝对路径 ----------

test('POSIX 绝对路径原样返回', () => {
  assertEquals(resolveLinkHref('/Users/haojie/a.html', '/base', '/base/x.md'), '/Users/haojie/a.html');
});

test('Windows 盘符绝对路径原样返回', () => {
  assertEquals(resolveLinkHref('C:/CODE/page.html', '', ''), 'C:/CODE/page.html');
});

// ---------- 相对路径 ----------

test('相对路径基于 md 所在目录解析', () => {
  assertEquals(
    resolveLinkHref('./doc.html', '/vault', '/vault/notes/main.md'),
    '/vault/notes/doc.html'
  );
});

test('../ 段归一化，不逃逸出错误层级', () => {
  assertEquals(
    resolveLinkHref('../shared/page.html', '/vault', '/vault/notes/main.md'),
    '/vault/shared/page.html'
  );
});

test('md 目录缺失时回退 baseDir', () => {
  assertEquals(
    resolveLinkHref('doc.html', '/vault', ''),
    '/vault/doc.html'
  );
});

test('baseDir 也缺失时返回原值（Rust 端拒绝相对路径）', () => {
  assertEquals(resolveLinkHref('doc.html', '', ''), 'doc.html');
});

test('反斜杠路径归一化为正斜杠', () => {
  assertEquals(
    resolveLinkHref('.\\sub\\page.html', 'C:/vault', 'C:/vault/main.md'),
    'C:/vault/sub/page.html'
  );
});

test('多级 ../ 归一化', () => {
  // /a/b/c 上跳两级 = /a；上跳三级 = /
  assertEquals(
    resolveLinkHref('../../top.html', '/a', '/a/b/c/main.md'),
    '/a/top.html'
  );
  assertEquals(
    resolveLinkHref('../../../top.html', '/a', '/a/b/c/main.md'),
    '/top.html'
  );
});

// ---------- main.js / index.html 布线 ----------

test('main.js 集成：initLinkHandling 点击委托已挂载', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/main.js'), 'utf-8');
  assert(src.includes('initLinkHandling'), 'main.js 必须定义 initLinkHandling');
  assert(/initLinkHandling\(\)/.test(src), '渲染管线必须调用 initLinkHandling');
  assert(src.includes("invoke('open_local_file'"), '本地链接必须走 open_local_file 命令');
  assert(src.includes("invoke('open_external'"), 'http 链接必须走 open_external');
});

test('main.js 集成：委托只绑定一次', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/main.js'), 'utf-8');
  assert(src.includes('linkHandlingBound'), 'initLinkHandling 必须有防重复绑定 guard');
});

test('index.html 集成：link-utils 先于 main.js 加载', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../../dist/index.html'), 'utf-8');
  const lu = html.indexOf('scripts/link-utils.js');
  const mj = html.indexOf('scripts/main.js');
  assert(lu !== -1, 'index.html 必须加载 link-utils.js');
  assert(lu < mj, 'link-utils.js 必须先于 main.js 加载');
});

// ---------- findUrlInText：裸 URL 匹配（linkify 前置纯逻辑） ----------

test('findUrlInText: 裸 file:// URL 含百分号编码段完整匹配', () => {
  const text = '详细模拟见 file:///Users/x/Documents/cz-sim/%E6%8B%89%E6%99%B6.html 章节另述';
  const hit = LinkUtils.findUrlInText(text);
  assert(hit, '必须命中');
  assertEquals(hit.url, 'file:///Users/x/Documents/cz-sim/%E6%8B%89%E6%99%B6.html');
  assertEquals(text.slice(hit.start, hit.end), hit.url, '偏移必须能切回 URL');
});

test('findUrlInText: 尾随中文句号不入链接', () => {
  const hit = LinkUtils.findUrlInText('见 https://example.com/sim.html。其余');
  assert(hit, '必须命中');
  assertEquals(hit.url, 'https://example.com/sim.html');
});

test('findUrlInText: 尾随英文标点剥离，成对括号保留（wiki 页面常见）', () => {
  const hit = LinkUtils.findUrlInText('参考 https://en.wikipedia.org/wiki/Single_(crystal)_growth 即可');
  assertEquals(hit.url, 'https://en.wikipedia.org/wiki/Single_(crystal)_growth');
  const hit2 = LinkUtils.findUrlInText('见 https://example.com/a.html.');
  assertEquals(hit2.url, 'https://example.com/a.html', '尾随英文句点必须剥离');
});

test('findUrlInText: 无 URL 返回 null', () => {
  assert(LinkUtils.findUrlInText('纯文本没有链接') === null);
  assert(LinkUtils.findUrlInText('') === null);
  assert(LinkUtils.findUrlInText('只有 file: 一个冒号不算') === null);
});

test('findUrlInText: 多 URL 文本返回第一个命中', () => {
  const hit = LinkUtils.findUrlInText('先 file:///a/b.html 再 https://x.org/c');
  assertEquals(hit.url, 'file:///a/b.html');
});

test('findUrlInText: 大小写协议头（FILE://）也命中', () => {
  const hit = LinkUtils.findUrlInText('见 FILE:///Users/x/a.html 结束');
  assert(hit, '协议头不区分大小写');
  assertEquals(hit.url.toLowerCase(), 'file:///users/x/a.html');
});

// ---------- linkifyElement 导出（DOM 侧由 main.js/slides.js 布线断言覆盖） ----------

test('link-utils 导出 findUrlInText 与 linkifyElement', () => {
  assert(typeof LinkUtils.findUrlInText === 'function');
  assert(typeof LinkUtils.linkifyElement === 'function');
});

TestRunner.run().then(({ passed, failed }) => {
  process.exit(failed > 0 ? 1 : 0);
});
