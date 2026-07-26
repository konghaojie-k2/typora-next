#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for slides pack core (v3)
 * 用注入假高度的 item 验证装箱决策：放得下则装、可拆则拆、标题不孤行。
 */

const TestRunner = require('../../shared/test-runner');
const { packItems } = require('../../shared/slides-pack-core');

const runner = TestRunner;
const AVAIL = 100;

function item(height, opts = {}) {
  return {
    height,
    isHeading: opts.heading || false,
    h2Text: opts.h2 || null,
    payload: opts.id || null,
    split: opts.splittable
      ? (remainingH) => {
          if (remainingH < 20) return null; // 第一部分至少 20px
          return [
            item(remainingH, { id: (opts.id || 'x') + '-part1' }),
            item(height - remainingH, { id: (opts.id || 'x') + '-part2', splittable: true })
          ];
        }
      : null
  };
}

runner.test('小元素合并装箱，超高才翻页', () => {
  const pages = packItems([item(30, { id: 'a' }), item(40, { id: 'b' }), item(50, { id: 'c' })], AVAIL);
  runner.assertEquals(pages.length, 2, 'a+b 一页(70)，c 一页');
  runner.assertEquals(pages[0].items.length, 2);
  runner.assertEquals(pages[0].continuedH2, null);
});

runner.test('可拆元素：剩余空间放第一部分，其余进下一页', () => {
  const pages = packItems([
    item(60, { id: 'text' }),
    item(80, { id: 'code', splittable: true })
  ], AVAIL);
  runner.assertEquals(pages.length, 2);
  runner.assertEquals(pages[0].items[1].payload, 'code-part1', '第一页装 40px 部分');
  runner.assertEquals(pages[1].items[0].payload, 'code-part2', '第二页装剩余 40px');
});

runner.test('不可拆且超高：独占一页', () => {
  const pages = packItems([
    item(30, { id: 'a' }),
    item(200, { id: 'huge' }),
    item(20, { id: 'b' })
  ], AVAIL);
  runner.assertEquals(pages.length, 3);
  runner.assertEquals(pages[1].items[0].payload, 'huge');
});

runner.test('标题不孤行：标题连同下一块放不下就先翻页', () => {
  const pages = packItems([
    item(70, { id: 'content' }),
    item(10, { heading: true, id: 'h' }),
    item(30, { id: 'after' })
  ], AVAIL);
  // 70 + 10 + 30 = 110 > 100 → 标题应翻到第二页与 after 同页
  runner.assertEquals(pages.length, 2);
  runner.assertEquals(pages[0].items.length, 1, '第一页只有 content');
  runner.assertEquals(pages[1].items[0].payload, 'h', '标题与内容同页');
});

runner.test('标题链不孤行：H2+H3 一起翻页', () => {
  const pages = packItems([
    item(60, { id: 'content' }),
    item(10, { heading: true, h2: '## 大节', id: 'h2' }),
    item(8, { heading: true, id: 'h3' }),
    item(50, { id: 'table' })
  ], AVAIL);
  // 60 + 10 + 8 + 50 = 128 > 100 → 标题链整体翻页
  runner.assertEquals(pages[0].items.length, 1);
  runner.assertEquals(pages[1].items[0].payload, 'h2');
});

runner.test('续页前缀：H2 小节中间拆分，下一页标记 continuedH2', () => {
  const pages = packItems([
    item(10, { heading: true, h2: '## 长节', id: 'h2' }),
    item(60, { id: 'p1' }),
    item(80, { id: 'code', splittable: true })
  ], AVAIL);
  runner.assertEquals(pages.length, 2);
  runner.assertEquals(pages[1].continuedH2, '## 长节', '拆分续页应标记小节');
});

runner.test('恰好从 H2 标题翻页：无续页前缀', () => {
  const pages = packItems([
    item(90, { id: 'big' }),
    item(10, { heading: true, h2: '## 新节', id: 'h2' }),
    item(30, { id: 'c' })
  ], AVAIL);
  runner.assertEquals(pages.length, 2);
  runner.assertEquals(pages[1].continuedH2, null, '新节起始页无前缀');
  runner.assertEquals(pages[1].items[0].payload, 'h2');
});

runner.test('孤标题页允许溢出：标题+超大不可拆项不死循环', () => {
  const pages = packItems([
    item(50, { id: 'a' }),
    item(10, { heading: true, id: 'h' }),
    item(200, { id: 'huge' })
  ], AVAIL);
  runner.assert(pages.length >= 2, '应正常分页不死循环');
  const all = pages.flatMap(p => p.items.map(i => i.payload));
  runner.assert(all.includes('h') && all.includes('huge'), '内容完整');
});

runner.test('剩余空间小拆分失败后，新页用整页高度重试拆分', () => {
  // 模拟 coverage_report 巨型列表：前 90px 占满后，150px 列表应在新页拆开
  // 而不是整块溢出到一页
  const pages = packItems([
    item(90, { id: 'intro' }),
    item(150, { id: 'biglist', splittable: true })
  ], AVAIL);
  runner.assert(pages.length >= 2, '应拆成多页: ' + pages.length);
  pages.forEach(function(p, idx) {
    const h = p.items.reduce(function(s, it) { return s + it.height; }, 0);
    runner.assert(h <= AVAIL, '第' + idx + '页不应溢出: ' + h);
  });
  const all = pages.flatMap(function(p) { return p.items.map(function(i) { return i.payload; }); });
  runner.assert(all.includes('biglist-part1') && all.includes('biglist-part2'), '列表应被拆分');
});

runner.run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
