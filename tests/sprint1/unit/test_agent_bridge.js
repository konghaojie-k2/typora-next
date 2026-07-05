/**
 * TDD Tests for Agent Bridge Core Functions
 * Tests extractJSON, generateFilename, collectAgentOutput with mock SDK
 */

const TestRunner = require('../../shared/test-runner');
const {
  extractJSON,
  generateFilename,
  collectAgentOutput,
  planCourse,
  generateChapters,
  checkAgentSDK,
  chatWithAgent
} = require('../../../agent-bridge');

const mockSDK = require('../../mock-agent-sdk');

// ============================================
// Test: extractJSON
// ============================================

TestRunner.test('extractJSON parses JSON code block', () => {
  const text = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
  const result = extractJSON(text);
  TestRunner.assertEquals(result.key, 'value', 'Should extract JSON from code block');
});

TestRunner.test('extractJSON parses raw JSON object', () => {
  const text = 'Response: {"chapters": [{"title": "Test"}]}';
  const result = extractJSON(text);
  TestRunner.assertEquals(result.chapters[0].title, 'Test', 'Should extract raw JSON');
});

TestRunner.test('extractJSON throws on invalid input', () => {
  TestRunner.assertThrows(() => {
    extractJSON('No JSON here');
  }, 'Should throw when no JSON found');
});

TestRunner.test('extractJSON throws on malformed JSON', () => {
  TestRunner.assertThrows(() => {
    extractJSON('```json\n{invalid}\n```');
  }, 'Should throw on malformed JSON');
});

// ============================================
// Test: generateFilename
// ============================================

TestRunner.test('generateFilename creates correct format', () => {
  const result = generateFilename(0, '注意力机制');
  TestRunner.assertEquals(result, '00-注意力机制.md', 'Should pad index and append .md');
});

TestRunner.test('generateFilename sanitizes special chars', () => {
  const result = generateFilename(5, 'Self-Attention 详解！');
  TestRunner.assertEquals(result, '05-Self-Attention-详解.md', 'Should replace special chars with hyphen');
});

TestRunner.test('generateFilename handles empty title', () => {
  const result = generateFilename(1, '');
  TestRunner.assertEquals(result, '01-.md', 'Should handle empty title');
});

// ============================================
// Test: collectAgentOutput
// ============================================

TestRunner.test('collectAgentOutput prefers result over assistant chunks', async () => {
  async function* mockStream() {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello ' }] } };
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'World' }] } };
    yield { type: 'result', subtype: 'success', result: '!' };
  }

  const result = await collectAgentOutput(mockStream());
  TestRunner.assertEquals(result, '!', 'Should prefer final result');
});

TestRunner.test('collectAgentOutput aggregates assistant messages when no result', async () => {
  async function* mockStream() {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello ' }] } };
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'World' }] } };
  }

  const result = await collectAgentOutput(mockStream());
  TestRunner.assertEquals(result, 'Hello World', 'Should concatenate assistant chunks');
});

TestRunner.test('collectAgentOutput handles empty stream', async () => {
  async function* emptyStream() {}
  const result = await collectAgentOutput(emptyStream());
  TestRunner.assertEquals(result, '', 'Should return empty string for empty stream');
});

// ============================================
// Test: planCourse with mock SDK
// ============================================

TestRunner.test('planCourse emits outline event with mock SDK', async () => {
  const events = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    const line = typeof chunk === 'string' ? chunk : chunk.toString();
    try {
      events.push(JSON.parse(line.trim()));
    } catch (e) {}
    return true;
  };

  await planCourse(mockSDK.query, {}, { goal: 'Test', level: 'intermediate', hours: 1 });

  process.stdout.write = originalWrite;

  const outlineEvent = events.find(e => e.type === 'outline');
  TestRunner.assertExists(outlineEvent, 'Should emit outline event');
  TestRunner.assert(outlineEvent.data.outline.chapters.length > 0, 'Should have chapters');
});

// ============================================
// Test: generateChapters with mock SDK
// ============================================

TestRunner.test('generateChapters writes files with mock SDK', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  // Create temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-generate-'));

  const events = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    const line = typeof chunk === 'string' ? chunk : chunk.toString();
    try {
      events.push(JSON.parse(line.trim()));
    } catch (e) {}
    return true;
  };

  const outline = {
    chapters: [
      { title: '第一章', duration_minutes: 20, concepts: ['A'] },
      { title: '第二章', duration_minutes: 25, concepts: ['B'] }
    ]
  };

  await generateChapters(mockSDK.query, {}, { project_path: tmpDir, outline });

  process.stdout.write = originalWrite;

  // Check files were written
  const files = fs.readdirSync(tmpDir);
  TestRunner.assert(files.includes('00-第一章.md'), 'Should write first chapter file');
  TestRunner.assert(files.includes('01-第二章.md'), 'Should write second chapter file');

  // Check content
  const content = fs.readFileSync(path.join(tmpDir, '00-第一章.md'), 'utf-8');
  TestRunner.assert(content.length > 100, 'Should have substantial content');
  TestRunner.assert(content.includes('[!concept]'), 'Should include concept blocks');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Check events
  const completeEvent = events.find(e => e.type === 'complete');
  TestRunner.assertExists(completeEvent, 'Should emit complete event');
});

