/**
 * TDD Tests for the pi-kernel Agent Bridge (agent-bridge.mjs)
 *
 * Consolidates the bridge contract assertions previously spread over
 * sprint1/sprint3/sprint8/sprint10 old suites (claude-kernel shapes retired).
 * Mock injection: bridge.__setRunnerForTests(fn) — fn(opts) => {output, sessionFile, refreshed}
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import T from '../../shared/test-runner.js';
import * as bridge from '../../../agent-bridge.mjs';

// ============================================
// Helpers
// ============================================

/** Capture stdout JSON lines emitted via emit() during fn(). */
function captureEvents(fn) {
  const events = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    const line = typeof chunk === 'string' ? chunk : chunk.toString();
    for (const l of line.split('\n').filter(Boolean)) {
      try { events.push(JSON.parse(l.trim())); } catch (e) { /* non-JSON stdout */ }
    }
    return true;
  };
  return fn().then(() => {
    process.stdout.write = originalWrite;
    return events;
  }).catch(e => {
    process.stdout.write = originalWrite;
    throw e;
  });
}

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ============================================
// Pure functions
// ============================================

T.test('extractJSON: code block / raw / error', () => {
  T.assertEquals(bridge.extractJSON('x\n```json\n{"k":1}\n```\n').k, 1, 'code block');
  T.assertEquals(bridge.extractJSON('resp {"a":[1]}').a[0], 1, 'raw json');
  let threw = false;
  try { bridge.extractJSON('no json'); } catch (e) { threw = true; }
  T.assert(threw, 'throws without json');
});

T.test('generateFilename: sanitization', () => {
  T.assertEquals(bridge.generateFilename(0, '注意力机制'), '00-注意力机制.md');
  T.assertEquals(bridge.generateFilename(5, 'Self-Attention 详解！'), '05-Self-Attention-详解.md');
  T.assertEquals(bridge.generateFilename(1, ''), '01-.md');
});

T.test('checkAgentSDK: unavailable without env entry or local node_modules', () => {
  delete process.env.TYPORA_PI_SDK_ENTRY;
  const r = bridge.checkAgentSDK();
  T.assertEquals(r.available, false, 'worktree has no node_modules and no env entry');
});

// ============================================
// plan stage
// ============================================

T.test('planCourse: emits normalized outline (totals recomputed, slug sanitized)', async () => {
  bridge.__setRunnerForTests(async () => ({
    output: '```json\n{"project_slug":"Bad_Slug!","chapters":[{"title":"A"},{"duration_minutes":10,"concepts":["x"]}],"total_duration":999}\n```',
    sessionFile: null, refreshed: false
  }));
  const events = await captureEvents(() => bridge.planCourse(null, {}, { goal: 'g', level: 'beginner', hours: 1 }));
  const outline = events.find(e => e.type === 'outline')?.data.outline;
  T.assertExists(outline, 'outline event emitted');
  T.assertEquals(outline.chapters[0].title, 'A', 'title kept');
  T.assertEquals(outline.chapters[0].duration_minutes, 20, 'missing duration defaults 20');
  T.assertEquals(outline.total_duration, 30, 'total recomputed, not model claim');
  T.assertEquals(outline.project_slug, 'learning-project', 'invalid slug falls back');
  bridge.__setRunnerForTests(null);
});

// ============================================
// generate stage
// ============================================

T.test('generateChapters: verifies agent wrote the .md, emits chapter_complete + complete', async () => {
  const proj = tmpdir('gen-');
  bridge.__setRunnerForTests(async (opts) => {
    const idx = parseInt(opts.prompt.match(/chapter_index:\s*(\d+)/)[1], 10);
    const title = JSON.parse(opts.prompt.match(/chapter_title:\s*(".*")/m)[1]);
    fs.writeFileSync(path.join(proj, bridge.generateFilename(idx, title)), '# ch');
    return { output: `第 ${idx + 1} 章已生成`, sessionFile: 's.jsonl', refreshed: false };
  });
  const events = await captureEvents(() => bridge.generateChapters(null, {}, {
    project_path: proj,
    outline: { chapters: [{ title: '一', duration_minutes: 10, concepts: [] }, { title: '二', duration_minutes: 10, concepts: [] }] }
  }));
  T.assertEquals(events.filter(e => e.type === 'chapter_complete').length, 2, 'both chapters complete');
  T.assertEquals(events.find(e => e.type === 'complete').data.total_generated, 2);
  bridge.__setRunnerForTests(null);
  fs.rmSync(proj, { recursive: true, force: true });
});

