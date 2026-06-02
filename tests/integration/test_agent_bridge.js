/**
 * Integration Test: Agent Bridge with Mock SDK
 * Tests the full plan → generate flow without real API calls
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const TestRunner = require('../unit/test-runner');
const {
  planCourse,
  generateChapters
} = require('../../agent-bridge');

const mockSDK = require('../mock-agent-sdk');

// Capture stdout events
function captureEvents(fn) {
  const events = [];
  const originalLog = console.log;
  console.log = (line) => {
    try {
      events.push(JSON.parse(line));
    } catch (e) {}
  };

  return fn().then(() => {
    console.log = originalLog;
    return events;
  }).catch(e => {
    console.log = originalLog;
    throw e;
  });
}

// ============================================
// Integration: Full Learning Project Flow
// ============================================

TestRunner.test('Integration: plan course generates valid outline', async () => {
  const events = await captureEvents(() =>
    planCourse(mockSDK.query, {}, { goal: '理解 Transformer', level: 'intermediate', hours: 3 })
  );

  const statusEvent = events.find(e => e.type === 'status');
  TestRunner.assertExists(statusEvent, 'Should emit status event');

  const outlineEvent = events.find(e => e.type === 'outline');
  TestRunner.assertExists(outlineEvent, 'Should emit outline event');

  const outline = outlineEvent.data.outline;
  TestRunner.assert(outline.chapters.length > 0, 'Should have chapters');
  TestRunner.assertExists(outline.total_duration, 'Should have total_duration');

  // Validate chapter structure
  outline.chapters.forEach((ch, i) => {
    TestRunner.assertExists(ch.title, `Chapter ${i} should have title`);
    TestRunner.assert(typeof ch.duration_minutes === 'number', `Chapter ${i} should have numeric duration`);
    TestRunner.assert(Array.isArray(ch.concepts), `Chapter ${i} should have concepts array`);
  });
});

TestRunner.test('Integration: generate chapters writes all files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-integration-'));

  const outline = {
    chapters: [
      { title: '第一章：基础概念', duration_minutes: 20, concepts: ['A', 'B'] },
      { title: '第二章：进阶内容', duration_minutes: 25, concepts: ['C', 'D'] },
      { title: '第三章：实战应用', duration_minutes: 30, concepts: ['E'] }
    ]
  };

  const events = await captureEvents(() =>
    generateChapters(mockSDK.query, {}, { project_path: tmpDir, outline })
  );

  // Check progress events
  const progressEvents = events.filter(e => e.type === 'progress');
  TestRunner.assertEquals(progressEvents.length, 3, 'Should emit 3 progress events');

  // Check chapter_complete events
  const completeEvents = events.filter(e => e.type === 'chapter_complete');
  TestRunner.assertEquals(completeEvents.length, 3, 'Should emit 3 chapter_complete events');

  // Check complete event
  const finalEvent = events.find(e => e.type === 'complete');
  TestRunner.assertExists(finalEvent, 'Should emit complete event');
  TestRunner.assertEquals(finalEvent.data.total_generated, 3, 'Should generate 3 chapters');

  // Verify files exist
  const files = fs.readdirSync(tmpDir);
  TestRunner.assert(files.includes('00-第一章-基础概念.md'), 'First chapter file should exist');
  TestRunner.assert(files.includes('01-第二章-进阶内容.md'), 'Second chapter file should exist');
  TestRunner.assert(files.includes('02-第三章-实战应用.md'), 'Third chapter file should exist');

  // Verify file content
  const content = fs.readFileSync(path.join(tmpDir, '00-第一章-基础概念.md'), 'utf-8');
  TestRunner.assert(content.includes('#'), 'Content should have Markdown heading');
  TestRunner.assert(content.length > 50, 'Content should be substantial');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

TestRunner.test('Integration: generate chapters handles empty outline', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-empty-'));

  const events = await captureEvents(() =>
    generateChapters(mockSDK.query, {}, { project_path: tmpDir, outline: { chapters: [] } })
  );

  const finalEvent = events.find(e => e.type === 'complete');
  TestRunner.assertExists(finalEvent, 'Should emit complete event');
  TestRunner.assertEquals(finalEvent.data.total_generated, 0, 'Should generate 0 chapters');

  const files = fs.readdirSync(tmpDir);
  TestRunner.assertEquals(files.length, 0, 'Should create no files');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Run
console.log('Running Integration Tests...\n');
TestRunner.run();
