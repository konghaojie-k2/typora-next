/**
 * Agent Bridge - Node.js script for AI Learning Designer
 * Uses Claude Agent SDK for autonomous agent capabilities
 *
 * Usage:
 *   node agent-bridge.js <stage> <config_json>
 *
 * Stages:
 *   plan     - Generate course outline from goal/level/hours
 *   generate - Generate chapters from outline
 */

const fs = require('fs');
const path = require('path');

// ============================================
// Logging
// ============================================
// Resolution order for log directory:
//  1. TYPORA_NEXT_LOG_DIR env var (set by Rust on install / production runs)
//  2. Script directory (__dirname) — colocated with agent-bridge.js
//  3. Process CWD — last-resort fallback
function _resolveLogDir() {
  if (process.env.TYPORA_NEXT_LOG_DIR) return process.env.TYPORA_NEXT_LOG_DIR;
  return __dirname;
}

const LOG_DIR = _resolveLogDir();
const LOG_FILE = path.join(LOG_DIR, 'agent-bridge.log');

// Announce log location on stderr (not stdout — stdout is reserved for JSON events)
// so debugging "where did the logs go" is trivial.
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (_) { /* ignore */ }
process.stderr.write(`[agent-bridge] log file: ${LOG_FILE}\n`);

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, data };
  const line = JSON.stringify(entry);

  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch (e) {
    // Final fallback: write next to the script instead of the user's cwd,
    // so opening a document by double-click doesn't litter the document dir.
    try {
      const fallback = path.join(__dirname, 'agent-bridge.log');
      fs.appendFileSync(fallback, line + '\n', 'utf-8');
    } catch (_) {
      // Ignore log write errors
    }
  }

  console.error(`[${level}] ${message}`);
}

// ============================================
// Output Helpers (stdout = JSON lines for Rust, stderr = logs)
// ============================================
function emit(type, data) {
  const line = JSON.stringify({ type, data });
  // console.log is synchronous and flushes stdout immediately
  console.log(line);
  log('event', `Emitted: ${type}`, data);
}

function emitError(message, details = {}) {
  log('error', message, details);
  emit('error', { message, ...details });
  process.exit(1);
}

// ============================================
// Core Functions (testable - accept queryFn as injection)
// ============================================

/**
 * Collect all assistant output from stream
 * @param {AsyncIterable} stream - Agent SDK query stream
 * @param {Function} onMessage - Optional callback for each stream message
 */
/**
 * Extract text content from an SDK message.
 *
 * Two shapes to handle:
 *   1. `stream_event` (only emitted when `includePartialMessages: true`)
 *      — wraps an upstream SSE event; text chunks come through
 *        `content_block_delta` with a `BetaTextDelta` payload
 *        (`{ type: 'text_delta', text: '...' }`).
 *   2. `assistant` (the cumulative message, always emitted) — content lives in
 *      `msg.message.content[]` (array of text blocks), NOT in `msg.content`.
 *
 * Returning a string is fine: callers concatenate, so each delta is just a
 * tiny piece that joins into the full output.
 */
function _extractAssistantText(msg) {
  if (!msg) return '';
  // Per-chunk text from the upstream SSE stream
  if (msg.type === 'stream_event'
      && msg.event
      && msg.event.type === 'content_block_delta'
      && msg.event.delta
      && typeof msg.event.delta.text === 'string') {
    return msg.event.delta.text;
  }
  // Full assistant message fallback (also handles the final cumulative state)
  if (msg.type === 'assistant' && msg.message && msg.message.content) {
    return msg.message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }
  return '';
}

async function collectAgentOutput(stream, onMessage) {
  const chunks = [];
  let finalResult = null;

  for await (const msg of stream) {
    if (onMessage) {
      onMessage(msg);
    }
    const text = _extractAssistantText(msg);
    if (text) {
      chunks.push(text);
    }
    if (msg.type === 'result' && msg.subtype === 'success' && msg.result) {
      finalResult = msg.result;
    }
  }

  // Prefer final result if available (it's the complete output)
  // Otherwise fall back to concatenated assistant chunks
  return finalResult || chunks.join('');
}

/**
 * Build query options, threading `session_id` through to the SDK as `resume`.
 * Per the Phase B design: 1 project = 1 session. All agent activities in a
 * project share the session so the agent has cumulative memory.
 *
 * If `sessionId` is null/undefined, no `resume` is set (a fresh session is
 * created). The host (Rust) is responsible for persisting the session_id
 * to `.learning/agent-session.json` after initSession().
 *
 * @param {object} baseOptions - options WITHOUT resume
 * @param {string|null|undefined} sessionId
 * @returns {object} options with resume set (or omitted)
 */
function _buildQueryOptions(baseOptions, sessionId) {
  const opts = { ...(baseOptions || {}) };
  if (sessionId) {
    opts.resume = sessionId;
  }
  return opts;
}

/**
 * Try to consume the stream from a session-resumed query. If the SDK throws
 * during iteration (e.g. expired session), fall back to a fresh query and
 * emit a `session_refresh` event with the new session_id. The host updates
 * `.learning/agent-session.json` on receiving this event.
 *
 * Used by every stage that supports `session_id`. The fallback chain:
 *   1. query({ resume: sessionId, ... })
 *   2. catch → warn → query({ ... no resume ... })
 *   3. capture new session_id from first message that has one
 *   4. emit session_refresh event
 *
 * @param {Function} queryFn
 * @param {object} baseArgs - prompt + options WITHOUT resume
 * @param {string|null} sessionId
 * @param {Function} onMessage - (msg) => void
 * @returns {Promise<string>} collected output text
 */
