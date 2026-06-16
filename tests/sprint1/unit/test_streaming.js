/**
 * Streaming Verification — TDD for includePartialMessages fix
 *
 * Verifies that agent-bridge correctly extracts text from per-chunk
 * `stream_event` messages (the new shape emitted when
 * `includePartialMessages: true` is set on the SDK query).
 *
 * Run: node tests/sprint1/unit/test_streaming.js
 */

const TestRunner = require('../../shared/test-runner');

// We test the internal helper via the public surface (collectAgentOutput)
// because _extractAssistantText is not exported.
const {
  collectAgentOutput,
  planCourse,
  initSession,
  generateChapters,
  chatWithAgent,
} = require('../../../agent-bridge');

// ============================================
// 1. Per-chunk stream_event handling
// ============================================

TestRunner.test('collectAgentOutput joins multiple text_delta events into one string', async () => {
  async function* mockStream() {
    // Simulate upstream SSE chunks: 3 text_delta events
    yield {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0 }
    };
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello ' }
      }
    };
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'streaming ' }
      }
    };
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'world' }
      }
    };
    yield {
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 }
    };
    yield { type: 'result', subtype: 'success', result: 'Hello streaming world' };
  }

  const out = await collectAgentOutput(mockStream());
  TestRunner.assertEquals(out, 'Hello streaming world',
    'Should concatenate text_delta chunks in order');
});

TestRunner.test('collectAgentOutput still handles the legacy full assistant message', async () => {
  async function* mockStream() {
    yield {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'fallback' }] }
    };
    yield { type: 'result', subtype: 'success', result: 'fallback' };
  }

  const out = await collectAgentOutput(mockStream());
  TestRunner.assertEquals(out, 'fallback',
    'Should still work when only the cumulative assistant message is present');
});

TestRunner.test('collectAgentOutput mixes stream_event + final assistant + result', async () => {
  async function* mockStream() {
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '{"k' }
      }
    };
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ey":' }
      }
    };
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '"v"}' }
      }
    };
    // The final cumulative message is also delivered
    yield {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '{"key":"v"}' }] }
    };
    yield { type: 'result', subtype: 'success', result: '{"key":"v"}' };
  }

  const out = await collectAgentOutput(mockStream());
  // result wins (matches existing behavior: prefer final result)
  TestRunner.assertEquals(out, '{"key":"v"}',
    'Should prefer final result when both stream and result are present');
});

TestRunner.test('stream_event with non-text delta (e.g. input_json_delta) is ignored', async () => {
  async function* mockStream() {
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"foo":' }  // tool use, not text
      }
    };
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'actual text' }
      }
    };
    yield { type: 'result', subtype: 'success', result: 'actual text' };
  }

  const out = await collectAgentOutput(mockStream());
  TestRunner.assertEquals(out, 'actual text',
    'Should skip non-text deltas and only concatenate text_delta');
});

// ============================================
// 2. End-to-end: planCourse no longer emits progress_log (per "取消" feedback)
// ============================================

TestRunner.test('planCourse does NOT emit progress_log (verbose logs cancelled)', async () => {
  const origLog = console.log;
  const origErr = console.error;
  const captured = [];
  console.log = (line) => captured.push(line);
  console.error = () => {};

  try {
    async function* queryFn() {
      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '```json\n{"chapters":[],"project_slug":"demo"}\n```' }
        }
      };
      yield { type: 'result', subtype: 'success', result: '```json\n{"chapters":[],"project_slug":"demo"}\n```' };
    }

    await planCourse(queryFn, { api_key: 'mock' }, { goal: 'demo', level: 'beginner', hours: 1 });

    const events = captured.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    const types = events.map(e => e.type);

    // status + outline should still fire
    TestRunner.assert(types.includes('status'), 'Should still emit status');
    TestRunner.assert(types.includes('outline'), 'Should still emit outline');

    // progress_log should NOT fire (per "取消" feedback)
    TestRunner.assert(!types.includes('progress_log'),
      'Should NOT emit progress_log — verbose logs were cancelled. Got types: ' + types.join(','));
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
});

