/**
 * TDD Tests for Progress Tracker
 * Tests chapter status machine, progress bar, agent-event handling
 */

const TestRunner = require('../../shared/test-runner');

// ============================================
// Mock: ChapterStatusManager (to be implemented)
// ============================================
// We test the CONTRACT first, then implement

// ============================================
// Test: Chapter Status Machine
// ============================================

TestRunner.test('ChapterStatusManager initializes all chapters as not_generated', () => {
  const chapters = [
    { title: '第一章', duration_minutes: 20 },
    { title: '第二章', duration_minutes: 25 }
  ];

  // CONTRACT: new ChapterStatusManager(chapters) → all statuses = 'not_generated'
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager(chapters);

  TestRunner.assertEquals(manager.getStatus(0), 'not_generated', 'Chapter 0 should be not_generated');
  TestRunner.assertEquals(manager.getStatus(1), 'not_generated', 'Chapter 1 should be not_generated');
});

TestRunner.test('ChapterStatusManager transitions: not_generated → generating', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setStatus(0, 'generating');
  TestRunner.assertEquals(manager.getStatus(0), 'generating', 'Should transition to generating');
});

TestRunner.test('ChapterStatusManager transitions: generating → ready', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setStatus(0, 'generating');
  manager.setStatus(0, 'ready');
  TestRunner.assertEquals(manager.getStatus(0), 'ready', 'Should transition to ready');
});

TestRunner.test('ChapterStatusManager transitions: ready → completed', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setStatus(0, 'generating');
  manager.setStatus(0, 'ready');
  manager.setStatus(0, 'completed');
  TestRunner.assertEquals(manager.getStatus(0), 'completed', 'Should transition to completed');
});

TestRunner.test('ChapterStatusManager transitions: generating → failed', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setStatus(0, 'generating');
  manager.setStatus(0, 'failed');
  TestRunner.assertEquals(manager.getStatus(0), 'failed', 'Should transition to failed');
});

TestRunner.test('ChapterStatusManager rejects invalid transitions', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  // Cannot go from not_generated directly to completed
  let threw = false;
  try {
    manager.setStatus(0, 'completed');
  } catch (e) {
    threw = true;
  }
  TestRunner.assert(threw, 'Should reject invalid transition not_generated → completed');
});

TestRunner.test('ChapterStatusManager throws on invalid chapter index', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  TestRunner.assertThrows(() => manager.getStatus(5), 'Should throw on out-of-bounds index');
  TestRunner.assertThrows(() => manager.getStatus(-1), 'Should throw on negative index');
});

// ============================================
// Test: Progress Calculation
// ============================================

TestRunner.test('getProgress returns correct counts', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([
    { title: 'C1' }, { title: 'C2' }, { title: 'C3' }, { title: 'C4' }
  ]);

  // C1: not_generated → generating → ready → completed
  manager.setStatus(0, 'generating');
  manager.setStatus(0, 'ready');
  manager.setStatus(0, 'completed');
  // C2: not_generated → generating → ready
  manager.setStatus(1, 'generating');
  manager.setStatus(1, 'ready');
  // C3: not_generated → generating
  manager.setStatus(2, 'generating');
  // C4: stays not_generated

  const progress = manager.getProgress();
  TestRunner.assertEquals(progress.total, 4, 'Total should be 4');
  TestRunner.assertEquals(progress.completed, 1, 'Completed should be 1');
  TestRunner.assertEquals(progress.ready, 1, 'Ready should be 1');
  TestRunner.assertEquals(progress.generating, 1, 'Generating should be 1');
  TestRunner.assertEquals(progress.not_generated, 1, 'Not generated should be 1');
  TestRunner.assertEquals(progress.failed, 0, 'Failed should be 0');
});

TestRunner.test('getProgressPercentage returns 0-100', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }, { title: 'C2' }]);

  TestRunner.assertEquals(manager.getProgressPercentage(), 0, 'Initial progress should be 0%');

  manager.setStatus(0, 'generating');
  manager.setStatus(0, 'ready');
  manager.setStatus(0, 'completed');
  TestRunner.assertEquals(manager.getProgressPercentage(), 50, 'After 1/2 completed should be 50%');

  manager.setStatus(1, 'generating');
  manager.setStatus(1, 'ready');
  manager.setStatus(1, 'completed');
  TestRunner.assertEquals(manager.getProgressPercentage(), 100, 'After 2/2 completed should be 100%');
});

// ============================================
// Test: Agent Event Handling
// ============================================

TestRunner.test('handleAgentEvent updates status on progress event', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }, { title: 'C2' }]);

  manager.handleAgentEvent({ type: 'progress', data: { current: 1, total: 2, status: 'generating' } });
  TestRunner.assertEquals(manager.getStatus(0), 'generating', 'Chapter 0 should be generating');
});

TestRunner.test('handleAgentEvent updates status on chapter_complete event', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setStatus(0, 'generating');
  manager.handleAgentEvent({ type: 'chapter_complete', data: { index: 0, file: '00-C1.md' } });
  TestRunner.assertEquals(manager.getStatus(0), 'ready', 'Chapter should be ready after completion');
});

TestRunner.test('handleAgentEvent updates status on chapter_failed event', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setStatus(0, 'generating');
  manager.handleAgentEvent({ type: 'chapter_failed', data: { index: 0, error: 'timeout' } });
  TestRunner.assertEquals(manager.getStatus(0), 'failed', 'Chapter should be failed');
});

