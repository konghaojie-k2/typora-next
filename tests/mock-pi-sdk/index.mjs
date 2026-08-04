/**
 * Mock Pi coding agent SDK for testing (ESM).
 *
 * Injected at the SDK boundary: tests/e2e point TYPORA_PI_SDK_ENTRY at this
 * file, so agent-bridge.mjs's loadPiSDK() imports it instead of the real SDK.
 * Implements exactly the surface the bridge uses:
 *   AuthStorage.create / ModelRegistry.create().find / DefaultResourceLoader /
 *   SessionManager.create|open / createAgentSession / getAgentDir
 *
 * Default behavior mirrors the old mock-agent-sdk heuristics (plan outline /
 * chapter file writes / explain file writes). Tests that need bespoke agent
 * behavior call __setBehavior(fn) in-process, or rely on prompt heuristics.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MOCK_OUTLINE = {
  chapters: [
    { title: '为什么学这个', duration_minutes: 10, concepts: ['动机', '应用场景'] },
    { title: '注意力机制的本质', duration_minutes: 25, concepts: ['注意力', '查询键值'] },
    { title: 'Self-Attention 详解', duration_minutes: 30, concepts: ['自注意力', '并行计算'] }
  ],
  total_duration: 65
};

const MOCK_CHAPTER_CONTENT = `# 为什么学这个

> [!concept] Transformer
> Transformer 是一种革命性的深度学习架构，彻底改变了自然语言处理领域。

本章将介绍学习 Transformer 的重要性。
`;

// Replicate agent-bridge.mjs generateFilename sanitization so the mock writes
// the same filename the host will look for.
function mockGenerateFilename(index, title) {
  const paddedIndex = String(index).padStart(2, '0');
  const safeTitle = title
    .replace(/[^一-龥a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${paddedIndex}-${safeTitle}.md`;
}

/** Bespoke behavior hook for in-process unit tests. */
let _behavior = null;
export function __setBehavior(fn) { _behavior = fn; }
export function __resetBehavior() { _behavior = null; }

/**
 * Default heuristic behavior, ported from the old mock-agent-sdk.
 * @returns {{text: string, toolCalls?: Array<{toolName: string, args: object}>}}
 */
function defaultBehavior({ prompt, cwd }) {
  const write = (p, content) => {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, 'utf-8');
    } catch (_) { /* ignore */ }
  };

  if (prompt.includes('设计学习大纲') || prompt.includes('学习设计师')) {
    return { text: JSON.stringify(MOCK_OUTLINE, null, 2) };
  }

  if (prompt.includes('chapter-generation skill') || /chapter_index:\s*\d/.test(prompt)) {
    const idxMatch = prompt.match(/chapter_index:\s*(\d+)/);
    const titleMatch = prompt.match(/chapter_title:\s*(.*)$/m);
    const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
    let title = '';
    if (titleMatch) {
      try { title = JSON.parse(titleMatch[1].trim()); }
      catch (_) { title = titleMatch[1].trim().replace(/^["']|["']$/g, ''); }
    }
    const filename = mockGenerateFilename(idx, title);
    write(path.join(cwd || '.', filename), MOCK_CHAPTER_CONTENT);
    const text = `第 ${idx + 1} 章已生成: ${filename}`;
    return { text, toolCalls: [{ toolName: 'write', args: { path: path.join(cwd || '.', filename) } }] };
  }

  // explain stage: "用 Write 工具将结果写入：<path>"
  const explainMatch = prompt.match(/将结果写入：(\S+)\s*$/m);
  if (prompt.includes('explanation skill') && explainMatch) {
    const outFile = explainMatch[1];
    write(outFile, JSON.stringify({ explanation: '这是一个生活化类比解释。', suggested_questions: ['q1'] }));
    return { text: 'done', toolCalls: [{ toolName: 'write', args: { path: outFile } }] };
  }

  // extra-quiz stage
  if (prompt.includes('extra-quiz-generation skill')) {
    const m = prompt.match(/写入：(\S+)\s*$/m);
    if (m) write(m[1], JSON.stringify([]));
    return { text: 'done' };
  }

  // paper-reader stage
  if (prompt.includes('typora-paper-reader skill')) {
    const m = prompt.match(/output_file:\s*"([^"]+)"/);
    if (m) write(m[1], JSON.stringify({ title: 'Mock Paper Guide', sections: [] }));
    return { text: 'done' };
  }

  // review-gen stages
  if (prompt.includes('review-generation skill')) {
    return { text: '```json\n{"cards":{}}\n```' };
  }

  return { text: '# Mock Content\n\nThis is a mock response.' };
}

// ============================================
// SDK surface
// ============================================

export function getAgentDir() {
  return path.join(os.tmpdir(), 'mock-pi-agent-dir');
}

export const AuthStorage = {
  create(_p) { return { _mock: true }; }
};

export const ModelRegistry = {
  create(_auth, _modelsPath) {
    return {
      find(providerId, modelId) {
        return { id: modelId, provider: providerId, name: modelId };
      }
    };
  }
};

export class DefaultResourceLoader {
  constructor(opts = {}) { this.opts = opts; }
  async reload() { /* no-op */ }
  getSkills() { return { skills: [], diagnostics: [] }; }
}

export const SessionManager = {
  create(cwd) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-pi-session-'));
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file, JSON.stringify({ type: 'header', cwd }) + '\n');
    return { _file: file, _cwd: cwd };
  },
  open(p) {
    if (!fs.existsSync(p)) throw new Error(`mock: session not found: ${p}`);
    return { _file: p, _cwd: null };
  }
};

export async function createAgentSession(opts) {
  const sessionManager = opts.sessionManager || SessionManager.create(opts.cwd);
  const subscribers = [];
  const messages = [];

  const session = {
    sessionFile: sessionManager._file,
    messages,
    subscribe(fn) {
      subscribers.push(fn);
      return () => { /* unsubscribe */ };
    },
    async prompt(text) {
      messages.push({ role: 'user', content: [{ type: 'text', text }] });
      fs.appendFileSync(sessionManager._file, JSON.stringify({ type: 'message', role: 'user' }) + '\n');

      const behavior = _behavior || defaultBehavior;
      const result = await behavior({ prompt: text, cwd: opts.cwd, tools: opts.tools, session });

      for (const tc of result.toolCalls || []) {
        for (const fn of subscribers) {
          fn({ type: 'tool_execution_start', toolName: tc.toolName, args: tc.args });
        }
      }
      // one text_delta chunk (streaming shape)
      for (const fn of subscribers) {
        fn({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: result.text } });
      }
      messages.push({ role: 'assistant', content: [{ type: 'text', text: result.text }] });
      fs.appendFileSync(sessionManager._file, JSON.stringify({ type: 'message', role: 'assistant' }) + '\n');
    },
    dispose() { /* no-op */ }
  };

  return { session };
}
