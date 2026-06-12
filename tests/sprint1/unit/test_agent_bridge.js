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
  checkAgentSDK
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
    yield { type: 'assistant', content: 'Hello ' };
    yield { type: 'assistant', content: 'World' };
    yield { type: 'result', subtype: 'success', result: '!' };
  }

  const result = await collectAgentOutput(mockStream());
  TestRunner.assertEquals(result, '!', 'Should prefer final result');
});

TestRunner.test('collectAgentOutput aggregates assistant messages when no result', async () => {
  async function* mockStream() {
    yield { type: 'assistant', content: 'Hello ' };
    yield { type: 'assistant', content: 'World' };
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
TestRunner.run();