// ============================================
// 3. includePartialMessages is actually set in the query options
// ============================================

TestRunner.test('planCourse passes includePartialMessages: true to queryFn', async () => {
  let receivedOptions = null;
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = () => {};

  try {
    async function* queryFn({ options }) {
      receivedOptions = options;
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: '```json\n{"chapters":[]}\n```' }] }
      };
      yield { type: 'result', subtype: 'success', result: '```json\n{"chapters":[]}\n```' };
    }

    await planCourse(queryFn, { api_key: 'mock' }, { goal: 'x', level: 'beginner', hours: 1 });

    TestRunner.assert(receivedOptions !== null && receivedOptions !== undefined,
      'queryFn should have been called');
    TestRunner.assertEquals(receivedOptions.includePartialMessages, true,
      'Should pass includePartialMessages: true to enable stream_event emission');
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
});

// ============================================
// 4. Stream delta ordering: order must be preserved
// ============================================

TestRunner.test('text_delta chunks are joined in receive order', async () => {
  async function* mockStream() {
    const chunks = ['a', 'b', 'c', 'd', 'e'];
    for (const c of chunks) {
      // Yield with an arbitrary microtask gap to mimic real async arrival
      await new Promise(r => setImmediate(r));
      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: c }
        }
      };
    }
    yield { type: 'result', subtype: 'success', result: 'abcde' };
  }

  const out = await collectAgentOutput(mockStream());
  TestRunner.assertEquals(out, 'abcde',
    'Should preserve chunk order despite async arrival');
});

// ============================================
// 5. Verbose-log regression: generateChapters emits NO progress_log at all
// ============================================

TestRunner.test('generateChapters emits NO progress_log (per "取消" feedback)', async () => {
  const fs = require('fs');
  const path = require('path');
  const origWrite = fs.writeFileSync;
  const origExists = fs.existsSync;
  const origMkdir = fs.mkdirSync;

  const projectPath = '/tmp/skill-test';

  // Phase D: agent uses Write tool to write the .md file, then returns
  // a confirmation text ≥ 5 chars. The host verifies the file exists on disk.
  const writtenFiles = {};
  fs.writeFileSync = (filepath, content) => {
    writtenFiles[filepath] = content;
    // Ensure the directory exists for real, so existsSync works later
    const dir = path.dirname(filepath);
    if (!origExists.call(fs, dir)) origMkdir.call(fs, dir, { recursive: true });
    origWrite.call(fs, filepath, content);
  };
  fs.mkdirSync = (p, opts) => origMkdir.call(fs, p, opts);
  fs.existsSync = (p) => origExists.call(fs, p) || !!writtenFiles[p];

  const { generateChapters } = require('../../../agent-bridge');
  const origLog = console.log;
  const origErr = console.error;
  const captured = [];
  console.log = (line) => captured.push(line);
  console.error = () => {};

  try {
    async function* queryFn() {
      // The agent writes the .md file via Write tool (simulated)
      const filename = path.join(projectPath, '00-Big-Chapter.md');
      origWrite.call(fs, filename, '# Big Chapter\n\nContent here.');
      // Return ≥ 5 char confirmation (Phase D host requires this)
      yield { type: 'assistant', message: { content: [{ type: 'text', text: '第 1 章已生成: Big Chapter' }] } };
      yield { type: 'result', subtype: 'success', result: '第 1 章已生成: Big Chapter' };
    }

    const outline = {
      chapters: [{ title: 'Big Chapter', duration_minutes: 10, concepts: ['x'] }],
      project_slug: 'demo'
    };
    await generateChapters(queryFn, { api_key: 'mock' }, {
      project_path: projectPath,
      outline,
      chapter_indices: [0]
    });

    const events = captured.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    const types = events.map(e => e.type);
    const logCount = types.filter(t => t === 'progress_log').length;

    TestRunner.assertEquals(logCount, 0,
      'generateChapters should emit ZERO progress_log events. Got types: ' + types.join(','));
    TestRunner.assert(types.includes('progress'), 'Should still emit progress event for chapter status');
    TestRunner.assert(types.includes('chapter_complete'), 'Should still emit chapter_complete');
  } finally {
    fs.writeFileSync = origWrite;
    fs.existsSync = origExists;
    console.log = origLog;
    console.error = origErr;
  }
});

