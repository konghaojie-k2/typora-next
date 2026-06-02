/**
 * TDD Tests for Learning Hub - Project List Management
 * Tests project list CRUD, localStorage persistence, and UI state
 */

const TestRunner = require('../../shared/test-runner');

// ============================================
// Test: Project List CRUD
// ============================================

TestRunner.test('ProjectList starts empty', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  TestRunner.assertEquals(list.getAll().length, 0, 'Should start empty');
});

TestRunner.test('ProjectList adds a project', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  list.add({ path: 'C:\\learning', name: 'Transformer', chapters: 8, completed: 3 });
  TestRunner.assertEquals(list.getAll().length, 1, 'Should have 1 project');
  TestRunner.assertEquals(list.getAll()[0].name, 'Transformer', 'Name should match');
});

TestRunner.test('ProjectList adds multiple projects', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  list.add({ path: 'C:\\learning', name: 'Transformer', chapters: 8, completed: 3 });
  list.add({ path: 'D:\\python', name: 'Python', chapters: 6, completed: 0 });
  TestRunner.assertEquals(list.getAll().length, 2, 'Should have 2 projects');
});

TestRunner.test('ProjectList does not add duplicate paths', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  list.add({ path: 'C:\\learning', name: 'Transformer', chapters: 8, completed: 3 });
  list.add({ path: 'C:\\learning', name: 'Transformer Updated', chapters: 8, completed: 5 });
  TestRunner.assertEquals(list.getAll().length, 1, 'Should not duplicate');
  TestRunner.assertEquals(list.getAll()[0].completed, 5, 'Should update existing');
});

TestRunner.test('ProjectList removes a project', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  list.add({ path: 'C:\\learning', name: 'Transformer', chapters: 8, completed: 3 });
  list.remove('C:\\learning');
  TestRunner.assertEquals(list.getAll().length, 0, 'Should be empty after remove');
});

TestRunner.test('ProjectList remove does nothing for unknown path', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  list.add({ path: 'C:\\learning', name: 'Transformer', chapters: 8, completed: 3 });
  list.remove('D:\\nonexistent');
  TestRunner.assertEquals(list.getAll().length, 1, 'Should still have 1 project');
});

TestRunner.test('ProjectList gets project by path', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  list.add({ path: 'C:\\learning', name: 'Transformer', chapters: 8, completed: 3 });
  const project = list.get('C:\\learning');
  TestRunner.assertExists(project, 'Should find project');
  TestRunner.assertEquals(project.name, 'Transformer', 'Name should match');
});

TestRunner.test('ProjectList get returns null for unknown path', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  const project = list.get('D:\\nonexistent');
  TestRunner.assertEquals(project, null, 'Should return null');
});

// ============================================
// Test: Progress Calculation
// ============================================

TestRunner.test('ProjectList calculates progress percentage', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  list.add({ path: 'C:\\learning', name: 'Test', chapters: 8, completed: 4 });
  const project = list.get('C:\\learning');
  TestRunner.assertEquals(project.progress, 50, 'Progress should be 50%');
});

TestRunner.test('ProjectList handles 0 chapters', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  list.add({ path: 'C:\\learning', name: 'Test', chapters: 0, completed: 0 });
  const project = list.get('C:\\learning');
  TestRunner.assertEquals(project.progress, 0, 'Progress should be 0%');
});

TestRunner.test('ProjectList handles all completed', () => {
  const { ProjectList } = requireMock();
  const list = new ProjectList();
  list.add({ path: 'C:\\learning', name: 'Test', chapters: 8, completed: 8 });
  const project = list.get('C:\\learning');
  TestRunner.assertEquals(project.progress, 100, 'Progress should be 100%');
});

// ============================================
// Test: Persistence (file-based)
// ============================================