async function collectAgentOutputWithRecovery(queryFn, baseArgs, sessionId, onMessage) {
  // First attempt: with resume (if sessionId provided)
  if (sessionId) {
    const optsWithResume = _buildQueryOptions(baseArgs.options, sessionId);
    const stream = queryFn({ prompt: baseArgs.prompt, options: optsWithResume });
    try {
      return await _consumeStreamCollectingSession(stream, onMessage, /* expectedSessionId */ sessionId);
    } catch (e) {
      // Resume failed — log and fall through to fresh
      log('warn', 'Session resume failed, falling back to fresh session', {
        attempted_session_id: sessionId,
        error: e.message
      });
    }
  }
  // Fresh attempt
  const stream = queryFn(baseArgs);
  // Capture the new session_id from the first message that has one
  let newSessionId = null;
  const wrappedOnMessage = (msg) => {
    if (!newSessionId && msg && typeof msg === 'object' && msg.session_id) {
      newSessionId = msg.session_id;
    }
    if (onMessage) onMessage(msg);
  };
  const result = await _consumeStreamCollectingSession(stream, wrappedOnMessage, null);
  if (newSessionId) {
    log('info', 'Fresh session established', { session_id: newSessionId });
    if (sessionId) {
      // We were trying to resume and it failed — notify host of new session
      emit('session_refresh', { old_session_id: sessionId, new_session_id: newSessionId });
    }
  }
  return result;
}

async function _consumeStreamCollectingSession(stream, onMessage, expectedSessionId) {
  const chunks = [];
  let finalResult = null;
  // Track which tool_use blocks we've already emitted progress for, to avoid
  // double-logging when the SDK re-emits them in cumulative messages.
  const emittedToolUseIds = new Set();
  for await (const msg of stream) {
    if (onMessage) onMessage(msg);

    // Existing: extract assistant text
    const text = _extractAssistantText(msg);
    if (text) chunks.push(text);

    // NEW: emit progress_log for tool_use blocks so the user sees activity
    // mid-chapter (Read, Write, Glob) instead of a single "生成中" line.
    if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
      for (const block of msg.message.content) {
        if (!block || block.type !== 'tool_use') continue;
        const toolUseId = block.id || `${block.name}-${chunks.length}`;
        if (emittedToolUseIds.has(toolUseId)) continue;
        emittedToolUseIds.add(toolUseId);
        const toolName = block.name;
        const toolInput = block.input || {};
        let logText = null;
        if (toolName === 'Write' && toolInput.file_path) {
          logText = `✓ 正在写 ${path.basename(toolInput.file_path)}`;
        } else if (toolName === 'Read' && toolInput.file_path) {
          logText = `📖 正在读 ${path.basename(toolInput.file_path)}`;
        } else if (toolName === 'Glob' && toolInput.pattern) {
          logText = `🔍 正在搜索 ${toolInput.pattern}`;
        } else if (toolName === 'Grep' && toolInput.pattern) {
          logText = `🔍 正在搜索内容 ${toolInput.pattern}`;
        }
        if (logText) {
          emit('progress_log', { text: logText });
        }
      }
    }

    if (msg.type === 'result' && msg.subtype === 'success' && msg.result) {
      finalResult = msg.result;
    }
  }
  return finalResult || chunks.join('');
}

/**
 * Extract JSON from agent output text
 * @param {string} text
 * @returns {object}
 */
function extractJSON(text) {
  // Try code block first
  const codeBlock = text.match(/```json\n?([\s\S]*?)\n?```/);
  if (codeBlock) {
    return JSON.parse(codeBlock[1]);
  }
  // Try raw JSON object
  const rawJson = text.match(/\{[\s\S]*\}/);
  if (rawJson) {
    return JSON.parse(rawJson[0]);
  }
  throw new Error('No JSON found in response');
}

/**
 * Generate safe filename from title
 * @param {number} index
 * @param {string} title
 */
