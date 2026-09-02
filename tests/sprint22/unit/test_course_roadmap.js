#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Course Roadmap 📍 下一站 (Sprint 22)
 *
 * 三态渲染（loading/error/ready）+ 换一批/意向 chip + 卡片点击回调 + snapHours。
 * 依赖注入 invoke + mock DOM（无 jsdom）。
 */

const TestRunner = require('../../shared/test-runner');
const { buildMockDOM } = require('../../shared/mock-dom');
const CourseRoadmap = require('../../../dist/scripts/learning/course-roadmap.js');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const assertExists = TestRunner.assertExists.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

function flush() {
  return new Promise(r => setTimeout(r, 0));
}

function makeSection({ invokeResult, invokeError } = {}) {
  const document = buildMockDOM().document || buildMockDOM();
  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    if (invokeError) throw new Error(invokeError);
    return invokeResult;
  };
  const selected = [];
  const section = CourseRoadmap.createRoadmapSection({
    projectPath: '/fake/course',
    invoke,
    document,
    onSelectDirection: (d) => selected.push(d)
  });
  return { section, calls, selected, document };
}

const SAMPLE_ROADMAP = {
  version: 1,
  generated_at: 1000,
  directions: [
    { goal: '深入生命周期', reason: '你在「生命周期」概念上挣扎过', level: 'advanced', hours: 5 },
    { goal: 'Rust 异步编程', reason: '已掌握所有权，可横向拓展', level: 'intermediate', hours: 4 }
  ],
  excluded_goals: []
};

// ---------- snapHours ----------

test('snapHours: 吸附到最近档位', () => {
  assertEquals(CourseRoadmap.snapHours(4), 3, '4 离 3 和 5 等距，reduce 取先到的 3');
  assertEquals(CourseRoadmap.snapHours(6), 5);
  assertEquals(CourseRoadmap.snapHours(12), 8);
  assertEquals(CourseRoadmap.snapHours(100), 16);
  assertEquals(CourseRoadmap.snapHours(0), 1, '非法值回退首档');
});

// ---------- 三态渲染 ----------

test('创建即进入 loading 并自动调用 generate_roadmap', async () => {
  const { section, calls } = makeSection({ invokeResult: SAMPLE_ROADMAP });
  assertEquals(section.roadmap.getState(), 'loading');
  assertExists(section.querySelector('.roadmap-loading'), 'loading 状态可见');
  await flush();
  assertEquals(calls.length, 1);
  assertEquals(calls[0].cmd, 'generate_roadmap');
  assertEquals(calls[0].args.projectPath, '/fake/course');
  assertEquals(calls[0].args.intent, null, '首次加载无意向（命中缓存则不调 LLM）');
});

test('ready 态渲染方向卡片（goal/reason/级别/时长）', async () => {
  const { section } = makeSection({ invokeResult: SAMPLE_ROADMAP });
  await flush();
  assertEquals(section.roadmap.getState(), 'ready');
  const cards = section.querySelectorAll('.roadmap-card');
  assertEquals(cards.length, 2);
  assert(cards[0].textContent.includes('深入生命周期') ||
    cards[0].querySelector('.roadmap-card-goal').textContent.includes('深入生命周期'),
    '卡片含 goal');
  const meta = cards[0].querySelector('.roadmap-card-meta');
  assert(meta.textContent.includes('高级'), '级别标签');
  assert(meta.textContent.includes('5'), '时长');
});

test('error 态显示错误并提供重试', async () => {
  const { section, calls } = makeSection({ invokeError: 'API 请求失败' });
  await flush();
  assertEquals(section.roadmap.getState(), 'error');
  assertExists(section.querySelector('.roadmap-error'));
  const retry = section.querySelector('.roadmap-retry');
  assertExists(retry, '重试按钮存在');
  retry.click();
  assertEquals(section.roadmap.getState(), 'loading', '重试回到 loading');
  await flush();
  assertEquals(calls.length, 2, '重试再次调用');
});

// ---------- 换一批 / 意向 chip ----------

test('换一批以 reshuffle 意向重生成', async () => {
  const { section, calls } = makeSection({ invokeResult: SAMPLE_ROADMAP });
  await flush();
  section.querySelector('.roadmap-refresh').click();
  await flush();
  assertEquals(calls.length, 2);
  assertEquals(calls[1].args.intent, 'reshuffle');
});

test('意向 chip 以对应 intent 重生成', async () => {
  const { section, calls } = makeSection({ invokeResult: SAMPLE_ROADMAP });
  await flush();
  const chip = section.querySelector('[data-intent="gentler"]');
  assertExists(chip, '平缓一些 chip 存在');
  chip.click();
  await flush();
  assertEquals(calls[1].args.intent, 'gentler');
  assertEquals(section.querySelectorAll('[data-intent]').length, 3, '三个意向 chip');
});

// ---------- 卡片点击 ----------

test('卡片点击触发 onSelectDirection 回调', async () => {
  const { section, selected } = makeSection({ invokeResult: SAMPLE_ROADMAP });
  await flush();
  section.querySelectorAll('.roadmap-card')[1].click();
  assertEquals(selected.length, 1);
  assertEquals(selected[0].goal, 'Rust 异步编程');
  assertEquals(selected[0].level, 'intermediate');
  assertEquals(selected[0].hours, 4);
});

// ---------- 集成接线（防回归） ----------

test('index.html 引入 course-roadmap.js', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '../../../dist/index.html'), 'utf-8');
  assert(html.includes('scripts/learning/course-roadmap.js'), 'script 标签缺失');
});

// Run
TestRunner.run().then(({ passed, failed }) => {
  process.exit(failed > 0 ? 1 : 0);
});
