/**
 * TDD Tests for Project Folder Creation
 * Tests .learning/project.json creation and chapter status initialization
 */

const TestRunner = require('../../shared/test-runner');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ============================================
// Test: Project Structure Creation
// ============================================

TestRunner.test('createProjectFolder creates .learning directory', () => {
  const { ProjectFolder } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-project-'));

  try {
    const pf = new ProjectFolder(tmpDir);
    pf.create({ chapters: [{ title: 'C1', duration_minutes: 20 }] });

    TestRunner.assert(fs.existsSync(path.join(tmpDir, '.learning')), '.learning dir should exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

TestRunner.test('createProjectFolder creates project.json with correct structure', () => {
  const { ProjectFolder } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-project-'));

  try {
    const pf = new ProjectFolder(tmpDir);
    const outline = {
      chapters: [
        { title: '注意力机制', duration_minutes: 20, concepts: ['注意力'] },
        { title: 'Self-Attention', duration_minutes: 25, concepts: ['QKV'] }
      ],
      total_duration: 45
    };
    pf.create(outline);

    const jsonPath = path.join(tmpDir, '.learning', 'project.json');
    TestRunner.assert(fs.existsSync(jsonPath), 'project.json should exist');

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    TestRunner.assertEquals(data.name, '注意力机制', 'Project name should be first chapter title or goal');
    TestRunner.assert(Array.isArray(data.chapters), 'Should have chapters array');
    TestRunner.assertEquals(data.chapters.length, 2, 'Should have 2 chapters');
    TestRunner.assertEquals(data.chapters[0].title, '注意力机制', 'Chapter title should match');
    TestRunner.assertEquals(data.chapters[0].status, 'not_generated', 'Initial status should be not_generated');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

TestRunner.test('createProjectFolder stores outline metadata', () => {
  const { ProjectFolder } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-project-'));

  try {
    const pf = new ProjectFolder(tmpDir);
    pf.create({
      chapters: [{ title: 'C1', duration_minutes: 20, concepts: ['A'] }],
      total_duration: 20
    });

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.learning', 'project.json'), 'utf-8'));
    TestRunner.assertEquals(data.chapters[0].duration_minutes, 20, 'Duration should be stored');
    TestRunner.assert(Array.isArray(data.chapters[0].concepts), 'Concepts should be stored');
    TestRunner.assertEquals(data.chapters[0].concepts[0], 'A', 'Concept value should match');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

TestRunner.test('createProjectFolder does not overwrite existing project.json', () => {
  const { ProjectFolder } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-project-'));

  try {
    const pf = new ProjectFolder(tmpDir);
    pf.create({ chapters: [{ title: 'C1' }] });

    // Modify the file
    const jsonPath = path.join(tmpDir, '.learning', 'project.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    data.chapters[0].status = 'completed';
    fs.writeFileSync(jsonPath, JSON.stringify(data));

    // Create again - should not overwrite
    pf.create({ chapters: [{ title: 'C1' }] });
    const data2 = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    TestRunner.assertEquals(data2.chapters[0].status, 'completed', 'Should not overwrite existing project');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================
// Test: Project Loading
// ============================================

TestRunner.test('loadProject reads existing project.json', () => {
  const { ProjectFolder } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-project-'));

  try {
    const pf = new ProjectFolder(tmpDir);
    pf.create({ chapters: [{ title: 'C1', duration_minutes: 20 }] });

    const project = pf.load();
    TestRunner.assertExists(project, 'Project should be loaded');
    TestRunner.assertEquals(project.chapters.length, 1, 'Should have 1 chapter');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

TestRunner.test('loadProject returns null when no project.json', () => {
  const { ProjectFolder } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-project-'));

  try {
    const pf = new ProjectFolder(tmpDir);
    const project = pf.load();
    TestRunner.assertEquals(project, null, 'Should return null');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================
// Test: Project Update
// ============================================

TestRunner.test('updateChapterStatus modifies project.json', () => {
  const { ProjectFolder } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-project-'));

  try {
    const pf = new ProjectFolder(tmpDir);
    pf.create({ chapters: [{ title: 'C1' }, { title: 'C2' }] });

    pf.updateChapterStatus(0, 'ready', '00-C1.md');

    const project = pf.load();
    TestRunner.assertEquals(project.chapters[0].status, 'ready', 'Status should be updated');
    TestRunner.assertEquals(project.chapters[0].file, '00-C1.md', 'File should be stored');
    TestRunner.assertEquals(project.chapters[1].status, 'not_generated', 'Other chapter unchanged');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

TestRunner.test('updateChapterStatus throws on invalid index', () => {
  const { ProjectFolder } = requireMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-project-'));

  try {
    const pf = new ProjectFolder(tmpDir);
    pf.create({ chapters: [{ title: 'C1' }] });

    TestRunner.assertThrows(() => pf.updateChapterStatus(5, 'ready'), 'Should throw on out-of-bounds');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================
// Mock Implementation Loader
// ============================================

function requireMock() {
  return { ProjectFolder: require('../../../dist/scripts/learning/project-folder').ProjectFolder };
}

// Run
console.log('Running Project Folder TDD tests...\n');
TestRunner.run();
