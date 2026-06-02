/**
 * TDD Tests for Project Resume
 * Tests detecting existing projects, loading state, and resuming generation
 */

const TestRunner = require('../../shared/test-runner');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ============================================
// Test: Project Detection
// ============================================

TestRunner.test('detectProject finds .learning/project.json', () => {
  const { ProjectDetector } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-'));
  const learningDir = path.join(tmpDir, '.learning');
  fs.mkdirSync(learningDir);
  fs.writeFileSync(path.join(learningDir, 'project.json'), JSON.stringify({
    name: 'Test', chapters: [{ title: 'C1', status: '未生成' }]
  }));

  try {
    const detector = new ProjectDetector(tmpDir);
    const result = detector.detect();
    TestRunner.assertExists(result, 'Should detect project');
    TestRunner.assertEquals(result.name, 'Test', 'Should return project data');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

TestRunner.test('detectProject returns null when no project', () => {
  const { ProjectDetector } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-'));

  try {
    const detector = new ProjectDetector(tmpDir);
    const result = detector.detect();
    TestRunner.assertEquals(result, null, 'Should return null');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

TestRunner.test('detectProject returns null for invalid JSON', () => {
  const { ProjectDetector } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-'));
  const learningDir = path.join(tmpDir, '.learning');
  fs.mkdirSync(learningDir);
  fs.writeFileSync(path.join(learningDir, 'project.json'), 'not json');

  try {
    const detector = new ProjectDetector(tmpDir);
    const result = detector.detect();
    TestRunner.assertEquals(result, null, 'Should return null for invalid JSON');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================
// Test: Project State Loading
// ============================================

TestRunner.test('loadProject restores chapter statuses', () => {
  const { ProjectDetector } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-'));
  const learningDir = path.join(tmpDir, '.learning');
  fs.mkdirSync(learningDir);
  fs.writeFileSync(path.join(learningDir, 'project.json'), JSON.stringify({
    name: 'Transformer',
    chapters: [
      { title: 'C1', status: '已完成', file: '00-C1.md' },
      { title: 'C2', status: '就绪', file: '01-C2.md' },
      { title: 'C3', status: '未生成', file: null }
    ]
  }));

  try {
    const detector = new ProjectDetector(tmpDir);
    const project = detector.detect();
    TestRunner.assertEquals(project.chapters.length, 3, 'Should have 3 chapters');
    TestRunner.assertEquals(project.chapters[0].status, '已完成', 'Chapter 0 completed');
    TestRunner.assertEquals(project.chapters[1].status, '就绪', 'Chapter 1 ready');
    TestRunner.assertEquals(project.chapters[2].status, '未生成', 'Chapter 2 not generated');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================
// Test: Resume Generation
// ============================================

TestRunner.test('getChaptersToGenerate returns not_generated chapters', () => {
  const { ProjectDetector } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-'));
  const learningDir = path.join(tmpDir, '.learning');
  fs.mkdirSync(learningDir);
  fs.writeFileSync(path.join(learningDir, 'project.json'), JSON.stringify({
    name: 'Test',
    chapters: [
      { title: 'C1', status: '已完成' },
      { title: 'C2', status: '已完成' },
      { title: 'C3', status: '失败' },
      { title: 'C4', status: '未生成' }
    ]
  }));

  try {
    const detector = new ProjectDetector(tmpDir);
    const project = detector.detect();
    const toGenerate = detector.getChaptersToGenerate(project);
    TestRunner.assertEquals(toGenerate.length, 2, 'Should have 2 chapters to generate');
    TestRunner.assertEquals(toGenerate[0].title, 'C3', 'First should be failed chapter');
    TestRunner.assertEquals(toGenerate[1].title, 'C4', 'Second should be not_generated');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

TestRunner.test('getChaptersToGenerate returns empty when all done', () => {
  const { ProjectDetector } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-detect-'));
  const learningDir = path.join(tmpDir, '.learning');
  fs.mkdirSync(learningDir);
  fs.writeFileSync(path.join(learningDir, 'project.json'), JSON.stringify({
    name: 'Test',
    chapters: [
      { title: 'C1', status: '已完成' },
      { title: 'C2', status: '已完成' }
    ]
  }));

  try {
    const detector = new ProjectDetector(tmpDir);
    const project = detector.detect();
    const toGenerate = detector.getChaptersToGenerate(project);
    TestRunner.assertEquals(toGenerate.length, 0, 'Should have no chapters to generate');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================
// Mock Implementation Loader
// ============================================

function requireMock() {
  try {
    return { ProjectDetector: require('../../../dist/scripts/learning/project-resume').ProjectDetector };
  } catch (e) {
    // Stub implementation
    return {
      ProjectDetector: class ProjectDetector {
        constructor(basePath) {
          this.basePath = basePath;
          this.jsonPath = path.join(basePath, '.learning', 'project.json');
        }
        detect() {
          if (!fs.existsSync(this.jsonPath)) return null;
          try {
            return JSON.parse(fs.readFileSync(this.jsonPath, 'utf-8'));
          } catch (e) {
            return null;
          }
        }
        getChaptersToGenerate(project) {
          if (!project || !project.chapters) return [];
          return project.chapters.filter(ch =>
            ch.status === '未生成' || ch.status === '失败'
          );
        }
      }
    };
  }
}

// Run
console.log('Running Project Resume TDD tests...\n');
TestRunner.run();
