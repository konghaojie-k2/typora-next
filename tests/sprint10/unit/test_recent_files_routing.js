#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Contract Tests for recent-files workspace routing (Phase 3)
 *
 * This test mirrors the `resolveRecentFileRoute` contract in
 * dist/scripts/main.js. The function normalizes the backend mode label
 * ('learning' -> 'course') and builds the workspace context for addTab.
 *
 * Contract:
 *  - mode defaults to 'normal' when absent
 *  - 'learning' (backend label) normalizes to 'course' (frontend id)
 *  - unknown modes fall back to 'normal'
 *  - normal mode -> empty workspaceContext
 *  - course mode -> { projectPath: path }
 *  - paper mode -> { activePaperPath: path, paperProjectPath: base_dir }
 *  - paper mode uses base_dir from openResult when available
 *  - string entry (legacy) is treated as { path: entry, mode: 'normal' }
 */

const TestRunner = require('../../shared/test-runner');

// ============================================
// Mirrored implementation (must match dist/scripts/main.js resolveRecentFileRoute)
// ============================================
function resolveRecentFileRoute(entry, openResult) {
  const path = (entry && entry.path) || (typeof entry === 'string' ? entry : '');
  let mode = (entry && entry.mode) || 'normal';
  if (mode === 'learning') mode = 'course';
  if (mode !== 'normal' && mode !== 'course' && mode !== 'paper') {
    mode = 'normal';
  }
  const baseDir = (openResult && openResult.base_dir) || '';
  const workspaceContext = mode === 'course'
    ? { projectPath: baseDir || path }
    : mode === 'paper'
      ? { activePaperPath: path, paperProjectPath: baseDir }
      : {};
  return { path, mode, baseDir, workspaceContext };
}

// ============================================
// Tests
// ============================================
TestRunner.test('normal mode routes to normal workspace with empty context', () => {
  const r = resolveRecentFileRoute({ path: 'C:\\doc.md', mode: 'normal' }, null);
  TestRunner.assertEquals(r.mode, 'normal', 'mode');
  TestRunner.assertEquals(r.path, 'C:\\doc.md', 'path');
  TestRunner.assertEquals(JSON.stringify(r.workspaceContext), '{}', 'context');
});

TestRunner.test('learning backend label normalizes to course', () => {
  const r = resolveRecentFileRoute({ path: 'C:\\proj\\ch1.md', mode: 'learning' }, null);
  TestRunner.assertEquals(r.mode, 'course', 'mode');
  TestRunner.assertEquals(r.workspaceContext.projectPath, 'C:\\proj\\ch1.md', 'projectPath');
});

TestRunner.test('course mode builds projectPath context', () => {
  const r = resolveRecentFileRoute({ path: 'C:\\proj\\ch1.md', mode: 'course' }, null);
  TestRunner.assertEquals(r.mode, 'course', 'mode');
  // No base_dir known yet → fall back to path (caller refines after open_file).
  TestRunner.assertEquals(r.workspaceContext.projectPath, 'C:\\proj\\ch1.md', 'projectPath');
});

TestRunner.test('course mode uses base_dir as projectPath when known', () => {
  const r = resolveRecentFileRoute({ path: 'C:\\proj\\ch1.md', mode: 'course' }, { base_dir: 'C:\\proj' });
  TestRunner.assertEquals(r.workspaceContext.projectPath, 'C:\\proj', 'projectPath should be project root, not chapter file');
});

TestRunner.test('paper mode builds activePaperPath + paperProjectPath context', () => {
  const r = resolveRecentFileRoute({ path: 'C:\\papers\\vae.md', mode: 'paper' }, { base_dir: 'C:\\papers' });
  TestRunner.assertEquals(r.mode, 'paper', 'mode');
  TestRunner.assertEquals(r.workspaceContext.activePaperPath, 'C:\\papers\\vae.md', 'activePaperPath');
  TestRunner.assertEquals(r.workspaceContext.paperProjectPath, 'C:\\papers', 'paperProjectPath');
});

TestRunner.test('paper mode without openResult leaves paperProjectPath empty', () => {
  const r = resolveRecentFileRoute({ path: 'C:\\papers\\vae.md', mode: 'paper' }, null);
  TestRunner.assertEquals(r.workspaceContext.activePaperPath, 'C:\\papers\\vae.md', 'activePaperPath');
  TestRunner.assertEquals(r.workspaceContext.paperProjectPath, '', 'paperProjectPath');
});

TestRunner.test('absent mode defaults to normal', () => {
  const r = resolveRecentFileRoute({ path: 'C:\\doc.md' }, null);
  TestRunner.assertEquals(r.mode, 'normal', 'mode');
});

TestRunner.test('unknown mode falls back to normal', () => {
  const r = resolveRecentFileRoute({ path: 'C:\\doc.md', mode: 'review' }, null);
  TestRunner.assertEquals(r.mode, 'normal', 'mode');
});

TestRunner.test('legacy string entry treated as normal mode', () => {
  const r = resolveRecentFileRoute('C:\\doc.md', null);
  TestRunner.assertEquals(r.mode, 'normal', 'mode');
  TestRunner.assertEquals(r.path, 'C:\\doc.md', 'path');
});

(async () => {
  const result = await TestRunner.run();
  process.exit(result.failed > 0 ? 1 : 0);
})();