function generateFilename(index, title) {
  const paddedIndex = String(index).padStart(2, '0');
  const safeTitle = title
    .replace(/[^一-龥a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${paddedIndex}-${safeTitle}.md`;
}

/**
 * Plan course outline (testable)
 * @param {Function} queryFn - Agent SDK query function or mock
 * @param {object} config - API config
 * @param {object} args - { goal, level, hours }
 */
async function planCourse(queryFn, config, args) {
  const { goal, level, hours } = args;

  const levelNames = {
    beginner: '小白（零基础）',
    intermediate: '有编程基础',
    advanced: '专业进阶'
  };

  emit('status', { message: 'AI 正在设计学习路径...' });

  const stream = queryFn({
    prompt: `你是一个资深的学习设计师。请根据以下信息设计一个结构化的学习大纲。

学习目标：${goal}
难度级别：${levelNames[level] || level}
预计投入时间：${hours} 小时

要求：
1. 大纲要深入浅出、逻辑连贯
2. 从基础到进阶，循序渐进
3. 每章包含：标题、预计时长（分钟）、涉及的核心概念
4. 总时长控制在用户指定范围内（允许 ±20% 偏差）
5. 章节数量：1小时≈2-3章，3小时≈6-8章，8小时≈12-16章

输出格式（必须是纯 JSON）：
\`\`\`json
{
  "project_slug": "diffusion-model",
  "chapters": [
    {
      "title": "章节标题",
      "duration_minutes": 25,
      "concepts": ["概念1", "概念2"]
    }
  ],
  "total_duration": 170
}
\`\`\`

注意：
- project_slug 是用英文小写字母和短横线组成的目录名（kebab-case），用于作为文件系统目录名，比如 "diffusion-model" / "attention-mechanism" / "react-basics"。最多 50 字符。`,
    options: {
      allowedTools: [],
      includePartialMessages: true
    }
  });

  // Drain the stream so it finishes; we don't surface text to the UI.
  // The `status` and `outline` events below carry all the user-visible
  // feedback. Dumping the in-progress JSON into progress_log bloated the
  // planning log with content the user reads from the final outline anyway.
  const output = await collectAgentOutput(stream, (msg) => {
    _extractAssistantText(msg);
  });

  // Parse JSON from agent output
  let outline;
  try {
    outline = extractJSON(output);
  } catch (e) {
    emitError(`无法解析大纲 JSON: ${e.message}\n原始响应: ${output.substring(0, 500)}`);
    return;
  }

  // Validate structure
  if (!outline.chapters || !Array.isArray(outline.chapters)) {
    emitError('大纲格式错误：缺少 chapters 数组');
    return;
  }

  // Normalize chapters
  outline.chapters = outline.chapters.map((ch, i) => ({
    title: ch.title || `第 ${i + 1} 章`,
    duration_minutes: ch.duration_minutes || 20,
    concepts: ch.concepts || []
  }));

  outline.total_duration = outline.chapters.reduce((sum, ch) => sum + ch.duration_minutes, 0);

  // Sanitize project_slug (English kebab-case). Fallback to a safe default if missing or invalid.
  if (typeof outline.project_slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(outline.project_slug)) {
    outline.project_slug = 'learning-project';
  }

  emit('outline', { outline });
}

/**
 * Generate chapters (testable)
 * If `args.chapter_indices` is provided, only those indices are generated
 * (used by sliding-window mode to add a single next chapter on demand).
 * @param {Function} queryFn - Agent SDK query function or mock
 * @param {object} config - API config
 * @param {object} args - { project_path, outline, chapter_indices? }
 */
async function generateChapters(queryFn, config, args) {
  const { project_path, outline, chapter_indices } = args;
  const allChapters = outline.chapters;
  const total = allChapters.length;

  // Sliding-window: only generate the requested indices. Caller must include
  // `outline` with the full chapter list (we still need title/concepts for each).
  let indicesToGenerate;
  if (Array.isArray(chapter_indices) && chapter_indices.length > 0) {
    indicesToGenerate = chapter_indices
      .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < total);
    if (indicesToGenerate.length === 0) {
      emit('complete', { total_generated: 0 });
      return;
    }
  } else {
    indicesToGenerate = allChapters.map((_, i) => i);
  }

  for (let step = 0; step < indicesToGenerate.length; step++) {
    const i = indicesToGenerate[step];
    const chapter = allChapters[i];

    emit('progress', {
      current: i + 1,
      total,
      chapter_title: chapter.title,
      status: 'generating'
    });

    // Build "previous chapters" context from the full outline (not just what we
    // generated in this run) so the LLM sees the entire syllabus regardless of
    // sliding-window mode.
    const prevContext = i > 0
      ? `前面已生成的章节：\n${allChapters.slice(0, i).map((ch, idx) => `${idx + 1}. ${ch.title}`).join('\n')}`
      : '这是第一章。';

    // Phase D: minimal prompt. The agent reads the chapter-generation skill
    // (and its references/content-format.md) for the actual format spec,
    // then uses Write tool to create the 3 output files. Host does not
    // parse or write — the agent owns end-to-end file creation.
    const chapterPrompt = `请使用 chapter-generation skill 生成第 ${i + 1} 章。
- chapter_index: ${i}
- chapter_title: ${JSON.stringify(chapter.title)}
- duration_minutes: ${chapter.duration_minutes}
- concepts: ${JSON.stringify(chapter.concepts)}
- project_path: ${JSON.stringify(project_path)}
- previous_chapters: ${JSON.stringify(allChapters.slice(0, i).map((ch) => ch.title))}

${prevContext}

重要：
1. chapter-generation skill 的 SKILL.md 和 content-format.md 已经在 init session 里读过，session context 里就有；除非内容不全再 Read 补充，否则直接用 Write 写文件。
2. 写完三个文件后，按 SKILL.md 的 MUST-VERIFY checklist 逐项检查，不通过就改。
3. 三个文件必须都存在且 quiz.json 顶层必须有 \`questions\` 字段（不是空对象、不是其他名字）。`;

    try {
      // Drain the stream silently. Per the user's "取消" feedback, we no
      // longer emit any progress_log for chapter generation — `status` and
      // `progress` events already provide all the liveness feedback needed,
      // and the .md file is the canonical place to read the content.
      // Phase B: thread session_id through so the agent has project memory
      // and previous chapters already loaded in context.
      // Phase D: agent uses Write tool to create files; host no longer parses.
      const raw = await collectAgentOutputWithRecovery(
        queryFn,
        {
          prompt: chapterPrompt,
          options: {
            // Allow Write so the agent can persist the .md / .quiz.json / .concepts.json
            allowedTools: ['Read', 'Write', 'Glob', 'Grep'],
            // Discover all bundled skills (chapter-generation + project-onboarding
            // + explanation + typora-socratic-review live in .claude/skills/ of the project)
            skills: 'all',
            // Project files are at the project root; agent uses cwd
            cwd: project_path,
            includePartialMessages: true
          }
        },
        args.session_id,
        (msg) => { _extractAssistantText(msg); }
      );

      if (!raw || raw.trim().length < 5) {
        // With Phase D, the agent's text response is just a confirmation line
        // like "第 2 章已生成: ...". Anything shorter means something failed.
        throw new Error('Agent response too short — likely Write tool failure or session error');
      }

      const filename = generateFilename(i, chapter.title);
      // Sanity check: did the agent actually write the .md file?
      // If not, the file is missing from disk and we should mark as failed
      // so the user can retry.
      const filepath = path.join(project_path, filename);
      if (!fs.existsSync(filepath)) {
        throw new Error(
          `Agent did not write expected file: ${filename}. ` +
          `Agent response: ${raw.slice(0, 200)}`
        );
      }

      emit('chapter_complete', {
        index: i,
        file: filename,
        title: chapter.title
      });

      // Small delay to avoid rate limiting (only between chapters in the same run)
      if (step < indicesToGenerate.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      emit('chapter_failed', {
        index: i,
        title: chapter.title,
        error: e.message
      });
    }
  }

  emit('complete', { total_generated: indicesToGenerate.length });
}

