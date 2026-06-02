/**
 * TDD Tests for Learning Renderer
 * Tests learning mode detection, header bar, chapter navigation
 */

const TestRunner = require('./test-runner');

// ============================================
// Test: Learning Mode Detection
// ============================================

TestRunner.test('isLearningMode returns true when project.json exists', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  // Mock: project.json exists
  renderer._projectExists = true;
  TestRunner.assert(renderer.isLearningMode(), 'Should detect learning mode');
});

TestRunner.test('isLearningMode returns false when no project.json', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer._projectExists = false;
  TestRunner.assert(!renderer.isLearningMode(), 'Should not be in learning mode');
});

// ============================================
// Test: Header Bar Rendering
// ============================================

TestRunner.test('renderHeader returns correct structure', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Transformer 学习',
    chapters: [
      { title: '注意力机制', status: 'completed' },
      { title: 'Self-Attention', status: 'ready' },
      { title: '多头注意力', status: 'not_generated' }
    ],
    currentChapter: 1
  });

  const header = renderer.renderHeader();
  TestRunner.assertExists(header, 'Header should exist');
  TestRunner.assert(header.includes('Transformer 学习'), 'Should include project name');
  TestRunner.assert(header.includes('2/3'), 'Should show current/total chapters');
});

TestRunner.test('renderHeader shows chapter duration', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Test',
    chapters: [
      { title: 'C1', duration_minutes: 25, status: 'ready' }
    ],
    currentChapter: 0
  });

  const header = renderer.renderHeader();
  TestRunner.assert(header.includes('25'), 'Should show duration');
});

TestRunner.test('renderHeader shows completion mark for completed chapters', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Test',
    chapters: [{ title: 'C1', status: 'completed' }],
    currentChapter: 0
  });

  const header = renderer.renderHeader();
  TestRunner.assert(header.includes('✓') || header.includes('完成'), 'Should show completion mark');
});

// ============================================
// Test: Chapter Navigation
// ============================================

TestRunner.test('getNextChapter returns next chapter index', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Test',
    chapters: [
      { title: 'C1', status: 'completed' },
      { title: 'C2', status: 'ready' },
      { title: 'C3', status: 'not_generated' }
    ],
    currentChapter: 0
  });

  const next = renderer.getNextChapter();
  TestRunner.assertEquals(next, 1, 'Next chapter should be index 1');
});

TestRunner.test('getNextChapter returns null at last chapter', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Test',
    chapters: [{ title: 'C1', status: 'completed' }],
    currentChapter: 0
  });

  const next = renderer.getNextChapter();
  TestRunner.assertEquals(next, null, 'Should return null at end');
});

TestRunner.test('getPrevChapter returns previous chapter index', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Test',
    chapters: [
      { title: 'C1', status: 'completed' },
      { title: 'C2', status: 'ready' }
    ],
    currentChapter: 1
  });

  const prev = renderer.getPrevChapter();
  TestRunner.assertEquals(prev, 0, 'Prev chapter should be index 0');
});

TestRunner.test('getPrevChapter returns null at first chapter', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Test',
    chapters: [{ title: 'C1', status: 'ready' }],
    currentChapter: 0
  });

  const prev = renderer.getPrevChapter();
  TestRunner.assertEquals(prev, null, 'Should return null at start');
});

TestRunner.test('canOpenChapter returns true for ready/completed chapters', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Test',
    chapters: [
      { title: 'C1', status: 'completed' },
      { title: 'C2', status: 'ready' },
      { title: 'C3', status: 'generating' },
      { title: 'C4', status: 'not_generated' }
    ],
    currentChapter: 0
  });

  TestRunner.assert(renderer.canOpenChapter(0), 'Completed chapter should be openable');
  TestRunner.assert(renderer.canOpenChapter(1), 'Ready chapter should be openable');
  TestRunner.assert(!renderer.canOpenChapter(2), 'Generating chapter should not be openable');
  TestRunner.assert(!renderer.canOpenChapter(3), 'Not generated chapter should not be openable');
});

// ============================================
// Test: Chapter Content Loading
// ============================================

TestRunner.test('loadChapter sets current chapter index', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Test',
    chapters: [
      { title: 'C1', status: 'completed', file: '00-C1.md' },
      { title: 'C2', status: 'ready', file: '01-C2.md' }
    ],
    currentChapter: 0
  });

  renderer.loadChapter(1);
  TestRunner.assertEquals(renderer.getCurrentChapter(), 1, 'Current chapter should be 1');
});

TestRunner.test('loadChapter throws for non-openable chapter', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Test',
    chapters: [{ title: 'C1', status: 'generating' }],
    currentChapter: 0
  });

  TestRunner.assertThrows(() => renderer.loadChapter(0), 'Should throw for generating chapter');
});

// ============================================
// Test: Mark Chapter Complete
// ============================================

TestRunner.test('markComplete changes status to completed', () => {
  const { LearningRenderer } = requireMock();
  const renderer = new LearningRenderer();

  renderer.setProject({
    name: 'Test',
    chapters: [{ title: 'C1', status: 'ready' }],
    currentChapter: 0
  });

  renderer.markComplete(0);
  TestRunner.assertEquals(renderer.getProject().chapters[0].status, 'completed', 'Should be completed');
});

// ============================================
// Mock Implementation Loader
// ============================================

function requireMock() {
  // Use real implementation
  return { LearningRenderer: require('../../dist/scripts/learning/learning-renderer').LearningRenderer };
}

// Run
console.log('Running Learning Renderer TDD tests...\n');
TestRunner.run();