T.test('generateChapters: missing file → chapter_failed (no crash)', async () => {
  const proj = tmpdir('genfail-');
  bridge.__setRunnerForTests(async () => ({ output: 'ok done', sessionFile: null, refreshed: false }));
  const events = await captureEvents(() => bridge.generateChapters(null, {}, {
    project_path: proj,
    outline: { chapters: [{ title: 'x', duration_minutes: 5, concepts: [] }] }
  }));
  T.assertExists(events.find(e => e.type === 'chapter_failed'), 'failed event emitted');
  bridge.__setRunnerForTests(null);
  fs.rmSync(proj, { recursive: true, force: true });
});

// ============================================
// explain stage
// ============================================

T.test('explainText: empty text / missing output_file throw', async () => {
  for (const args of [{ text: '', output_file: 'x' }, { text: 't', output_file: undefined }]) {
    let threw = false;
    try { await bridge.explainText(null, {}, args); } catch (e) { threw = true; }
    T.assert(threw, `throws for ${JSON.stringify(args)}`);
  }
});

T.test('explainText: truncates text to 200 chars in prompt', async () => {
  let seenPrompt = '';
  const out = path.join(tmpdir('exp-'), 'r.json');
  bridge.__setRunnerForTests(async (opts) => {
    seenPrompt = opts.prompt;
    fs.writeFileSync(out, '{}');
    return { output: 'done', sessionFile: null, refreshed: false };
  });
  await bridge.explainText(null, {}, { text: 'a'.repeat(500), output_file: out });
  T.assert(seenPrompt.includes('a'.repeat(200)), 'prompt contains capped text');
  T.assert(!seenPrompt.includes('a'.repeat(201)), 'prompt must not contain uncapped text');
  bridge.__setRunnerForTests(null);
});

T.test('explainText: throws when agent did not write output_file', async () => {
  bridge.__setRunnerForTests(async () => ({ output: 'done', sessionFile: null, refreshed: false }));
  let threw = false;
  try { await bridge.explainText(null, {}, { text: 't', output_file: '/nonexistent/x.json' }); } catch (e) { threw = true; }
  T.assert(threw, 'missing file must throw');
  bridge.__setRunnerForTests(null);
});

// ============================================
// socratic stage (ported from sprint8 suite)
// ============================================

T.test('socraticChat: throws when project_path missing', async () => {
  let threw = false;
  try { await bridge.socraticChat(null, {}, { concept_titles: ['A'] }); } catch (e) { threw = true; }
  T.assert(threw);
});

T.test('socraticChat: no [SESSION_END] → done=false, content kept', async () => {
  bridge.__setRunnerForTests(async () => ({ output: 'A 和 B 的关系是什么？', sessionFile: 's.jsonl', refreshed: false }));
  const r = await bridge.socraticChat(null, {}, { project_path: '/tmp/t', concept_titles: ['A', 'B'] });
  T.assertEquals(r.done, false);
  T.assert(r.content.length > 0);
  bridge.__setRunnerForTests(null);
});

T.test('socraticChat: subsequent-turn [SESSION_END] sets done, marker stripped', async () => {
  bridge.__setRunnerForTests(async () => ({ output: 'Good. [SESSION_END]', sessionFile: 's.jsonl', refreshed: false }));
  const r = await bridge.socraticChat(null, {}, { project_path: '/tmp/t', concept_titles: ['A'], user_answer: '我的回答', session_id: 's.jsonl' });
  T.assertEquals(r.done, true);
  T.assert(!r.content.includes('[SESSION_END]'));
  bridge.__setRunnerForTests(null);
});