/**
 * Explain selected text using Agent SDK (Sprint 3 task 3.5)
 * @param {Function} queryFn - Agent SDK query function or mock
 * @param {object} config - API config
 * @param {object} args - { text, context, maxLength }
 * @returns {Promise<string>} explanation text
 */
async function explainText(queryFn, config, args) {
  const { text, context, output_file } = args;

  if (!text || text.trim().length === 0) {
    throw new Error('解释文本不能为空');
  }
  if (!output_file) {
    throw new Error('output_file is required for explain');
  }

  // Truncate text to prevent abuse
  const limitedText = text.length > 200 ? text.substring(0, 200) : text;

  const prevQa = args.previousQa || [];
  const prevQaBlock = prevQa.length > 0
    ? `\n之前的对话：\n${prevQa.map((qa) => `Q: ${qa.q}\nA: ${qa.a}`).join('\n\n')}`
    : '';

  const prompt = `请用 explanation skill 解释以下内容。
- text: ${JSON.stringify(limitedText)}
${context ? `- context: ${JSON.stringify(context)}` : ''}
${prevQaBlock ? `- previousQa: ${JSON.stringify(prevQa)}` : ''}

${prevQaBlock ? `\n以下是之前的相关对话，请结合上下文回答：\n${prevQaBlock}` : ''}

用 Write 工具将结果写入：${output_file}
`;

  await collectAgentOutputWithRecovery(
    queryFn,
    {
      prompt,
      options: {
        allowedTools: ['Read', 'Write', 'Glob', 'Grep'],
        skills: ['explanation'],
        cwd: args.project_path,
        maxTokens: 2048,
        includePartialMessages: true
      }
    },
    args.session_id
  );

  // Agent wrote the result to disk — verify and let Rust read it back
  if (!fs.existsSync(output_file)) {
    throw new Error(`Agent did not write expected file: ${output_file}`);
  }

  log('info', 'explainText SUCCESS', { output_file });
}

/**
 * Generate extra quiz questions from Cornell explanation cues via agent.
 * Each cue has a concept name + Q&A history. The agent generates 1 question per concept
 * with high-quality distractors.
 *
 * @param {Function} queryFn - Agent SDK query function
 * @param {object} config - API config
 * @param {object} args - { project_path, concepts: [{ concept, qa_history }], session_id }
 * @returns {Promise<Array>} Array of QuizQuestion objects
 */
async function generateExtraQuiz(queryFn, config, args) {
  const { project_path, concepts, output_file } = args;
  if (!project_path || !concepts || !concepts.length) {
    throw new Error('project_path and concepts[] are required for generate-extra-quiz');
  }

  log('info', 'Starting generate-extra-quiz', {
    project_path,
    conceptCount: concepts.length,
    output_file,
    session_id: args.session_id || null
  });

  const conceptsJson = JSON.stringify(concepts, null, 2);

  const prompt = `请用 extra-quiz-generation skill 根据以下概念列表生成附加题。

概念列表（每个概念包含问答历史）：
${conceptsJson}

请根据 extra-quiz-generation skill 的规则，为每个概念生成一道高质量的单选测验题。注意：
1. Option A 必须基于问答历史中的解释内容
2. Option B/C/D 必须是合理但有陷阱的错误选项，不能是通用干扰项
3. 每个概念生成 exactly 1 题，不做任何截断
4. 用 Write 工具将结果写入：${output_file}
`;

  await collectAgentOutputWithRecovery(
    queryFn,
    {
      prompt,
      options: {
        allowedTools: ['Read', 'Write', 'Glob', 'Grep'],
        skills: ['extra-quiz-generation'],
        cwd: project_path,
        maxTokens: 4096,
        includePartialMessages: true,
      }
    },
    args.session_id
  );

  // Agent wrote the result to disk — verify and let Rust read it back
  if (!fs.existsSync(output_file)) {
    throw new Error(`Agent did not write expected file: ${output_file}`);
  }

  log('info', 'generate-extra-quiz SUCCESS', { output_file });
}

/**
 * Socratic review — Agent-driven Socratic dialogue (Sprint 8b)
 * @param {Function} queryFn - Agent SDK query function
 * @param {object} config - API config
 * @param {object} args - { project_path, concept_titles }
 * @returns {Promise<{content: string, done: boolean}>}
 */
