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
    case 'case_study_chat':
      return _caseStudyChat(args);
    case 'case_study_save_session':
      return _caseStudySaveSession(args);
    case 'case_study_list_sessions':
      return _caseStudyListSessions(args);
    case 'own_voice_chat':
      return _ownVoiceChat(args);
    case 'own_voice_save_session':
      return _ownVoiceSaveSession(args);
    case 'own_voice_list_sessions':
      return _ownVoiceListSessions(args);
    case 'visualize_chat':
      return _visualizeChat(args);
    case 'visualize_save_session':
      return _visualizeSaveSession(args);
    case 'visualize_list_sessions':
      return _visualizeListSessions(args);
    case 'explain_selection':
      return _explainSelection(args);
    case 'persist_explanation':
      return _persistExplanation(args);
    case 'list_project_explanations':
      return _listProjectExplanations(args);
    case 'generate_review_content':
      return _generateReviewContent(args);
    case 'init_review_schedule':
      return _initReviewSchedule(args);
    case 'submit_review_result':
      return _submitReviewResult(args);
    case 'check_missing_review_cards':
      return _checkMissingReviewCards(args);
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

// ============================================
// Sprint 17: Case Study
// ============================================

let _caseStudyChatCalls = [];
function _caseStudyChat(args) {
  _caseStudyChatCalls.push(args);
  const isFirst = !args.userAnswer;
  return {
    content: isFirst
      ? `📖 情境\n某铁路公司要整合调度数据。\n\n🔍 分析\n这里的字段约束就是 ${args.selectedText}。\n\n🔗 回扣\n对应本章知识点。`
      : `围绕案例回答：${args.userAnswer}`,
    done: false,
    session_id: args.sessionId || 'mock-case-session-1'
  };
}
function _getCaseStudyChatCalls() { return _caseStudyChatCalls; }