TestRunner.test('generateChapters fails gracefully when agent does not write the file', async () => {
  // If the agent returns OK but didn't actually write the .md, host
  // should emit chapter_failed so the user can retry.
  const fs = require('fs');
  const origWrite = fs.writeFileSync;
  const path = require('path');

  const { generateChapters } = require('../../../agent-bridge');
  const origLog = console.log;
  const origErr = console.error;
  const captured = [];
  console.log = (line) => captured.push(line);
  console.error = () => {};

  try {
    async function* queryFn() {
      // Return ≥ 5 char confirmation so host passes the "too short" check,
      // but do NOT write the .md file — simulate agent hallucinating success.
      yield { type: 'assistant', message: { content: [{ type: 'text', text: '第 1 章已生成: X' }] } };
      yield { type: 'result', subtype: 'success', result: '第 1 章已生成: X' };
    }

    const outline = { chapters: [{ title: 'X', duration_minutes: 10, concepts: [] }], project_slug: 'demo' };
    await generateChapters(queryFn, { api_key: 'mock' }, {
      project_path: '/tmp/missing-file',
      outline,
      chapter_indices: [0]
    });

    const events = captured.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    const failEvent = events.find(e => e.type === 'chapter_failed');
    TestRunner.assert(failEvent, 'Should emit chapter_failed when .md file is missing');
    TestRunner.assert(failEvent.data.error.includes('did not write'),
      'Error message should mention missing file. Got: ' + (failEvent ? failEvent.data.error : '(no fail event)'));
  } finally {
    fs.writeFileSync = origWrite;
    console.log = origLog;
    console.error = origErr;
  }
});

// ============================================
// Run all tests
// ============================================

// ============================================
// 6. initSession (Phase B) — establish agent session, return session_id
// ============================================

TestRunner.test('initSession returns session_id from first agent message', async () => {
  const origLog = console.log;
  const captured = [];
  console.log = (line) => captured.push(line);
  console.error = () => {};

  try {
    async function* queryFn() {
      yield { type: 'system', session_id: 'uuid-aaa-bbb', subtype: 'init' };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] }, session_id: 'uuid-aaa-bbb' };
      yield { type: 'result', subtype: 'success', result: 'ok' };
    }

    const result = await initSession(queryFn, { api_key: 'mock' }, { project_path: '/tmp/test' });
    TestRunner.assertEquals(result.session_id, 'uuid-aaa-bbb', 'Should return session_id from first message');

    // session_init event should be emitted
    const events = captured.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const initEvent = events.find(e => e.type === 'session_init');
    TestRunner.assert(initEvent, 'Should emit session_init event');
    TestRunner.assertEquals(initEvent.data.session_id, 'uuid-aaa-bbb');
  } finally {
    console.log = origLog;
  }
});

TestRunner.test('initSession throws when no session_id in stream', async () => {
  const origLog = console.log;
  console.log = () => {};
  console.error = () => {};

  try {
    async function* queryFn() {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };  // no session_id
      yield { type: 'result', subtype: 'success', result: 'ok' };
    }

    let threw = false;
    try {
      await initSession(queryFn, { api_key: 'mock' }, { project_path: '/tmp/test' });
    } catch (e) {
      threw = true;
      TestRunner.assert(e.message.includes('session_id'),
        `Error should mention session_id, got: ${e.message}`);
    }
    TestRunner.assert(threw, 'Should throw when no session_id available');
  } finally {
    console.log = origLog;
  }
});