async function socraticChat(queryFn, config, args) {
  const { project_path, concept_titles, concept_edges, user_answer } = args;

  if (!project_path) {
    throw new Error('project_path is required for socratic review');
  }

  const isFirstTurn = !user_answer;
  log('info', 'Starting socratic review', { project_path, concept_titles, first_turn: isFirstTurn });

  let socraticPrompt;
  if (isFirstTurn) {
    // Opening turn: name the skill explicitly (unique name avoids collision with
    // any global ~/.claude/skills skill) and feed the concept cluster + edge
    // relationships. The agent reads `.learning/socratic-sessions/*.json` itself
    // (the dir is fixed; the skill mandates it) and produces its own
    // mastered-vs-escaped assessment — a real summary, not a mechanical list.
    const titles = (concept_titles || []).join('、');
    const rels = (concept_edges || [])
      .map(pair => `${pair[0]} → ${pair[1]}`)
      .join('；');
    socraticPrompt =
      `请使用 typora-socratic-review skill 进行苏格拉底复习。\n` +
      `概念簇：${titles || '（空）'}\n` +
      `概念关系：${rels || '（无显式关系）'}\n` +
      `这是首轮。请严格按 skill 要求：先 Glob 并阅读 .learning/socratic-sessions/*.json（最近几份），` +
      `自行提炼哪些概念已掌握(end_reason=llm_done)、哪些被逃避(end_reason=user_ended)，` +
      `再围绕概念关系开场——优先把逃避的概念带回来、换角度重提，不要逐字重复旧问题。`;
  } else {
    // Subsequent turn: the user's answer. Prior turns are carried by the SDK
    // session (resume via session_id).
    socraticPrompt = user_answer;
  }

  // Capture the (possibly refreshed) SDK session id so the host can resume next turn
  let capturedSessionId = null;
  const output = await collectAgentOutputWithRecovery(
    queryFn,
    {
      prompt: socraticPrompt,
      options: {
        cwd: project_path,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        skills: ['typora-socratic-review'],
        includePartialMessages: true,
      }
    },
    args.session_id,
    (msg) => { if (msg && typeof msg === 'object' && msg.session_id) capturedSessionId = msg.session_id; }
  );

  if (!output || output.trim().length === 0) {
    throw new Error('Agent returned empty socratic response');
  }

  // Check for session end marker injected by skill rules. The opening turn must
  // never end the session — mastery can't be demonstrated before the user has
  // answered anything, yet some models append [SESSION_END] prematurely. Ignore
  // the marker on the first turn.
  const done = !isFirstTurn && output.includes('[SESSION_END]');
  const content = output.replace(/\[SESSION_END\]/g, '').trim();

  const session_id = capturedSessionId || args.session_id || null;
  log('info', 'Socratic review turn complete', { done, content_length: content.length, has_session: !!session_id });
  return { content, done, session_id };
}

/**
 * Generate a structured reading guide for an academic paper.
 * The agent uses typora-paper-reader skill to read the paper and write
 * the guide JSON to output_file. Host only validates the file exists.
 *
 * @param {Function} queryFn - Agent SDK query function or mock
 * @param {object} config - API config
 * @param {object} args - { paper_file, output_file, persona, session_id }
 */
async function generatePaperReaderGuide(queryFn, config, args) {
  const { paper_file, output_file, persona, session_id } = args;
  if (!paper_file) {
    throw new Error('paper_file is required for paper-reader');
  }
  if (!fs.existsSync(paper_file)) {
    throw new Error(`paper_file not found: ${paper_file}`);
  }
  if (!output_file) {
    throw new Error('output_file is required for paper-reader');
  }

  log('info', 'Starting paper-reader guide generation', { paper_file, output_file, session_id: session_id || null });
  emit('status', { message: 'AI 正在阅读论文并生成导读...' });

  const prompt = `请使用 typora-paper-reader skill 为以下论文生成导读。
- paper_file: ${JSON.stringify(paper_file)}
- output_file: ${JSON.stringify(output_file)}
- persona: ${JSON.stringify(persona || {})}

请使用 Read 工具读取论文全文，然后使用 Write 工具将 guide JSON 写入 output_file。`;

  await collectAgentOutputWithRecovery(
    queryFn,
    {
      prompt,
      options: {
        cwd: path.dirname(paper_file),
        allowedTools: ['Read', 'Write', 'Glob', 'Grep'],
        skills: ['typora-paper-reader'],
        includePartialMessages: true
      }
    },
    session_id
  );

  if (!fs.existsSync(output_file)) {
    throw new Error(`Agent did not write expected file: ${output_file}`);
  }

  log('info', 'paper-reader guide generation complete', { output_file });
  emit('complete', { output_file });
}

/**
 * Generate review cards (quiz questions + key points) for a completed chapter.
 * PB1 Round 2: Agent reads the chapter .md file and generates per-concept
 * review content. Outputs structured JSON for Rust to write to review-cards.json.
 *
 * @param {Function} queryFn - Agent SDK query function or mock
 * @param {object} config - API config
 * @param {object} args - { project_path, chapter_file, concepts, weak_concepts }
 * @returns {Promise<object>} { cards: { [concept_id]: { quiz_questions, key_points } } }
 */