T.test('socraticChat: opening-turn [SESSION_END] ignored', async () => {
  bridge.__setRunnerForTests(async () => ({ output: '开场？ [SESSION_END]', sessionFile: 's.jsonl', refreshed: false }));
  const r = await bridge.socraticChat(null, {}, { project_path: '/tmp/t', concept_titles: ['A'] });
  T.assertEquals(r.done, false, 'first turn never ends');
  T.assert(!r.content.includes('[SESSION_END]'));
  bridge.__setRunnerForTests(null);
});

T.test('socraticChat: empty output throws', async () => {
  bridge.__setRunnerForTests(async () => ({ output: '', sessionFile: null, refreshed: false }));
  let threw = false;
  try { await bridge.socraticChat(null, {}, { project_path: '/tmp/t', concept_titles: ['A'] }); } catch (e) { threw = true; }
  T.assert(threw);
  bridge.__setRunnerForTests(null);
});

T.test('socraticChat: returns session_id (= pi sessionFile)', async () => {
  bridge.__setRunnerForTests(async () => ({ output: 'Q?', sessionFile: 'sdk-sess-9', refreshed: false }));
  const r = await bridge.socraticChat(null, {}, { project_path: '/tmp/test', concept_titles: ['A', 'B'], concept_edges: [['A', 'B']] });
  T.assertEquals(r.session_id, 'sdk-sess-9', 'session_id is the pi sessionFile');
  bridge.__setRunnerForTests(null);
});

T.test('socraticChat: first-turn prompt names skill + history path + mastered/escaped', async () => {
  let captured = null;
  bridge.__setRunnerForTests(async (opts) => { captured = opts; return { output: '开场问题？', sessionFile: 's', refreshed: false }; });
  await bridge.socraticChat(null, {}, { project_path: '/tmp/test', concept_titles: ['学习率', '梯度下降'], concept_edges: [['梯度下降', '学习率']] });
  T.assert(captured.prompt.includes('typora-socratic-review skill'), 'names the unique skill');
  T.assert(captured.prompt.includes('.learning/socratic-sessions'), 'points at fixed history path');
  T.assert(captured.prompt.includes('user_ended') && captured.prompt.includes('llm_done'), 'mastered/escaped distinction');
  bridge.__setRunnerForTests(null);
});

T.test('socraticChat: subsequent-turn prompt is the raw user answer', async () => {
  let captured = null;
  bridge.__setRunnerForTests(async (opts) => { captured = opts; return { output: '下一问？', sessionFile: 's', refreshed: false }; });
  await bridge.socraticChat(null, {}, { project_path: '/tmp/test', concept_titles: ['A'], user_answer: '我觉得是因为梯度方向', session_id: 's' });
  T.assertEquals(captured.prompt, '我觉得是因为梯度方向', 'forwards raw user answer');
  bridge.__setRunnerForTests(null);
});

T.test('socraticChat: stale session → session_refresh event with new sessionFile', async () => {
  bridge.__setRunnerForTests(async () => ({ output: 'hi', sessionFile: '/new/s.jsonl', refreshed: true }));
  const events = await captureEvents(() =>
    bridge.socraticChat(null, {}, { project_path: '/tmp/t', concept_titles: ['A'], session_id: 'legacy-claude-id' }));
  const refresh = events.find(e => e.type === 'session_refresh');
  T.assertExists(refresh, 'session_refresh emitted on fallback');
  T.assertEquals(refresh.data.new_session_id, '/new/s.jsonl');
  bridge.__setRunnerForTests(null);
});

// ============================================
// review-gen stage
// ============================================

T.test('generateReviewContent: parses cards from json block; missing cards throws', async () => {
  bridge.__setRunnerForTests(async () => ({ output: '```json\n{"cards":{"c1":{"quiz_questions":[]}}}\n```', sessionFile: null, refreshed: false }));
  const r = await bridge.generateReviewContent(null, {}, { project_path: '/tmp', chapter_file: 'c.md', concepts: [] });
  T.assertExists(r.cards.c1);
  bridge.__setRunnerForTests(async () => ({ output: 'no cards here, just text over ten chars', sessionFile: null, refreshed: false }));
  let threw = false;
  try { await bridge.generateReviewContent(null, {}, { project_path: '/tmp', chapter_file: 'c.md', concepts: [] }); } catch (e) { threw = true; }
  T.assert(threw, 'missing cards field throws');
  bridge.__setRunnerForTests(null);
});