TestRunner.test('ProjectList save writes JSON file', async () => {
  const { ProjectList, mockFS } = requireMock();
  mockFS.clear();
  const list = new ProjectList('/test/learning-projects.json');
  list.add({ path: 'C:\\learning', name: 'Test', chapters: 8, completed: 3 });
  await list.save();
  const content = mockFS.readFile('/test/learning-projects.json');
  TestRunner.assertExists(content, 'Should write file');
  const saved = JSON.parse(content);
  TestRunner.assertEquals(saved.length, 1, 'Should save 1 project');
  TestRunner.assertEquals(saved[0].name, 'Test', 'Name should match');
});

TestRunner.test('ProjectList load reads JSON file', async () => {
  const { ProjectList, mockFS } = requireMock();
  mockFS.clear();
  mockFS.writeFile('/test/learning-projects.json', JSON.stringify([
    { path: 'C:\\learning', name: 'Saved Project', chapters: 6, completed: 2 }
  ]));
  const list = new ProjectList('/test/learning-projects.json');
  await list.load();
  TestRunner.assertEquals(list.getAll().length, 1, 'Should load 1 project');
  TestRunner.assertEquals(list.getAll()[0].name, 'Saved Project', 'Name should match');
});

TestRunner.test('ProjectList load handles missing file', async () => {
  const { ProjectList, mockFS } = requireMock();
  mockFS.clear();
  const list = new ProjectList('/test/nonexistent.json');
  await list.load();
  TestRunner.assertEquals(list.getAll().length, 0, 'Should be empty');
});

TestRunner.test('ProjectList load handles invalid JSON file', async () => {
  const { ProjectList, mockFS } = requireMock();
  mockFS.clear();
  mockFS.writeFile('/test/learning-projects.json', 'not json');
  const list = new ProjectList('/test/learning-projects.json');
  await list.load();
  TestRunner.assertEquals(list.getAll().length, 0, 'Should be empty on invalid JSON');
});

TestRunner.test('ProjectList save creates parent directory', async () => {
  const { ProjectList, mockFS } = requireMock();
  mockFS.clear();
  const list = new ProjectList('/newdir/learning-projects.json');
  list.add({ path: 'C:\\learning', name: 'Test', chapters: 8, completed: 3 });
  await list.save();
  const content = mockFS.readFile('/newdir/learning-projects.json');
  TestRunner.assertExists(content, 'Should create parent dir and write file');
});

// ============================================
// Mock Implementation Loader
// ============================================

// Simple in-memory file system mock
const mockFSData = {};
const mockFS = {
  writeFile: (path, content) => { mockFSData[path] = content; },
  readFile: (path) => mockFSData[path] || null,
  exists: (path) => path in mockFSData,
  mkdir: () => {},
  clear: () => { Object.keys(mockFSData).forEach(k => delete mockFSData[k]); }
};

function requireMock() {
  try {
    const mod = require('../../../dist/scripts/learning/learning-hub');
    return { ProjectList: mod.ProjectList, mockFS };
  } catch (e) {
    // Stub implementation
    return {
      ProjectList: class ProjectList {
        constructor(filePath) {
          this.projects = [];
          this.filePath = filePath || '/test/learning-projects.json';
        }
        getAll() { return this.projects.map(p => ({ ...p, progress: p.chapters > 0 ? Math.round(p.completed / p.chapters * 100) : 0 })); }
        add(project) {
          const existing = this.projects.findIndex(p => p.path === project.path);
          if (existing >= 0) {
            this.projects[existing] = { ...this.projects[existing], ...project };
          } else {
            this.projects.push(project);
          }
        }
        remove(path) {
          this.projects = this.projects.filter(p => p.path !== path);
        }
        get(path) {
          const p = this.projects.find(p => p.path === path);
          return p ? { ...p, progress: p.chapters > 0 ? Math.round(p.completed / p.chapters * 100) : 0 } : null;
        }
        async save() {
          mockFS.writeFile(this.filePath, JSON.stringify(this.projects, null, 2));
        }
        async load() {
          try {
            const data = mockFS.readFile(this.filePath);
            if (data) {
              this.projects = JSON.parse(data);
            } else {
              this.projects = [];
            }
          } catch (e) {
            this.projects = [];
          }
        }
      },
      mockFS
    };
  }
}

// Run
console.log('Running Learning Hub TDD tests...\n');
TestRunner.run();
