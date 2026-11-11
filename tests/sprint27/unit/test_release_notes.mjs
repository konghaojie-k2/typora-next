#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import TestRunner from '../../shared/test-runner.js';
import { validateRelease } from '../../../scripts/check-release.mjs';

const version = '0.4.14';
const heading = `## [${version}] - 2026-11-11`;
const body = '### Features\n\n- 更新界面支持重试与取消。\n- 查看 "Release Notes"，保留反斜杠 \\。';
const current = `${heading}\n\n${body}`;
const changelog = `# Changelog\n\n## [Unreleased]\n\n- 尚未发布。\n\n${current}\n\n## [0.4.13] - 2026-11-07\n\n- 历史版本内容。\n`;

TestRunner.test('提取目标版本说明，排除 Unreleased 与历史版本', () => {
  const result = validateRelease({ version, tag: 'v0.4.14', changelog });
  assert.equal(result.notes, current + '\n');
  assert.equal(result.version, version);
});

TestRunner.test('nightly 没有版本标签时也检查当前版本说明，兼容 CRLF', () => {
  assert.equal(validateRelease({ version, changelog: changelog.replace(/\n/g, '\r\n') }).notes, current + '\n');
});

TestRunner.test('缺少目标版本时不借用其他版本说明', () => {
  assert.throws(() => validateRelease({ version: '0.4.15', changelog }), /缺少版本 0.4.15/);
});

TestRunner.test('发布标签与应用版本不一致时失败', () => {
  assert.throws(() => validateRelease({ version, tag: 'v0.4.15', changelog }), /与应用版本/);
});

TestRunner.test('重复版本条目时失败，避免发布不完整的说明', () => {
  assert.throws(() => validateRelease({ version, changelog: `${current}\n\n${current}` }), /重复/);
});

for (const empty of ['', ' \n\t', '### Features\n\n### Fixes', '<!-- 更新内容稍后填写 -->', '### Features\n\n- TODO\n- TBD', '- 待补充', '---\n- ...']) {
  TestRunner.test(`空白、标题或占位内容不能通过检查：${JSON.stringify(empty)}`, () => {
    assert.throws(() => validateRelease({ version, changelog: `${heading}\n\n${empty}\n\n## [0.4.13]\n- 不能借用历史说明` }), /没有实际更新内容/);
  });
}

TestRunner.test('CLI 失败返回非零状态，成功后才写出当前版本的说明文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'typora-release-notes-'));
  const script = fileURLToPath(new URL('../../../scripts/check-release.mjs', import.meta.url));
  const output = join(root, 'notes.md');
  try {
    mkdirSync(join(root, 'src-tauri'));
    writeFileSync(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version }));
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n');
    const failed = spawnSync(process.execPath, [script, '--tag', 'v0.4.14', '--output', output], { cwd: root, encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /缺少版本 0.4.14/);
    assert.equal(existsSync(output), false);

    writeFileSync(join(root, 'CHANGELOG.md'), changelog);
    const passed = spawnSync(process.execPath, [script, '--tag', 'v0.4.14', '--output', output], { cwd: root, encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(readFileSync(output, 'utf8'), current + '\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

TestRunner.run().then(({ failed }) => { if (failed) process.exitCode = 1; });