TestRunner.test('initSession requires project_path', async () => {
  let threw = false;
  try {
    await initSession(() => {}, {}, {});
  } catch (e) {
    threw = true;
    TestRunner.assert(e.message.includes('project_path'),
      `Error should mention project_path, got: ${e.message}`);
  }
  TestRunner.assert(threw, 'Should throw when project_path missing');
});

// ============================================
// 7. Session resume fallback (Phase B/C) — retry fresh if resume fails
// ============================================

TestRunner.test('generateChapters passes resume: session_id when provided', async () => {
  const fs = require('fs');
  const origWrite = fs.writeFileSync;
  fs.writeFileSync = () => {};

  let receivedOptions = null;
  const origLog = console.log;
  const captured = [];
  console.log = (line) => captured.push(line);
  console.error = () => {};

  try {
    async function* queryFn({ options }) {
      receivedOptions = options;
      const wrapped = '---MARKDOWN_START---\n# T\n\ntext\n---MARKDOWN_END---\n---QUIZ_JSON_START---\n{"chapter_file":"00-T.md","questions":[],"adaptive_rules":{}}\n---QUIZ_JSON_END---\n---CONCEPTS_JSON_START---\n{"chapter":"00-T.md","concepts":[]}\n---CONCEPTS_JSON_END---';
      yield { type: 'result', subtype: 'success', result: wrapped };
    }

    const outline = { chapters: [{ title: 'T', duration_minutes: 10, concepts: ['x'] }], project_slug: 'demo' };
    await generateChapters(queryFn, { api_key: 'mock' }, {
      project_path: '/tmp/x',
      outline,
      chapter_indices: [0],
      session_id: 'session-abc-123'
    });

    TestRunner.assertEquals(receivedOptions.resume, 'session-abc-123',
      'Should pass resume: session_id to queryFn when provided');
  } finally {
    fs.writeFileSync = origWrite;
    console.log = origLog;
    console.error = origLog;
  }
});

TestRunner.test('generateChapters does NOT pass resume when session_id absent', async () => {
  const fs = require('fs');
  const origWrite = fs.writeFileSync;
  fs.writeFileSync = () => {};

  let receivedOptions = null;
  const origLog = console.log;
  const captured = [];
  console.log = (line) => captured.push(line);
  console.error = () => {};

  try {
    async function* queryFn({ options }) {
      receivedOptions = options;
      const wrapped = '---MARKDOWN_START---\n# T\n\ntext\n---MARKDOWN_END---\n---QUIZ_JSON_START---\n{"chapter_file":"00-T.md","questions":[],"adaptive_rules":{}}\n---QUIZ_JSON_END---\n---CONCEPTS_JSON_START---\n{"chapter":"00-T.md","concepts":[]}\n---CONCEPTS_JSON_END---';
      yield { type: 'result', subtype: 'success', result: wrapped };
    }

    const outline = { chapters: [{ title: 'T', duration_minutes: 10, concepts: ['x'] }], project_slug: 'demo' };
    await generateChapters(queryFn, { api_key: 'mock' }, {
      project_path: '/tmp/x',
      outline,
      chapter_indices: [0]
      // no session_id
    });

    TestRunner.assert(receivedOptions.resume === undefined,
      'Should not set resume when session_id absent');
  } finally {
    fs.writeFileSync = origWrite;
    console.log = origLog;
    console.error = origLog;
  }
});

TestRunner.test('chatWithAgent passes resume when session_id provided', async () => {
  let receivedOptions = null;
  const origLog = console.log;
  console.log = () => {};
  console.error = () => {};

  try {
    async function* queryFn({ options }) {
      receivedOptions = options;
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
      yield { type: 'result', subtype: 'success', result: 'hi' };
    }

    await chatWithAgent(queryFn, { api_key: 'mock' }, {
      article: '', history: [], message: 'hello', session_id: 'sess-xyz'
    });

    TestRunner.assertEquals(receivedOptions.resume, 'sess-xyz',
      'chatWithAgent should pass resume: session_id');
  } finally {
    console.log = origLog;
    console.error = origLog;
  }
});

// ============================================
// Run all tests
// ============================================

TestRunner.run();
