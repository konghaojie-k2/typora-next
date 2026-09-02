#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for agent-bridge element-repair + engineering course_type（Sprint 20）
 *
 * 覆盖：
 * - buildChapterPrompt 透传 engineering（不丢弃、不回退）
 * - buildElementRepairPrompt 生成只修复违规代码块的定向重写 prompt
 */

const TestRunner = require('../../shared/test-runner');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const bridge = await import(pathToFileURL(path.join(__dirname, '../../../agent-bridge.mjs')).href);

  const CHAPTER = { title: '等离子刻蚀原理', duration_minutes: 25, concepts: ['等离子体', '各向异性'] };
  const REPAIRS = [
    {
      file: '01-等离子刻蚀.md',
      violations: [
        { lang: 'python', line: 5, detail: 'engineering 禁止编程代码块：`python`（5 行起）' }
      ]
    }
  ];

  // ============================================
  // buildChapterPrompt — engineering 透传
  // ============================================

  await TestRunner.test('buildChapterPrompt: engineering courseType 输出 course_type 行', async () => {
    const p = bridge.buildChapterPrompt({
      index: 0, chapter: CHAPTER, projectPath: '/tmp/x',
      previousChapters: [], courseType: 'engineering', hasSession: true
    });
    TestRunner.assert(p.includes('- course_type: engineering\n'), 'engineering 应出现在 course_type 行');
  });

  await TestRunner.test('buildChapterPrompt: engineering 且无 session 时附参考文献', async () => {
    const p = bridge.buildChapterPrompt({
      index: 0, chapter: CHAPTER, projectPath: '/tmp/x',
      previousChapters: [], courseType: 'engineering', hasSession: false
    });
    TestRunner.assert(p.includes('course_type: engineering'), 'engineering 行应保留');
    TestRunner.assert(p.includes('已附在上方'), 'fresh-session 措辞应指向 inline 参考资料');
  });

  // ============================================
  // buildElementRepairPrompt — 定向重写 prompt
  // ============================================

  await TestRunner.test('buildElementRepairPrompt: 包含违规清单', async () => {
    const p = bridge.buildElementRepairPrompt('/tmp/proj', REPAIRS);
    TestRunner.assert(p.includes('/tmp/proj'), '应含 project_path');
    TestRunner.assert(p.includes('01-等离子刻蚀.md'), '应含违规文件名');
    TestRunner.assert(p.includes('python'), '应含违规语言 tag');
    TestRunner.assert(p.includes('repairs'), '应含 repairs 字样');
  });

  await TestRunner.test('buildElementRepairPrompt: 指示只改违规代码块、其余不动', async () => {
    const p = bridge.buildElementRepairPrompt('/tmp/proj', REPAIRS);
    TestRunner.assert(p.includes('只'), '应限定只修复违规代码块');
    TestRunner.assert(
      /原样保留|一字不改|不动|不修改其它|不要改动其他/.test(p),
      '应要求其余内容原样保留'
    );
    TestRunner.assert(p.includes('Read'), '应使用 Read 读取目标文件');
    TestRunner.assert(p.includes('Write'), '应使用 Write 写回');
  });

  await TestRunner.test('buildElementRepairPrompt: 空 repairs 返回空串', async () => {
    TestRunner.assertEquals(bridge.buildElementRepairPrompt('/tmp/proj', []), '', '空清单不应生成 prompt');
  });

  const { failed } = await TestRunner.run();
  process.exit(failed > 0 ? 1 : 0);
})();