// ============================================
// paper-reader stage (ported from sprint10)
// ============================================

T.test('paper-reader: emits status + complete, verifies guide file', async () => {
  const dir = tmpdir('paper-');
  const paper = path.join(dir, 'vae.md');
  const out = path.join(dir, 'guide.json');
  fs.writeFileSync(paper, '# VAE\n');
  bridge.__setRunnerForTests(async (opts) => {
    const m = opts.prompt.match(/output_file:\s*"([^"]+)"/);
    fs.writeFileSync(m[1], JSON.stringify({ title: 'VAE', reading_order: [], sections: [{ id: 's1' }] }));
    return { output: 'done', sessionFile: null, refreshed: false };
  });
  const events = await captureEvents(() => bridge.generatePaperReaderGuide(null, {}, { paper_file: paper, output_file: out, persona: {} }));
  T.assertExists(events.find(e => e.type === 'status'), 'status event');
  T.assertExists(events.find(e => e.type === 'complete'), 'complete event');
  T.assert(fs.existsSync(out), 'guide written');
  bridge.__setRunnerForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

T.test('paper-reader: missing paper_file throws', async () => {
  let threw = false;
  try { await bridge.generatePaperReaderGuide(null, {}, { paper_file: '/nope/x.md', output_file: '/nope/y.json' }); } catch (e) { threw = true; }
  T.assert(threw);
});

// ============================================
// _writeTempModelsJson: base_url semantics
// ============================================

T.test('_writeTempModelsJson: openai base_url 归一化 /v1，anthropic 不动', () => {
  const read = (r) => JSON.parse(fs.readFileSync(r.modelsPath, 'utf-8'));
  const cleanup = (r) => { fs.rmSync(r.dir, { recursive: true, force: true }); delete process.env[`TYPORA_PI_KEY_${process.pid}`]; };

  const r1 = bridge._writeTempModelsJson({ ai_provider: 'openai', ai_base_url: 'https://api.deepseek.com', api_key: 'k', model: 'm' });
  T.assertEquals(read(r1).providers['typora-next-app'].baseUrl, 'https://api.deepseek.com/v1', 'openai 无版本段时补 /v1');
  cleanup(r1);

  const r2 = bridge._writeTempModelsJson({ ai_provider: 'openai', ai_base_url: 'https://api.openai.com/v1/', api_key: 'k', model: 'm' });
  T.assertEquals(read(r2).providers['typora-next-app'].baseUrl, 'https://api.openai.com/v1/', '已有版本段不动');
  cleanup(r2);

  const r3 = bridge._writeTempModelsJson({ ai_provider: 'anthropic', ai_base_url: 'https://x.cn/apps/anthropic', api_key: 'k', model: 'm' });
  T.assertEquals(read(r3).providers['typora-next-app'].baseUrl, 'https://x.cn/apps/anthropic', 'anthropic 不动');
  T.assertEquals(read(r3).providers['typora-next-app'].api, 'anthropic-messages', 'anthropic 映射');
  cleanup(r3);
});

// ============================================
// chat stage
// ============================================

T.test('chatWithAgent: returns trimmed output; empty throws', async () => {
  bridge.__setRunnerForTests(async () => ({ output: '  reply text  ', sessionFile: null, refreshed: false }));
  const r = await bridge.chatWithAgent(null, {}, { article: '', history: [], message: 'q' });
  T.assertEquals(r, 'reply text', 'trimmed');
  bridge.__setRunnerForTests(async () => ({ output: '   ', sessionFile: null, refreshed: false }));
  let threw = false;
  try { await bridge.chatWithAgent(null, {}, { article: '', history: [], message: 'q' }); } catch (e) { threw = true; }
  T.assert(threw);
  bridge.__setRunnerForTests(null);
});

T.run().then(({ failed }) => { if (failed > 0) process.exit(1); });
