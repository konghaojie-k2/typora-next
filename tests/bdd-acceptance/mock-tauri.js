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
    case 'socratic_select_cluster':
      return _socraticSelectCluster(args);
    case 'socratic_chat':
      return _socraticChat(args);
    case 'socratic_save_session':
      return _socraticSaveSession(args);
    case 'socratic_load_state':
      return _socraticLoadState(args);
    case 'socratic_save_state':
      return _socraticSaveState(args);
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
// Sprint 8: Socratic Review (mock implementations)
// ============================================

function _socraticSelectCluster({ projectPath }) {
  const kgPath = path.join(projectPath, '.learning', 'knowledge-graph.json');
  if (!fs.existsSync(kgPath)) {
    // No KG → empty cluster (sparse fallback)
    return { concepts: [], edges: [], cluster_hash: 'empty' };
  }
  const kg = JSON.parse(fs.readFileSync(kgPath, 'utf-8'));
  const nodes = kg.nodes || [];
  const edges = (kg.edges || []).filter(e => (e.weight || 0) >= 0.5);

  if (nodes.length === 0) {
    return { concepts: [], edges: [], cluster_hash: 'empty' };
  }

  // BFS from highest-degree node
  const degree = new Map();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }
  const sorted = [...nodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
  const anchor = sorted[0];

  const targetSize = 4;
  const cluster = [anchor.id];
  const visited = new Set([anchor.id]);
  const frontier = [anchor.id];
  while (cluster.length < targetSize && frontier.length > 0) {
    const next = [];
    for (const node of frontier) {
      const neighbors = edges
        .filter(e => e.from === node || e.to === node)
        .map(e => e.from === node ? e.to : e.from)
        .filter(id => !visited.has(id));
      for (const nb of neighbors) {
        if (cluster.length >= targetSize) break;
        cluster.push(nb);
        visited.add(nb);
        next.push(nb);
      }
    }
    frontier.length = 0;
    frontier.push(...next);
  }

  // Fallback: if KG is sparse, include remaining nodes up to available count
  const remaining = nodes.filter(n => !visited.has(n.id)).map(n => n.id);
  for (const id of remaining) {
    if (cluster.length >= targetSize) break;
    cluster.push(id);
    visited.add(id);
  }

  const conceptRefs = cluster.map(id => {
    const n = nodes.find(x => x.id === id);
    return { id, title: n?.title || id, source_chapter: n?.source_chapter || '' };
  });
  const clusterEdges = edges.filter(e => cluster.includes(e.from) && cluster.includes(e.to));

  // Hash for 24h dedup
  const crypto = require('crypto');
  const clusterHash = crypto.createHash('md5')
    .update(cluster.sort().join('|'))
    .digest('hex')
    .slice(0, 8);

  return {
    concepts: conceptRefs,
    edges: clusterEdges,
    cluster_hash: clusterHash
  };
}

function _socraticChat({ projectPath, conceptTitles }) {
  // Round 2: Simulate realistic AI responses (contract testing baseline)
  // Returns non-stub, concept-relevant questions instead of Sprint 8a placeholder
  const titles = conceptTitles || [];
  const turns = global.__SOCRATIC_TURNS__ || [];
  const turnCount = turns.length;

  // Simulate progressive questioning based on turn count
  if (turnCount === 0) {
    return {
      content: `Let's explore how ${titles.join(', ')} relate to each other. What connections do you see?`,
      done: false
    };
  }
  if (turnCount === 1) {
    return {
      content: `Interesting. Can you explain the mechanism behind ${titles[0]} in more detail?`,
      done: false
    };
  }
  if (turnCount === 2) {
    return {
      content: `How would you apply ${titles.join(' and ')} to a real-world scenario?`,
      done: false
    };
  }
  // End after 3 rounds
  return {
    content: `Great discussion. That concludes our Socratic review. [SESSION_END]`,
    done: true
  };
}

function _socraticSaveSession({ projectPath, session }) {
  const sessionsDir = path.join(projectPath, '.learning', 'socratic-sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const ts = (session.ended_at || new Date().toISOString()).replace(/[:.]/g, '-');
  const filePath = path.join(sessionsDir, `${ts}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  return filePath;
}

function _socraticLoadState({ projectPath }) {
  const statePath = path.join(projectPath, '.learning', 'socratic-state.json');
  if (!fs.existsSync(statePath)) {
    return {
      last_socratic_at: null,
      last_dismissed_at: null,
      opt_out: false,
      quiz_count_since_last_socratic: 0,
      recent_cluster_hashes: []
    };
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
}

function _socraticSaveState({ projectPath, state }) {
  const learningDir = path.join(projectPath, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });
  const statePath = path.join(learningDir, 'socratic-state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
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