function _caseStudySaveSession({ projectPath, session, overwriteFile }) {
  const sessionsDir = path.join(projectPath, '.learning', 'case-studies');
  fs.mkdirSync(sessionsDir, { recursive: true });
  // 续聊：沿用原文件名覆盖写盘，不得新建重复条目（与 Rust case_study_store 同契约）
  const ts = (session.ended_at || new Date().toISOString()).replace(/[:.]/g, '-');
  const fileName = overwriteFile || `${ts}.json`;
  const filePath = path.join(sessionsDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  return filePath;
}

function _caseStudyListSessions({ projectPath }) {
  const sessionsDir = path.join(projectPath, '.learning', 'case-studies');
  if (!fs.existsSync(sessionsDir)) return [];
  const sessions = [];
  for (const f of fs.readdirSync(sessionsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
      s.file = f; // 会话身份：续聊时回传给 save 以覆盖原文件
      sessions.push(s);
    } catch (_) { /* skip broken */ }
  }
  sessions.sort((a, b) => String(b.ended_at || '').localeCompare(String(a.ended_at || '')));
  return sessions;
}

// ============================================
// AI 伴学（我有话说）
// ============================================

let _ownVoiceChatCalls = [];
function _ownVoiceChat(args) {
  _ownVoiceChatCalls.push(args);
  const isFirst = !!args.firstTurn;
  return {
    content: isFirst
      ? `✅ 你说对的部分\n${args.userAnswer} 的方向是对的。\n\n⚠️ 需要修正\n其中「${args.selectedText || '概念'}」的表述要修正。\n\n❓ 反问\n你能举一个具体例子吗？`
      : `针对你的补充回应：${args.userAnswer}`,
    done: false,
    session_id: args.sessionId || 'mock-own-voice-session-1'
  };
}
function _getOwnVoiceChatCalls() { return _ownVoiceChatCalls; }

function _ownVoiceSaveSession({ projectPath, session, overwriteFile }) {
  const sessionsDir = path.join(projectPath, '.learning', 'own-voices');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const ts = (session.ended_at || new Date().toISOString()).replace(/[:.]/g, '-');
  const fileName = overwriteFile || `${ts}.json`;
  const filePath = path.join(sessionsDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  return filePath;
}

function _ownVoiceListSessions({ projectPath }) {
  const sessionsDir = path.join(projectPath, '.learning', 'own-voices');
  if (!fs.existsSync(sessionsDir)) return [];
  const sessions = [];
  for (const f of fs.readdirSync(sessionsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
      s.file = f; // 会话身份：续聊时回传给 save 以覆盖原文件
      sessions.push(s);
    } catch (_) { /* skip broken */ }
  }
  sessions.sort((a, b) => String(b.ended_at || '').localeCompare(String(a.ended_at || '')));
  return sessions;
}

// ============================================
// AI 伴学（画个图）—— 与案例研习/我有话说同构（session + 落盘目录 visualizations）
// ============================================

let _visualizeChatCalls = [];
function _visualizeChat(args) {
  _visualizeChatCalls.push(args);
  const isFirst = !args.userAnswer;
  return {
    content: isFirst
      ? `这张图看 ${args.selectedText} 的结构：\n\`\`\`svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 120"><rect x="0" y="0" width="680" height="120" fill="#F7F5F0"/></svg>\n\`\`\`\n\n看图要点：注意关键部位。`
      : `按你的要求改图：${args.userAnswer}`,
    done: false,
    session_id: args.sessionId || 'mock-visualize-session-1'
  };
}
function _getVisualizeChatCalls() { return _visualizeChatCalls; }

function _visualizeSaveSession({ projectPath, session, overwriteFile }) {
  const sessionsDir = path.join(projectPath, '.learning', 'visualizations');
  fs.mkdirSync(sessionsDir, { recursive: true });
  // 续聊：沿用原文件名覆盖写盘，不得新建重复条目（与 Rust case_study_store 同契约）
  const ts = (session.ended_at || new Date().toISOString()).replace(/[:.]/g, '-');
  const fileName = overwriteFile || `${ts}.json`;
  const filePath = path.join(sessionsDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  return filePath;
}

function _visualizeListSessions({ projectPath }) {
  const sessionsDir = path.join(projectPath, '.learning', 'visualizations');
  if (!fs.existsSync(sessionsDir)) return [];
  const sessions = [];
  for (const f of fs.readdirSync(sessionsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
      s.file = f; // 会话身份：续聊时回传给 save 以覆盖原文件
      sessions.push(s);
    } catch (_) { /* skip broken */ }
  }
  sessions.sort((a, b) => String(b.ended_at || '').localeCompare(String(a.ended_at || '')));
  return sessions;
}

// ============================================
// 解释记录（.learning/explanations/{chapter_stem}/{cue_id}.json）
// ============================================

let _explainSelectionCalls = [];
function _explainSelection(args) {
  _explainSelectionCalls.push(args);
  return {
    explanation: `解释：${args.text}（第 ${(args.previousQa || []).length + 1} 轮）`,
    suggested_questions: ['再举个例子', '为什么是这样', '有什么应用场景']
  };
}
function _getExplainSelectionCalls() { return _explainSelectionCalls; }

function _chapterStem(chapter) {
  return String(chapter || '').replace(/\.[^./\\]+$/, '');
}

function _persistExplanation({ projectPath, chapter, conversation }) {
  const dir = path.join(projectPath, '.learning', 'explanations', _chapterStem(chapter));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${conversation.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
  return filePath;
}

/** 扫 .learning/explanations/{章节}/{cue}.json，拍平标注 chapter，新→旧（对齐 Rust 实现） */
function _listProjectExplanations({ projectPath }) {
  const root = path.join(projectPath, '.learning', 'explanations');
  if (!fs.existsSync(root)) return [];
  const items = [];
  for (const chapter of fs.readdirSync(root)) {
    const chapterDir = path.join(root, chapter);
    if (!fs.statSync(chapterDir).isDirectory()) continue;
    for (const f of fs.readdirSync(chapterDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const conv = JSON.parse(fs.readFileSync(path.join(chapterDir, f), 'utf-8'));
        items.push({
          id: conv.id,
          selected_text: conv.selected_text,
          chapter: chapter,
          rounds: (conv.qa_history || []).length,
          created_at: conv.created_at,
          last_ts: conv.qa_history && conv.qa_history.length
            ? conv.qa_history[conv.qa_history.length - 1].ts : '',
          qa_history: conv.qa_history
        });
      } catch (_) { /* 损坏文件跳过 */ }
    }
  }
  items.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return items;
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
// PB1: Generate Review Content (stub)
// ============================================

function _generateReviewContent({ projectPath, chapterFile, weakConcepts }) {
  const learningDir = path.join(projectPath, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });

  const chapterStem = path.basename(chapterFile || '').replace(/\.md$/, '');
  const conceptsJsonPath = path.join(projectPath, `${chapterStem}.concepts.json`);
  const concepts = [];
  if (fs.existsSync(conceptsJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(conceptsJsonPath, 'utf-8'));
      if (parsed.concepts) concepts.push(...parsed.concepts);
    } catch (e) { /* ignore parse errors */ }
  }

  if (concepts.length === 0) {
    return { success: true, cards_count: 0, note: 'no concepts found' };
  }

  const cardsPath = path.join(learningDir, 'review-cards.json');
  let cards = { version: '1.0', cards: {} };
  if (fs.existsSync(cardsPath)) {
    try { cards = JSON.parse(fs.readFileSync(cardsPath, 'utf-8')); } catch (e) { /* ignore */ }
  }

  const weakSet = new Set(weakConcepts || []);
  const now = new Date().toISOString();
  let added = 0;

  for (const c of concepts) {
    const cid = c.id || c.name || c;
    if (cards.cards[cid]) continue;

    cards.cards[cid] = {
      concept_name: c.name || cid,
      source_chapter: path.basename(chapterFile || ''),
      quiz_questions: [
        { type: 'choice', question: `${c.name || cid} 的核心思想是什么？`, options: ['描述A', '描述B', '描述C', '描述D'], answer: 0 }
      ],
      key_points: [
        `${c.name || cid} 是本章的核心概念（待Agent生成详细内容）`,
        `${c.name || cid} 的理解对掌握后续内容很重要`
      ],
      generated_at: now,
      from_weak: weakSet.has(cid)
    };
    added++;
  }

  fs.writeFileSync(cardsPath, JSON.stringify(cards, null, 2), 'utf-8');
  return { success: true, cards_count: added };
}

// ============================================
// PB2: Init Review Schedule (stub)
// ============================================

function _initReviewSchedule({ projectPath, chapterFile, weakConcepts }) {
  const learningDir = path.join(projectPath, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });

  const chapterStem = path.basename(chapterFile || '').replace(/\.md$/, '');
  const conceptsJsonPath = path.join(projectPath, `${chapterStem}.concepts.json`);
  const concepts = [];
  if (fs.existsSync(conceptsJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(conceptsJsonPath, 'utf-8'));
      if (parsed.concepts) concepts.push(...parsed.concepts);
    } catch (e) { /* ignore */ }
  }

  if (concepts.length === 0) return { success: true, items_added: 0 };

  const schedulePath = path.join(learningDir, 'review-schedule.json');
  let schedule = { version: '1.0', items: [] };
  if (fs.existsSync(schedulePath)) {
    try { schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf-8')); } catch (e) { /* ignore */ }
  }

  const weakSet = new Set(weakConcepts || []);
  const now = new Date();
  now.setDate(now.getDate() + 1);
  const nextReview = now.toISOString().slice(0, 10) + ' 12:00:00';
  let added = 0;

  for (const c of concepts) {
    const cid = c.id || c.name || c;
    if (schedule.items.some(item => item.concept === cid)) continue;
    schedule.items.push({
      concept: cid,
      source_chapter: path.basename(chapterFile || ''),
      review_count: 0,
      last_reviewed: '',
      next_review_at: nextReview,
      last_rating: 'learning',
      status: 'upcoming'
    });
    added++;
  }

  fs.writeFileSync(schedulePath, JSON.stringify(schedule, null, 2), 'utf-8');
  return { success: true, items_added: added };
}

// ============================================
// PB3: Submit Review Result (review-history + schedule + graph)
// ============================================

function _submitReviewResult({ projectPath, conceptId, rating, answers }) {
  const learningDir = path.join(projectPath, '.learning');
  fs.mkdirSync(learningDir, { recursive: true });
  const now = new Date().toISOString();

  // 1. Update review-schedule.json
  const schedulePath = path.join(learningDir, 'review-schedule.json');
  if (fs.existsSync(schedulePath)) {
    try {
      const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf-8'));
      const item = schedule.items.find(i => i.concept === conceptId);
      if (item) {
        item.review_count = (item.review_count || 0) + 1;
        item.last_rating = rating;
        item.last_reviewed = now;
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + (rating === 'mastered' ? 4 : rating === 'learning' ? 2 : 1));
        item.next_review_at = nextDate.toISOString().slice(0, 10) + ' 12:00:00';
        item.status = 'upcoming';
      }
      fs.writeFileSync(schedulePath, JSON.stringify(schedule, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
  }

  // 2. Append to review-history.json
  const historyPath = path.join(learningDir, 'review-history.json');
  let history = { version: '1.0', entries: [] };
  if (fs.existsSync(historyPath)) {
    try { history = JSON.parse(fs.readFileSync(historyPath, 'utf-8')); } catch (e) { /* ignore */ }
  }
  history.entries.push({
    concept_id: conceptId,
    timestamp: now,
    correct: rating === 'mastered',
    rating,
    answers: answers || []
  });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');

  // 3. Update knowledge-graph.json node_status
  const graphPath = path.join(learningDir, 'knowledge-graph.json');
  if (fs.existsSync(graphPath)) {
    try {
      const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
      const node = (graph.nodes || []).find(n => n.id === conceptId);
      if (node) {
        node.node_status = rating;
        fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8');
      }
    } catch (e) { /* ignore */ }
  }

  return { success: true, concept_id: conceptId, rating };
}

// ============================================
// PB5: Check Missing Review Cards
// ============================================

function _checkMissingReviewCards({ projectPath }) {
  const learningDir = path.join(projectPath, '.learning');
  const projectJsonPath = path.join(learningDir, 'project.json');
  if (!fs.existsSync(projectJsonPath)) return [];

  try {
    const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));

    // Read existing review-cards.json
    const cardsPath = path.join(learningDir, 'review-cards.json');
    const existingIds = new Set();
    if (fs.existsSync(cardsPath)) {
      try {
        const cards = JSON.parse(fs.readFileSync(cardsPath, 'utf-8'));
        Object.keys(cards.cards || {}).forEach(id => existingIds.add(id));
      } catch (e) { /* ignore */ }
    }

    const statusMap = project.chapters_status || {};
    const chapters = project.chapters || [];
    const missing = [];

    for (const ch of chapters) {
      const chFile = ch.file || '';
      if (!chFile || statusMap[chFile] !== 'completed') continue;

      const missingConcepts = (ch.concepts || [])
        .map(c => c.id || c.name || c)
        .filter(id => id && !existingIds.has(id));

      if (missingConcepts.length > 0) {
        missing.push({ chapter_file: chFile, missing_concepts: missingConcepts });
      }
    }

    return missing;
  } catch (e) {
    return [];
  }
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
    // Return with forward slashes for consistent path handling
    return os.tmpdir().replace(/\\/g, '/');
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
const mockTauriApi = {
  core: { invoke: mockInvoke },
  fs: mockFS,
  path: mockPath,
  event: mockEvent
};
global.window.__TAURI__ = mockTauriApi;

// Also expose for convenience
module.exports = {
  setTestFolderDialog: (path) => { global.__TEST_FOLDER_DIALOG__ = path; },
  clearTestFolderDialog: () => { global.__TEST_FOLDER_DIALOG__ = null; },
  emitAgentEvent: (payload) => {
    const handlers = global.__TAURI_EVENT_HANDLERS__?.['agent-event'] || [];
    handlers.forEach(h => h({ payload }));
  },
  getCaseStudyChatCalls: () => _getCaseStudyChatCalls(),
  getOwnVoiceChatCalls: () => _getOwnVoiceChatCalls(),
  getVisualizeChatCalls: () => _getVisualizeChatCalls(),
  getExplainSelectionCalls: () => _getExplainSelectionCalls(),
  mockInvoke,
  // 后装载的 steps 套件若被更早的套件整替换过 global.window，用它重新挂载
  tauriApi: mockTauriApi
};