async function generateReviewContent(queryFn, config, args) {
  const { project_path, chapter_file, concepts, weak_concepts } = args;
  if (!project_path || !chapter_file) {
    throw new Error('project_path and chapter_file are required for review-gen');
  }

  log('info', 'Starting review-gen', { project_path, chapter_file, conceptCount: concepts?.length });

  const prompt = `请使用 review-generation skill 为以下章节生成复习卡片。
- chapter_file: ${JSON.stringify(chapter_file)}
- concepts: ${JSON.stringify((concepts || []).map(c => ({ id: c.id, name: c.name })))}
- weak_concepts: ${JSON.stringify(weak_concepts || [])}

请使用 Read 工具读取项目根目录下的 ${chapter_file} 获取章节内容，然后为每个 concept 生成复习卡片。`;

  log('info', 'review-gen: invoking skill', { promptLength: prompt.length });

  const raw = await collectAgentOutputWithRecovery(
    queryFn,
    {
      prompt,
      options: {
        cwd: project_path,
        allowedTools: ['Read', 'Grep'],
        skills: ['review-generation'],
        includePartialMessages: true,
      }
    },
    args.session_id
  );

  if (!raw || raw.trim().length < 10) {
    throw new Error('Agent returned empty review content');
  }

  // Extract JSON from response (handle code blocks)
  let jsonStr = raw.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const result = JSON.parse(jsonStr);
  if (!result.cards || typeof result.cards !== 'object') {
    throw new Error('Agent response missing "cards" field');
  }

  log('info', 'review-gen complete', { cardCount: Object.keys(result.cards).length });
  return result;
}

/**
 * PB1 Batch: Generate review cards for multiple concepts across chapters in one agent call.
 * @param {Function} queryFn - Agent SDK query function or mock
 * @param {object} config - API config
 * @param {object} args - { project_path, concepts: [{ id, name, source_chapter, weak }] }
 * @returns {Promise<object>} { cards: { [concept_id]: { quiz_questions, key_points } } }
 */
async function generateReviewContentBatch(queryFn, config, args) {
  const { project_path, concepts } = args;
  if (!project_path) {
    throw new Error('project_path is required for review-gen-batch');
  }
  if (!concepts || concepts.length === 0) {
    return { cards: {} };
  }

  log('info', 'Starting review-gen-batch', { project_path, conceptCount: concepts.length });

  // Group concepts by source chapter for the prompt
  const byChapter = {};
  for (const c of concepts) {
    const ch = c.source_chapter || 'unknown';
    if (!byChapter[ch]) byChapter[ch] = [];
    byChapter[ch].push(c);
  }

  let chapterSection = '';
  for (const [chFile, chConcepts] of Object.entries(byChapter)) {
    chapterSection += `\n- chapter_file: ${JSON.stringify(chFile)}\n`;
    chapterSection += `  concepts: ${JSON.stringify(chConcepts.map(c => ({ id: c.id, name: c.name, weak: !!c.weak })))}\n`;
  }

  const prompt = `请使用 review-generation skill 为以下多个章节的 concepts 批量生成复习卡片。
${chapterSection}
weak_concepts: ${JSON.stringify(concepts.filter(c => c.weak).map(c => c.id))}

请使用 Read 工具读取上述章节文件获取内容，然后为每个 concept 生成复习卡片。所有 concept 的 cards 放在同一个 JSON 对象中返回。`;

  log('info', 'review-gen-batch: invoking skill', { promptLength: prompt.length });

  const raw = await collectAgentOutputWithRecovery(
    queryFn,
    {
      prompt,
      options: {
        cwd: project_path,
        allowedTools: ['Read', 'Grep'],
        skills: ['review-generation'],
        includePartialMessages: true,
      }
    },
    args.session_id
  );

  if (!raw || raw.trim().length < 10) {
    throw new Error('Agent returned empty review content');
  }

  // Extract JSON from response (handle code blocks)
  let jsonStr = raw.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const result = JSON.parse(jsonStr);
  if (!result.cards || typeof result.cards !== 'object') {
    throw new Error('Agent response missing "cards" field');
  }

  log('info', 'review-gen-batch complete', { cardCount: Object.keys(result.cards).length });
  return result;
}

/**
 * Initialize an agent session in the given project workspace.
 * Used by `create_project_with_session` (Rust) when a project is first created.
 * The agent is spawned with `cwd: project_path` and `allowedTools: []` (no
 * mutations during init — we just need a session id). The first system/
 * assistant message carries the session_id; we emit it as `session_init`.
 *
 * Subsequent agent activities (generate, explain, socratic, chat) pass
 * `resume: <session_id>` to share this session — the agent remembers the
 * project, prior turns, and any context the user has established.
 *
 * @param {Function} queryFn - Agent SDK query function or mock
 * @param {object} config - API config
 * @param {object} args - { project_path }
 * @returns {Promise<{ session_id: string }>}
 */
