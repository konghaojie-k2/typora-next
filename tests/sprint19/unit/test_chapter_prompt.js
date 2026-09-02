#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for agent-bridge buildChapterPrompt / collectChapterSkillRefs
 * —— 课程类型自适应章节生成（Sprint 19）
 *
 * 背景：章节模板原先照 transformer 技术课设计，人文课（巴赫鉴赏）被强制
 * 塞伪代码和 flowchart。course_type 现在从 Rust 注入 args，bridge 须在
 * prompt 里条件输出 course_type 行；无 session 时还须把 skill 参考资料
 * inline 进 prompt（修"session 里已有"这句在 fresh-session 模式下为假的 bug）。
 */

const TestRunner = require('../../shared/test-runner');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let _tmpDirs = [];

function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 's19-'));
  _tmpDirs.push(d);
  return d;
}

(async () => {
  const bridge = await import(pathToFileURL(path.join(__dirname, '../../../agent-bridge.mjs')).href);

  const CHAPTER = { title: '巴赫的生平与时代', duration_minutes: 25, concepts: ['生平', '时代'] };
  const PREV = ['为什么要听巴赫'];

  // ============================================
  // buildChapterPrompt — course_type 条件行
  // ============================================

  await TestRunner.test('buildChapterPrompt: courseType 存在时输出 course_type 行', async () => {
    const p = bridge.buildChapterPrompt({
      index: 1, chapter: CHAPTER, projectPath: '/tmp/x',
      previousChapters: PREV, courseType: 'humanities', hasSession: true
    });
    TestRunner.assert(p.includes('- course_type: humanities\n'), 'course_type 行应出现在 concepts 之后');
    TestRunner.assert(p.includes('chapter-generation skill'), '应保留 skill 调用指令');
    TestRunner.assert(p.includes('- chapter_index: 1'), 'chapter_index 应保留');
    TestRunner.assert(p.includes('previous_chapters'), 'previous_chapters 应保留');
  });

  await TestRunner.test('buildChapterPrompt: courseType 缺失时不输出该行', async () => {
    const p = bridge.buildChapterPrompt({
      index: 0, chapter: CHAPTER, projectPath: '/tmp/x',
      previousChapters: [], courseType: undefined, hasSession: true
    });
    TestRunner.assert(!p.includes('course_type'), '缺失时不应出现 course_type 字样');
    TestRunner.assert(p.includes('- concepts:'), 'concepts 行应保留');
  });

  await TestRunner.test('buildChapterPrompt: 首章 prevContext 为「这是第一章」', async () => {
    const p = bridge.buildChapterPrompt({
      index: 0, chapter: CHAPTER, projectPath: '/tmp/x',
      previousChapters: [], courseType: 'technical', hasSession: true
    });
    TestRunner.assert(p.includes('这是第一章。'), '首章应提示这是第一章');
  });

  await TestRunner.test('buildChapterPrompt: 无 session 时提示参考资料在上方并可 Read 补充', async () => {
    const p = bridge.buildChapterPrompt({
      index: 0, chapter: CHAPTER, projectPath: '/tmp/x',
      previousChapters: [], courseType: 'humanities', hasSession: false
    });
    TestRunner.assert(p.includes('已附在上方'), 'fresh-session 措辞应指向 inline 的参考资料');
    TestRunner.assert(p.includes('.pi/skills/chapter-generation/references/content-format.md'),
      '应给出 .pi 路径的 Read 兜底');
    TestRunner.assert(!p.includes('已经在 init session 里读过'), '不应再宣称 session 里已读过');
  });

  // ============================================
  // collectChapterSkillRefs — 项目内 skill 文件 inline
  // ============================================

  await TestRunner.test('collectChapterSkillRefs: 项目含 references/content-format.md 时能 inline', async () => {
    const proj = tmpdir('refs-ok-');
    const skillDir = path.join(proj, '.pi', 'skills', 'chapter-generation', 'references');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(path.dirname(skillDir), 'SKILL.md'), '# Skill v-test\n类型判定测试');
    fs.writeFileSync(path.join(skillDir, 'content-format.md'), '# Format v1.2\n人文课槽位测试');
    const refs = bridge.collectChapterSkillRefs(proj);
    TestRunner.assert(refs.includes('=== SKILL.md ==='), 'SKILL.md 应被 inline');
    TestRunner.assert(refs.includes('=== content-format.md ==='), 'content-format.md 应被 inline');
    TestRunner.assert(refs.includes('人文课槽位测试'), '内容应完整嵌入');
  });

  await TestRunner.test('collectChapterSkillRefs: 项目无 skill 文件时返回空串', async () => {
    const proj = tmpdir('refs-empty-');
    const refs = bridge.collectChapterSkillRefs(proj);
    TestRunner.assertEquals(refs, '', '无可读文件时应返回空串');
  });

  const { failed } = await TestRunner.run();
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  process.exit(failed > 0 ? 1 : 0);
})();
