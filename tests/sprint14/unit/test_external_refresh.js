#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for external-refresh.js（切回标签时的外部修改检测决策）
 *
 * 背景：watcher 是单文件、随焦点切换的——后台标签的文件被外部修改时
 * 既无监听也无提示，切回后渲染的仍是打开时缓存的 tab.content。
 * 决策模块负责回答：重读磁盘后，要不要弹"已在外部修改"提示。
 */

const TestRunner = require('../../shared/test-runner');
const ExternalRefresh = require('../../../dist/scripts/external-refresh');

const { shouldPromptExternalRefresh } = ExternalRefresh;

// ============================================
// 核心不变量：磁盘与缓存不一致才提示
// ============================================
TestRunner.test('磁盘内容与缓存不同 → 提示', () => {
  TestRunner.assertEquals(
    shouldPromptExternalRefresh('# 旧内容', '# 新内容', false),
    true
  );
});

TestRunner.test('磁盘内容与缓存一致 → 不提示', () => {
  TestRunner.assertEquals(
    shouldPromptExternalRefresh('# 相同', '# 相同', false),
    false
  );
});

// ============================================
// 不重复弹：已有提示在屏时静默
// ============================================
TestRunner.test('提示已在屏 → 不重复弹（即使内容确实不同）', () => {
  TestRunner.assertEquals(
    shouldPromptExternalRefresh('# 旧内容', '# 新内容', true),
    false
  );
});

// ============================================
// 读盘失败：被动检测永不误报
// ============================================
TestRunner.test('磁盘读取失败（undefined）→ 不提示', () => {
  TestRunner.assertEquals(
    shouldPromptExternalRefresh('# 缓存', undefined, false),
    false
  );
});

TestRunner.test('磁盘读取失败（null）→ 不提示', () => {
  TestRunner.assertEquals(
    shouldPromptExternalRefresh('# 缓存', null, false),
    false
  );
});

// ============================================
// 边界：缓存侧异常
// ============================================
TestRunner.test('缓存缺失但磁盘内容有效 → 提示（保守）', () => {
  TestRunner.assertEquals(
    shouldPromptExternalRefresh(undefined, '# 磁盘内容', false),
    true
  );
});

TestRunner.test('空文件 ↔ 非空文件视为不同', () => {
  TestRunner.assertEquals(shouldPromptExternalRefresh('', '# 内容', false), true);
  TestRunner.assertEquals(shouldPromptExternalRefresh('# 内容', '', false), true);
  TestRunner.assertEquals(shouldPromptExternalRefresh('', '', false), false);
});

TestRunner.run();