async function initSession(queryFn, config, args) {
  const { project_path } = args;
  if (!project_path) {
    throw new Error('initSession requires project_path');
  }

  // Inline chapter-generation skill references into the init prompt so the
  // agent has them in session context. Without this, every chapter generation
  // re-issues 3 Read tool calls (SKILL.md, content-format.md, examples.md) =
  // ~1.5-2s × N chapters wasted on redundant reads.
  const skillRefPaths = [
    `${project_path}/.claude/skills/chapter-generation/SKILL.md`,
    `${project_path}/.claude/skills/chapter-generation/references/content-format.md`
  ];
  const MAX_REF_BYTES = 24 * 1024; // 24KB cap to keep init prompt bounded
  const inlinedRefs = [];
  for (const refPath of skillRefPaths) {
    try {
      const content = fs.readFileSync(refPath, 'utf-8');
      if (content.length > MAX_REF_BYTES) {
        inlinedRefs.push(`=== ${path.basename(refPath)} (truncated to ${MAX_REF_BYTES} bytes) ===\n${content.slice(0, MAX_REF_BYTES)}\n... (省略 ${content.length - MAX_REF_BYTES} 字节)`);
      } else {
        inlinedRefs.push(`=== ${path.basename(refPath)} ===\n${content}`);
      }
    } catch (e) {
      log('warn', 'initSession: failed to inline skill reference', { refPath, error: e.message });
    }
  }
  const refsSection = inlinedRefs.length
    ? `\n\n以下是项目里 chapter-generation skill 的核心参考资料，请先阅读理解：\n\n${inlinedRefs.join('\n\n')}\n`
    : '';

  const stream = queryFn({
    prompt: `请使用 project-onboarding skill 了解这个项目，并返回项目摘要。

项目路径：${project_path}${refsSection}`,
    options: {
      cwd: project_path,
      // Allow Read/Glob during onboarding (per project-onboarding SKILL.md)
      allowedTools: ['Read', 'Glob', 'Grep'],
      skills: 'all',   // Agent SDK discovers all SKILL.md under cwd/.claude/skills/
      includePartialMessages: false
    }
  });

  let sessionId = null;
  for await (const msg of stream) {
    // All SDK message types that carry a session_id
    if (!sessionId && msg && typeof msg === 'object' && msg.session_id) {
      sessionId = msg.session_id;
    }
    if (msg.type === 'result') {
      break;
    }
  }

  if (!sessionId) {
    throw new Error('Failed to obtain session_id from agent stream');
  }

  log('info', 'initSession: session established', { session_id: sessionId });
  emit('session_init', { session_id: sessionId });
  return { session_id: sessionId };
}

/**
 * Generic chat — pure function interface for the LLM.
 *
 * Receives the full article + accumulated history + the latest user message,
 * and returns a single assistant reply. The caller (UI / session) owns
 * multi-turn state; this function is stateless and engine-agnostic, so
 * swapping the underlying agent implementation only requires changing
 * queryFn without touching call sites.
 *
 * @param {Function} queryFn - Agent SDK query function (or mock)
 * @param {object} config - API config
 * @param {object} args - { article, history, message, systemPrompt? }
 * @returns {Promise<string>} assistant response
 */
async function chatWithAgent(queryFn, config, args) {
  const { article, history, message, systemPrompt } = args;

  if (!message || message.trim().length === 0) {
    throw new Error('消息不能为空');
  }

  const historyText = (history || []).map(h => {
    const role = h.role === 'user' ? '用户' : 'AI';
    return `${role}: ${h.content}`;
  }).join('\n');

  const defaultSystem = `你是一位耐心、有洞察力的阅读伙伴。用户正在自由探索一篇文章，你可以：
- 用清晰的解释和贴切的类比帮助理解
- 联系相关知识拓宽视野
- 坦诚面对不确定的内容
- 用自然、对话式的语气交流`;

  const system = (systemPrompt && systemPrompt.trim().length > 0)
    ? systemPrompt
    : defaultSystem;

  const chatPrompt = `${system}

用户正在深度阅读一篇文章，并希望与你探讨其中的思想。

请根据文章内容和已有对话，回应用户。回复中可以使用 Markdown 格式（标题、加粗、列表、引用块等）来增强可读性。

---

## 文章全文

${article || '（未提供文章内容）'}

---

## 已有对话

${historyText || '（尚未有对话）'}

---

## 用户最新问题

${message}

请直接给出你的回复。如果合适，可以在结尾提出一个启发性追问。`;

  const output = await collectAgentOutputWithRecovery(
    queryFn,
    {
      prompt: chatPrompt,
      options: {
        // Read-only chat; agent can read project files for context
        allowedTools: ['Read', 'Glob', 'Grep'],
        skills: 'all',
        includePartialMessages: true
      }
    },
    args.session_id
  );

  if (!output || output.trim().length === 0) {
    throw new Error('Agent returned empty response');
  }

  return output.trim();
}

// Backwards-compat alias (Sprint 9 used this name)
const exploreChat = chatWithAgent;

// ============================================
// Agent SDK Availability Check
// ============================================
function checkAgentSDK() {
  log('info', 'Checking Claude Agent SDK availability...');
  try {
    const sdk = require('@anthropic-ai/claude-agent-sdk');
    const available = typeof sdk.query === 'function';
    log('info', 'Claude Agent SDK check result', { available });
    return { available, query: available ? sdk.query : undefined };
  } catch (e) {
    log('error', 'Claude Agent SDK not available', { error: e.message });
    return { available: false, error: e.message };
  }
}

// ============================================
// Load Agent SDK
// ============================================
function loadAgentSDK() {
  log('info', 'Loading Claude Agent SDK...');
  const result = checkAgentSDK();
  if (result.available) {
    return result.query;
  }
  emitError(
    'Claude Agent SDK not found. Please install it first:\n' +
    '  npm install -g @anthropic-ai/claude-code\n' +
    '  npm install -g @anthropic-ai/claude-agent-sdk\n\n' +
    'The Agent SDK is required for autonomous learning design capabilities.'
  );
}