// ============================================
// Test: generateChapters with chapter_indices (sliding-window)
// ============================================

TestRunner.test('generateChapters respects chapter_indices (sliding window)', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bridge-'));
  const events = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    const line = typeof chunk === 'string' ? chunk : chunk.toString();
    try { events.push(JSON.parse(line.trim())); } catch (e) {}
    return true;
  };

  const outline = {
    project_slug: 'sliding-test',
    chapters: [
      { title: '第一章 入门', duration_minutes: 10, concepts: ['A'] },
      { title: '第二章 进阶', duration_minutes: 20, concepts: ['B'] },
      { title: '第三章 实战', duration_minutes: 30, concepts: ['C'] },
      { title: '第四章 总结', duration_minutes: 10, concepts: ['D'] }
    ]
  };

  // Only request chapters 0 and 2 (sliding-window subset)
  await generateChapters(mockSDK.query, {}, {
    project_path: tmpDir,
    outline,
    chapter_indices: [0, 2]
  });

  process.stdout.write = originalWrite;

  // Only files for indices 0 and 2 should be on disk
  const files = fs.readdirSync(tmpDir);
  TestRunner.assert(files.includes('00-第一章-入门.md'), 'Should have chapter 0 file');
  TestRunner.assert(files.includes('02-第三章-实战.md'), 'Should have chapter 2 file');
  TestRunner.assert(!files.some(f => f.startsWith('01-')), 'Should NOT have chapter 1 file');
  TestRunner.assert(!files.some(f => f.startsWith('03-')), 'Should NOT have chapter 3 file');

  // Only 2 chapter_complete events should have been emitted
  const completeEvents = events.filter(e => e.type === 'chapter_complete');
  TestRunner.assertEquals(completeEvents.length, 2, 'Should emit exactly 2 chapter_complete events');
  TestRunner.assertEquals(completeEvents[0].data.index, 0, 'First complete event is index 0');
  TestRunner.assertEquals(completeEvents[1].data.index, 2, 'Second complete event is index 2');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================
// Test: checkAgentSDK
// ============================================

TestRunner.test('checkAgentSDK returns availability object', () => {
  const result = checkAgentSDK();
  TestRunner.assertExists(result, 'Should return a result object');
  TestRunner.assert(typeof result.available === 'boolean', 'Should have boolean available field');
  if (!result.available) {
    TestRunner.assertExists(result.error, 'Should include error when not available');
  }
});

// Run
console.log('Running Agent Bridge TDD tests...\n');

// ============================================
// Test: chatWithAgent (pure-function chat interface)
// ============================================

TestRunner.test('chatWithAgent throws on empty message', async () => {
  let threw = false;
  try {
    await chatWithAgent(mockSDK.query, {}, { article: 'x', history: [], message: '   ' });
  } catch (e) {
    threw = true;
  }
  TestRunner.assert(threw, 'Should throw when message is empty');
});

TestRunner.test('chatWithAgent returns assistant text from mock SDK', async () => {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  const out = await chatWithAgent(mockSDK.query, {}, {
    article: 'Attention is all you need.',
    history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    message: '能举个例子吗'
  });
  process.stdout.write = originalWrite;
  TestRunner.assert(typeof out === 'string' && out.length > 0, 'Should return non-empty string');
});

TestRunner.test('chatWithAgent uses custom systemPrompt when provided', async () => {
  let capturedPrompt = null;
  const fakeQuery = async ({ prompt }) => {
    capturedPrompt = prompt;
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: 'ok' };
    })();
  };
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  await chatWithAgent(fakeQuery, {}, {
    article: '',
    history: [],
    message: 'q',
    systemPrompt: 'CUSTOM-SYS-MARKER'
  });
  process.stdout.write = originalWrite;
  TestRunner.assert(capturedPrompt.includes('CUSTOM-SYS-MARKER'), 'Should pass through custom system prompt');
});

TestRunner.test('chatWithAgent has no internal state between calls (pure function)', async () => {
  let callCount = 0;
  const countingQuery = async () => (async function* () {
    callCount++;
    yield { type: 'result', subtype: 'success', result: 'reply ' + callCount };
  })();
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  const r1 = await chatWithAgent(countingQuery, {}, { article: 'a', history: [], message: 'q1' });
  const r2 = await chatWithAgent(countingQuery, {}, { article: 'a', history: [], message: 'q2' });
  process.stdout.write = originalWrite;
  TestRunner.assertEquals(callCount, 2, 'Each call should hit the engine once');
  TestRunner.assertEquals(r1, 'reply 1', 'First call should produce reply 1');
  TestRunner.assertEquals(r2, 'reply 2', 'Second call should produce reply 2');
});

TestRunner.run();
