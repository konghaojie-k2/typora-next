/**
 * Real-filesystem mock for Tauri API
 * Uses Node.js fs instead of memory stubs
 * Validates actual file creation, path handling, JSON serialization
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Global window for frontend modules
global.window = global.window || {};

// ============================================
// Mock Tauri Core API (invoke)
// ============================================
const mockInvoke = async (cmd, args) => {
  switch (cmd) {
    case 'create_learning_project':
      return _createLearningProject(args);
    case 'open_folder_dialog':
      return _openFolderDialog(args);
    case 'open_file':
      return _openFile(args);
    case 'list_directory':
      return _listDirectory(args);
    case 'generate_chapters':
      return _generateChapters(args);
    case 'plan_course':
      return _planCourse(args);
    case 'persist_quiz_result':
      return _persistQuizResult(args);
    default:
      throw new Error(`Mock invoke not implemented: ${cmd}`);
  }
};

function _createLearningProject({ projectPath, outline, goal }) {
  const learningDir = path.join(projectPath, '.learning');
  const jsonPath = path.join(learningDir, 'project.json');

  fs.mkdirSync(learningDir, { recursive: true });

  const chapters = outline.chapters.map((ch, i) => ({
    title: ch.title || `第 ${i + 1} 章`,
    duration_minutes: ch.duration_minutes || 0,
    concepts: ch.concepts || [],
    status: 'not_generated',
    file: null
  }));

  const project = {
    name: goal || outline.chapters[0]?.title || 'Learning Project',
    created: Date.now(),
    chapters,
    total_duration: outline.total_duration || chapters.reduce((s, c) => s + c.duration_minutes, 0)
  };

  fs.writeFileSync(jsonPath, JSON.stringify(project, null, 2), 'utf-8');
  return jsonPath;
}

function _openFolderDialog() {
  // Return a test temp directory path
  return global.__TEST_FOLDER_DIALOG__ || null;
}

function _openFile({ path: filePath }) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return {
    path: filePath,
    content,
    base_dir: path.dirname(filePath)
  };
}

function _listDirectory({ path: dirPath }) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.map(e => ({
    name: e.name,
    path: path.join(dirPath, e.name),
    is_dir: e.isDirectory()
  }));
}

function _generateChapters({ projectPath, outline }) {
  // Simulate chapter generation by creating dummy .md files
  const chapters = outline.chapters || [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const safeTitle = (ch.title || '')
      .replace(/[^一-龥a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const filename = `${String(i).padStart(2, '0')}-${safeTitle}.md`;
    const filepath = path.join(projectPath, filename);

    // Create a dummy markdown file
    fs.writeFileSync(filepath, `# ${ch.title}\n\nTest content for chapter ${i + 1}.\n`, 'utf-8');

    // Update project.json
    const jsonPath = path.join(projectPath, '.learning', 'project.json');
    if (fs.existsSync(jsonPath)) {
      const project = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (project.chapters[i]) {
        project.chapters[i].status = 'ready';
        project.chapters[i].file = filename;
      }
      fs.writeFileSync(jsonPath, JSON.stringify(project, null, 2), 'utf-8');
    }
  }
  return { generated: chapters.length };
}

function _planCourse({ goal, level, hours }) {
  // Return a mock outline immediately
  return { status: 'planning' };
}

function _persistQuizResult({ projectPath, chapterFile, rating, score, weakConcepts, answers, timestamp }) {
  const learningDir = path.join(projectPath, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });

  // Update project.json
  const projectJsonPath = path.join(learningDir, 'project.json');
  let project = { name: 'Test', chapters: [], concepts: {} };
  if (fs.existsSync(projectJsonPath)) {
    project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
  }

  const basename = path.basename(chapterFile);
  if (project.chapters) {
    project.chapters.forEach(ch => {
      if (ch.file === basename || ch.file === chapterFile) {
        ch.status = 'completed';
        ch.last_quiz_rating = rating;
        ch.last_quiz_at = timestamp;
      }
    });
  }

  project.concepts = project.concepts || {};
  (weakConcepts || []).forEach(c => {
    project.concepts[c] = { status: rating === 'struggling' ? 'struggling' : 'learning', source_chapter: basename };
  });

  fs.writeFileSync(projectJsonPath, JSON.stringify(project, null, 2), 'utf-8');

  // Append to quiz-history.json
  const historyPath = path.join(learningDir, 'quiz-history.json');
  let history = { version: '1.0', entries: [] };
  if (fs.existsSync(historyPath)) {
    history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
  }
  history.entries.push({
    chapter_file: basename,
    timestamp,
    score,
    rating,
    weak_concepts: weakConcepts || [],
    answers: answers || []
  });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');

  return true;
}

// ============================================
// Mock Tauri FS API (read/write/exists/mkdir)
// ============================================
const mockFS = {
  writeTextFile: async (filePath, contents) => {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf-8');
  },
  readTextFile: async (filePath) => {
    return fs.readFileSync(filePath, 'utf-8');
  },
  exists: async (filePath) => {
    return fs.existsSync(filePath);
  },
  mkdir: async (dirPath, _options) => {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// ============================================
// Mock Tauri Path API
// ============================================
const mockPath = {
  homeDir: async () => {
    // Return with BACKSLASHES to simulate Windows
    return os.tmpdir().replace(/\//g, '\\');
  }
};

// ============================================
// Mock Tauri Event API
// ============================================
const mockEvent = {
  listen: async (eventName, handler) => {
    // Store handler for later triggering
    global.__TAURI_EVENT_HANDLERS__ = global.__TAURI_EVENT_HANDLERS__ || {};
    global.__TAURI_EVENT_HANDLERS__[eventName] = global.__TAURI_EVENT_HANDLERS__[eventName] || [];
    global.__TAURI_EVENT_HANDLERS__[eventName].push(handler);
    return () => {}; // unlisten function
  }
};

// ============================================
// Assemble window.__TAURI__
// ============================================
global.window.__TAURI__ = {
  core: { invoke: mockInvoke },
  fs: mockFS,
  path: mockPath,
  event: mockEvent
};

// Also expose for convenience
module.exports = {
  setTestFolderDialog: (path) => { global.__TEST_FOLDER_DIALOG__ = path; },
  clearTestFolderDialog: () => { global.__TEST_FOLDER_DIALOG__ = null; },
  emitAgentEvent: (payload) => {
    const handlers = global.__TAURI_EVENT_HANDLERS__?.['agent-event'] || [];
    handlers.forEach(h => h({ payload }));
  },
  mockInvoke
};