// ============================================
// Main
// ============================================
async function main() {
  const args = process.argv.slice(2);
  log('info', 'Agent bridge started', { argv: args });

  if (args.length < 2) {
    emitError('用法: node agent-bridge.js <stage> <config_json>');
    return;
  }

  const stage = args[0];
  let config, taskArgs;

  try {
    const parsed = JSON.parse(args[1]);
    config = parsed.config;
    taskArgs = parsed.args;
    log('info', 'Arguments parsed', { stage, hasConfig: !!config, hasArgs: !!taskArgs });
  } catch (e) {
    log('error', 'Failed to parse arguments', { error: e.message, raw: args[1] });
    emitError(`参数解析失败: ${e.message}`);
    return;
  }

  // Load real Agent SDK for production
  const queryFn = loadAgentSDK();

  try {
    switch (stage) {
      case 'check': {
        log('info', 'Starting check stage');
        const result = checkAgentSDK();
        // Output clean JSON for Rust to parse; do not use emit() to avoid log pollution
        console.log(JSON.stringify({
          available: result.available,
          error: result.error || null
        }));
        log('info', 'Check stage completed', { available: result.available });
        process.exit(0);
        break;
      }
      case 'plan':
        log('info', 'Starting plan stage', { goal: taskArgs.goal, level: taskArgs.level, hours: taskArgs.hours });
        await planCourse(queryFn, config, taskArgs);
        log('info', 'Plan stage completed');
        process.exit(0);
        break;
      case 'generate':
        log('info', 'Starting generate stage', { project_path: taskArgs.project_path, chapterCount: taskArgs.outline?.chapters?.length, session_id: taskArgs.session_id || null });
        await generateChapters(queryFn, config, taskArgs);
        log('info', 'Generate stage completed');
        process.exit(0);
        break;
      case 'explain':
        log('info', 'Starting explain stage', { text_length: taskArgs.text?.length, context_length: taskArgs.context?.length, output_file: taskArgs.output_file, session_id: taskArgs.session_id || null });
        await explainText(queryFn, config, taskArgs);
        log('info', 'Explain stage completed');
        process.exit(0);
        break;
      case 'socratic':
        log('info', 'Starting socratic stage', { project_path: taskArgs.project_path, concept_titles: taskArgs.concept_titles, session_id: taskArgs.session_id || null });
        const socraticResult = await socraticChat(queryFn, config, taskArgs);
        // Output JSON for Rust to parse
        console.log(JSON.stringify(socraticResult));
        log('info', 'Socratic stage completed', { done: socraticResult.done, content_length: socraticResult.content.length });
        process.exit(0);
        break;
      case 'review-gen':
        log('info', 'Starting review-gen stage', { project_path: taskArgs.project_path, chapter_file: taskArgs.chapter_file, conceptCount: taskArgs.concepts?.length, session_id: taskArgs.session_id || null });
        const reviewCards = await generateReviewContent(queryFn, config, taskArgs);
        // Output JSON for Rust to parse and write to review-cards.json
        console.log(JSON.stringify(reviewCards));
        log('info', 'Review-gen stage completed', { cardCount: Object.keys(reviewCards.cards || {}).length });
        process.exit(0);
        break;
      case 'review-gen-batch':
        log('info', 'Starting review-gen-batch stage', { project_path: taskArgs.project_path, conceptCount: taskArgs.concepts?.length, session_id: taskArgs.session_id || null });
        const batchCards = await generateReviewContentBatch(queryFn, config, taskArgs);
        // Output JSON for Rust to parse and write to review-cards.json
        console.log(JSON.stringify(batchCards));
        log('info', 'Review-gen-batch stage completed', { cardCount: Object.keys(batchCards.cards || {}).length });
        process.exit(0);
        break;
      case 'generate-extra-quiz': {
        log('info', 'Starting generate-extra-quiz stage', { project_path: taskArgs.project_path, conceptCount: taskArgs.concepts?.length, session_id: taskArgs.session_id || null });
        await generateExtraQuiz(queryFn, config, taskArgs);
        log('info', 'Generate-extra-quiz stage completed');
        process.exit(0);
        break;
      }
      case 'paper-reader': {
        log('info', 'Starting paper-reader stage', { paper_file: taskArgs.paper_file, output_file: taskArgs.output_file, session_id: taskArgs.session_id || null });
        await generatePaperReaderGuide(queryFn, config, taskArgs);
        log('info', 'Paper-reader stage completed');
        process.exit(0);
        break;
      }
      case 'init':
        log('info', 'Starting init stage', { project_path: taskArgs.project_path });
        const initResult = await initSession(queryFn, config, taskArgs);
        // Output JSON for Rust to parse
        console.log(JSON.stringify(initResult));
        log('info', 'Init stage completed', { session_id: initResult.session_id });
        process.exit(0);
        break;
      case 'chat':
      case 'explore': {
        log('info', 'Starting chat stage', { article_length: taskArgs.article?.length, history_length: taskArgs.history?.length, message: taskArgs.message });
        const chatResult = await chatWithAgent(queryFn, config, taskArgs);
        // Output plain text for Rust to capture
        console.log(chatResult);
        log('info', 'Chat stage completed', { response_length: chatResult.length });
        process.exit(0);
        break;
      }
      default:
        emitError(`未知阶段: ${stage}`);
        process.exit(1);
    }
  } catch (e) {
    log('error', 'Stage execution failed', { error: e.message, stack: e.stack });
    emitError(e.message);
    process.exit(1);
  }
}

// ============================================
// Exports for testing
// ============================================
module.exports = {
  collectAgentOutput,
  extractJSON,
  generateFilename,
  planCourse,
  generateChapters,
  explainText,
  generateExtraQuiz,
  socraticChat,
  exploreChat,
  chatWithAgent,
  initSession,
  generatePaperReaderGuide,
  checkAgentSDK,
  emit,
  emitError,
  log
};

// Run if executed directly
if (require.main === module) {
  main().catch(e => {
    log('fatal', 'Unhandled exception', { error: e.message, stack: e.stack });
    emitError(e.message);
  });
}