TestRunner.test('handleAgentEvent does nothing for unknown event types', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.handleAgentEvent({ type: 'unknown', data: {} });
  TestRunner.assertEquals(manager.getStatus(0), 'not_generated', 'Status should be unchanged');
});

// ============================================
// Test: Pre-generation Logic
// ============================================

TestRunner.test('getNextToGenerate returns first not_generated chapter', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }, { title: 'C2' }, { title: 'C3' }]);

  manager.setStatus(0, 'generating');
  manager.setStatus(0, 'ready');
  manager.setStatus(0, 'completed');
  manager.setStatus(1, 'generating');
  manager.setStatus(1, 'ready');

  const next = manager.getNextToGenerate();
  TestRunner.assertEquals(next, 2, 'Should return index 2');
});

TestRunner.test('getNextToGenerate returns null when all done', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setStatus(0, 'generating');
  manager.setStatus(0, 'ready');
  manager.setStatus(0, 'completed');
  const next = manager.getNextToGenerate();
  TestRunner.assertEquals(next, null, 'Should return null when all completed');
});

TestRunner.test('canRetry returns true for failed chapters', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setStatus(0, 'generating');
  manager.setStatus(0, 'failed');
  TestRunner.assert(manager.canRetry(0), 'Should be able to retry failed chapter');
});

TestRunner.test('canRetry returns false for non-failed chapters', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  TestRunner.assert(!manager.canRetry(0), 'Should not be able to retry not_generated chapter');
});

// ============================================
// Test: Chapter Files Mapping
// ============================================

TestRunner.test('getChapterFile returns stored filename', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: '注意力机制' }]);

  manager.setChapterFile(0, '00-注意力机制.md');
  const file = manager.getChapterFile(0);
  TestRunner.assert(file.includes('注意力机制'), 'Filename should include chapter title');
  TestRunner.assert(file.endsWith('.md'), 'Filename should end with .md');
});

TestRunner.test('setChapterFile stores file path', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setChapterFile(0, '00-C1.md');
  TestRunner.assertEquals(manager.getChapterFile(0), '00-C1.md', 'Should store and retrieve file');
});

// ============================================
// Test: Retry state machine (Sprint log-verbosity + retry-fix regression)
// ============================================

TestRunner.test('failed → not_generated is a valid transition (for retry reset)', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setStatus(0, 'generating');
  manager.setStatus(0, 'failed');
  // The retry handler resets failed back to not_generated so the sliding
  // window will pick it up. Without this transition the retry button is
  // a silent no-op.
  manager.setStatus(0, 'not_generated');
  TestRunner.assertEquals(manager.getStatus(0), 'not_generated',
    'failed should be allowed to go back to not_generated for retry');
});

TestRunner.test('completed → not_generated is NOT valid (no infinite retry loop)', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);

  manager.setStatus(0, 'generating');
  manager.setStatus(0, 'ready');
  manager.setStatus(0, 'completed');
  TestRunner.assertThrows(
    () => manager.setStatus(0, 'not_generated'),
    'Should reject retry on already-completed chapter'
  );
});

TestRunner.test('not_generated → not_generated is NOT valid (no-op safety)', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }]);
  TestRunner.assertThrows(
    () => manager.setStatus(0, 'not_generated'),
    'Should reject same-state transition'
  );
});

TestRunner.test('full retry flow: failed → not_generated → generating → ready works end-to-end', () => {
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'C1' }, { title: 'C2' }]);

  // First attempt: chapter 1 fails
  manager.setStatus(1, 'generating');
  manager.setStatus(1, 'failed');
  TestRunner.assertEquals(manager.getStatus(1), 'failed');

  // User clicks retry
  manager.setStatus(1, 'not_generated');
  TestRunner.assertEquals(manager.getStatus(1), 'not_generated',
    'After retry click, chapter should be back in the queue');

  // Sliding window picks it up
  manager.setStatus(1, 'generating');
  manager.setStatus(1, 'ready');
  TestRunner.assertEquals(manager.getStatus(1), 'ready',
    'Chapter should complete successfully on second attempt');
});

// ============================================
// Mock Implementation Loader
// ============================================

function requireMock() {
  // Use real implementation
  return { ChapterStatusManager: require('../../../dist/scripts/learning/progress-tracker').ChapterStatusManager };
}

// Regression (2026-08-04): chapter_complete must normalize the bridge's bare
// filename into a full path via the ui binding (AgentEventBridge sets
// manager.ui). Without it, post-generation clicks hit "File not found".
TestRunner.test('chapter_complete normalizes bare filename via manager.ui.projectPath', () => {
  if (typeof window === 'undefined') global.window = {};
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'A' }]);
  manager.ui = { projectPath: 'C:\\proj' };
  manager.handleAgentEvent({ type: 'chapter_complete', data: { index: 0, file: '00-A.md' } });
  TestRunner.assertEquals(manager.chapters[0].file, 'C:\\proj\\00-A.md', 'file joined with projectPath');
});

TestRunner.test('chapter_complete keeps absolute file unchanged', () => {
  if (typeof window === 'undefined') global.window = {};
  const { ChapterStatusManager } = requireMock();
  const manager = new ChapterStatusManager([{ title: 'A' }]);
  manager.ui = { projectPath: 'C:\\proj' };
  manager.handleAgentEvent({ type: 'chapter_complete', data: { index: 0, file: 'D:\\other\\00-A.md' } });
  TestRunner.assertEquals(manager.chapters[0].file, 'D:\\other\\00-A.md', 'absolute path untouched');
});

// Run
console.log('Running Progress Tracker TDD tests...\n');
TestRunner.run();
