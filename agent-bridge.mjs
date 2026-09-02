/**
 * Agent Bridge (pi kernel) - Node.js script for AI Learning Designer
 * Uses @earendil-works/pi-coding-agent SDK for autonomous agent capabilities.
 *
 * Usage:
 *   node agent-bridge.mjs <stage> <config_json>
 *
 * Stages (contracts unchanged from the claude-kernel bridge):
 *   check / plan / generate / explain / socratic / case-study / review-gen /
 *   review-gen-batch / generate-extra-quiz / paper-reader / init / chat / explore
 *
 * stdout = JSON lines for Rust (emit protocol unchanged), stderr = logs.
 * ESM-only SDK: this file is .mjs; SDK resolves via node_modules next to the
 * bridge (dev / auto-install) or absolute-path import from TYPORA_PI_SDK_ENTRY
 * (MSI / global install — ESM ignores NODE_PATH).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================
// Logging (identical to the claude-kernel bridge)
// ============================================
function _resolveLogDir() {
  if (process.env.TYPORA_NEXT_LOG_DIR) return process.env.TYPORA_NEXT_LOG_DIR;
  return __dirname;
}

const LOG_DIR = _resolveLogDir();
const LOG_FILE = path.join(LOG_DIR, 'agent-bridge.log');

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
  console.log(line);
  log('event', `Emitted: ${type}`, data);
}

function emitError(message, details = {}) {
  log('error', message, details);
  emit('error', { message, ...details });
  process.exit(1);
}

// ============================================
// Pi SDK loading (ESM: bare import or absolute-path fallback)
// ============================================
let _pi = null;

/** SDK entry candidates: env-provided absolute path, then node_modules next to bridge. */
export function resolveSdkEntry() {
  const envEntry = process.env.TYPORA_PI_SDK_ENTRY;
  if (envEntry && fs.existsSync(envEntry)) return envEntry;
  const local = path.join(__dirname, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js');
  if (fs.existsSync(local)) return local;
  return null;
}

/** Synchronous availability check (used by the `check` stage). */
export function checkAgentSDK() {
  const entry = resolveSdkEntry();
  return { available: !!entry, error: entry ? undefined : 'Pi SDK entry not found (no node_modules next to bridge and no TYPORA_PI_SDK_ENTRY)' };
}

async function loadPiSDK() {
  if (_pi) return _pi;
  const entry = resolveSdkEntry();
  if (!entry) {
    emitError(
      'Pi coding agent SDK not found. Please install it first:\n' +
      '  npm install -g @earendil-works/pi-coding-agent\n\n' +
      'The Pi SDK is required for autonomous learning design capabilities.'
    );
  }
  _pi = await import(pathToFileURL(entry).href);
  log('info', 'Pi SDK loaded', { entry });
  return _pi;
}

// ============================================
// Pi session factory + turn runner (the adapter layer)
// ============================================

/** Map AppConfig (ai_provider/ai_base_url/api_key/model) to a temp models.json.
 *  apiKey is referenced by ENV VAR NAME — the key itself never touches disk. */
export function _writeTempModelsJson(config) {
  const provider = (config?.ai_provider || 'anthropic').toLowerCase();
  const isAnthropic = provider !== 'openai';
  const providerId = 'typora-next-app';
  let baseUrl = (config?.ai_base_url || '').trim() || (isAnthropic ? 'https://api.anthropic.com' : 'https://api.openai.com');
  // pi 的 openai-completions 期望 baseUrl 自带版本段（直接拼 /chat/completions），
  // 而应用内 ureq 直调自己拼 /v1/chat/completions——两边用同一份 base_url 会有
  // 语义错位：deepseek 碰巧两种都通，api.openai.com 只通 /v1。归一化为 ureq 语义。
  if (!isAnthropic && !/\/v\d+\/?$/.test(baseUrl)) {
    baseUrl = baseUrl.replace(/\/+$/, '') + '/v1';
  }
  const modelId = (config?.model || '').trim() || (isAnthropic ? 'claude-3-5-haiku-20241022' : 'gpt-4o-mini');
  const envKey = `TYPORA_PI_KEY_${process.pid}`;
  if (config?.api_key) process.env[envKey] = config.api_key;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typora-pi-'));
  const modelsPath = path.join(dir, 'models.json');
  fs.writeFileSync(modelsPath, JSON.stringify({
    providers: {
      [providerId]: {
        baseUrl,
        // Probe-verified mapping (2026-08-04): anthropic-compatible endpoint
        // needs anthropic-messages; openai-completions 404s on such proxies.
        api: isAnthropic ? 'anthropic-messages' : 'openai-completions',
        apiKey: envKey,
        models: [{
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ['text'],
          contextWindow: 128000,
          maxTokens: 8192
        }]
      }
    }
  }, null, 2));
  return { dir, modelsPath, providerId, modelId };
}

/**
 * Run one agent turn on the pi kernel and collect the output.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {object} opts.config - AppConfig payload from Rust
 * @param {string} [opts.cwd] - working directory (skills/tools/sessions bind here)
 * @param {string[]} [opts.tools] - tool allowlist; [] = no tools
 * @param {string|null} [opts.sessionId] - pi session FILE path to resume (if any)
 * @param {Function} [opts.onToolLog] - (text) => void for progress_log lines
 * @returns {Promise<{output: string, sessionFile: string|null, refreshed: boolean}>}
 */
export async function runPiTurn(opts) {
  const result = _runnerOverride ? await _runnerOverride(opts) : await _runPiTurnReal(opts);
  // Uniform contract: both real and mock paths emit session_refresh here
  if (result.refreshed && result.sessionFile) {
    emit('session_refresh', { old_session_id: opts.sessionId || null, new_session_id: result.sessionFile });
  }
  return result;
}

async function _runPiTurnReal(opts) {
  const pi = await loadPiSDK();
  const { prompt, config, cwd, tools, sessionId, onToolLog } = opts;
  const workDir = cwd || process.cwd();

  const tmp = _writeTempModelsJson(config);
  let session = null;
  let refreshed = false;
  try {
    const authStorage = pi.AuthStorage.create(path.join(tmp.dir, 'auth.json'));
    const modelRegistry = pi.ModelRegistry.create(authStorage, tmp.modelsPath);
    const model = modelRegistry.find(tmp.providerId, tmp.modelId);
    if (!model) throw new Error(`model not resolvable: ${tmp.providerId}/${tmp.modelId}`);

    // agentDir required: DefaultPackageManager.addAutoDiscoveredResources
    // path.join()s on it inside reload() (crashes when omitted)
    const loader = new pi.DefaultResourceLoader({ cwd: workDir, agentDir: pi.getAgentDir() });
    await loader.reload();

    // Session resume with recovery: old claude IDs / missing files → fresh session
    let sessionManager;
    if (sessionId && fs.existsSync(sessionId)) {
      try {
        sessionManager = pi.SessionManager.open(sessionId);
      } catch (e) {
        log('warn', 'Session resume failed, falling back to fresh session', { attempted: sessionId, error: e.message });
        sessionManager = null;
      }
    }
    if (!sessionManager) {
      sessionManager = pi.SessionManager.create(workDir);
      refreshed = !!sessionId; // we were trying to resume and it failed
    }

    ({ session } = await pi.createAgentSession({
      cwd: workDir,
      model,
      authStorage,
      modelRegistry,
      resourceLoader: loader,
      sessionManager,
      tools: tools || [],
    }));

    // Collect streaming text deltas + tool activity for progress_log
    const chunks = [];
    session.subscribe((ev) => {
      if (ev.type === 'message_update' && ev.assistantMessageEvent?.type === 'text_delta') {
        chunks.push(ev.assistantMessageEvent.delta);
        // Sprint 17: 流式输出（案例研习等场景实时渲染）
        if (opts.onDelta) opts.onDelta(ev.assistantMessageEvent.delta);
      }
      if (ev.type === 'tool_execution_start' && onToolLog) {
        const logText = _toolLogText(ev.toolName, ev.args || {});
        if (logText) onToolLog(logText);
      }
    });

    await session.prompt(prompt);

    // Authoritative output: last assistant message's text blocks
    const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
    const output = lastAssistant?.content
      ?.filter(b => b.type === 'text')
      .map(b => b.text)
      .join('') || chunks.join('');

    return { output, sessionFile: session.sessionFile || null, refreshed };
  } finally {
    try { session?.dispose(); } catch (_) { /* ignore */ }
    try { fs.rmSync(tmp.dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    if (tmp.providerId && process.env[`TYPORA_PI_KEY_${process.pid}`]) {
      delete process.env[`TYPORA_PI_KEY_${process.pid}`];
    }
  }
}

/** Test injection point: replace the real runner with a mock. */
let _runnerOverride = null;
export function __setRunnerForTests(fn) { _runnerOverride = fn; }

/** Map pi tool executions to the user-facing progress_log lines (same emojis as before). */
function _toolLogText(toolName, args) {
  const fname = (p) => p ? path.basename(String(p)) : '';
  const target = args.path || args.file_path || args.pattern;
  if (toolName === 'write' && target) return `✓ 正在写 ${fname(target)}`;
  if (toolName === 'read' && target) return `📖 正在读 ${fname(target)}`;
  if (toolName === 'find' && target) return `🔍 正在搜索 ${target}`;
  if (toolName === 'grep' && target) return `🔍 正在搜索内容 ${target}`;
  return null;
}

/**
 * Extract JSON from agent output text (unchanged)
 */
export function extractJSON(text) {
  const codeBlock = text.match(/```json\n?([\s\S]*?)\n?```/);
  if (codeBlock) {
    return JSON.parse(codeBlock[1]);
  }
  const rawJson = text.match(/\{[\s\S]*\}/);
  if (rawJson) {
    return JSON.parse(rawJson[0]);
  }
  throw new Error('No JSON found in response');
}

/**
 * Generate safe filename from title (unchanged)
 */
export function generateFilename(index, title) {
  const paddedIndex = String(index).padStart(2, '0');
  const safeTitle = title
    .replace(/[^一-龥a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${paddedIndex}-${safeTitle}.md`;
}

// ============================================
// Stages (prompts + post-processing verbatim from the claude-kernel bridge)
// ============================================

export async function planCourse(queryFnUnused, config, args) {
  const { goal, level, hours } = args;

  const levelNames = {
    beginner: '小白（零基础）',
    intermediate: '有编程基础',
    advanced: '专业进阶'
  };

  emit('status', { message: 'AI 正在设计学习路径...' });

  const prompt = `你是一个资深的学习设计师。请根据以下信息设计一个结构化的学习大纲。

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
- project_slug 是用英文小写字母和短横线组成的目录名（kebab-case），用于作为文件系统目录名，比如 "diffusion-model" / "attention-mechanism" / "react-basics"。最多 50 字符。`;

  // Pure JSON-out task: no tools
  const { output } = await runPiTurn({ prompt, config, tools: [] });

  let outline;
  try {
    outline = extractJSON(output);
  } catch (e) {
    emitError(`无法解析大纲 JSON: ${e.message}\n原始响应: ${output.substring(0, 500)}`);
    return;
  }

  if (!outline.chapters || !Array.isArray(outline.chapters)) {
    emitError('大纲格式错误：缺少 chapters 数组');
    return;
  }

  outline.chapters = outline.chapters.map((ch, i) => ({
    title: ch.title || `第 ${i + 1} 章`,
    duration_minutes: ch.duration_minutes || 20,
    concepts: ch.concepts || []
  }));

  outline.total_duration = outline.chapters.reduce((sum, ch) => sum + ch.duration_minutes, 0);

  if (typeof outline.project_slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(outline.project_slug)) {
    outline.project_slug = 'learning-project';
  }

  emit('outline', { outline });
}

// Inline chapter-generation skill references (SKILL.md + content-format.md)
// into a prompt section. Reads the project's .pi/skills copy first, falling
// back to the legacy .claude/skills layout. Returns '' when nothing readable
// (skill not copied yet) — callers treat that as best-effort.
export function collectChapterSkillRefs(projectPath) {
  const skillRefPaths = [
    `${projectPath}/.pi/skills/chapter-generation/SKILL.md`,
    `${projectPath}/.pi/skills/chapter-generation/references/content-format.md`,
    // Legacy projects may still carry skills under .claude/skills
    `${projectPath}/.claude/skills/chapter-generation/SKILL.md`,
    `${projectPath}/.claude/skills/chapter-generation/references/content-format.md`
  ];
  const MAX_REF_BYTES = 24 * 1024;
  const inlinedRefs = [];
  const seen = new Set();
  for (const refPath of skillRefPaths) {
    try {
      const content = fs.readFileSync(refPath, 'utf-8');
      const key = path.basename(refPath);
      if (seen.has(key)) continue;
      seen.add(key);
      if (content.length > MAX_REF_BYTES) {
        inlinedRefs.push(`=== ${key} (truncated to ${MAX_REF_BYTES} bytes) ===\n${content.slice(0, MAX_REF_BYTES)}\n... (省略 ${content.length - MAX_REF_BYTES} 字节)`);
      } else {
        inlinedRefs.push(`=== ${key} ===\n${content}`);
      }
    } catch (e) {
      // missing legacy path is fine
    }
  }
  return inlinedRefs.length
    ? `\n\n以下是项目里 chapter-generation skill 的核心参考资料，请先阅读理解：\n\n${inlinedRefs.join('\n\n')}\n`
    : '';
}

// Build the per-chapter generation prompt (pure, unit-testable).
// courseType is optional — emitted only when the host supplied a value.
// hasSession switches item 1 between "already in session context" and
// "inlined above / re-Read if incomplete" (fresh sessions never saw the skill).
export function buildChapterPrompt({ index, chapter, projectPath, previousChapters, courseType, hasSession }) {
  const courseTypeLine = courseType ? `- course_type: ${courseType}\n` : '';
  const skillNote = hasSession
    ? '1. chapter-generation skill 的 SKILL.md 和 content-format.md 已经在 init session 里读过，session context 里就有；除非内容不全再 Read 补充，否则直接用 Write 写文件。'
    : `1. chapter-generation skill 的 SKILL.md 和 content-format.md 已附在上方；如未附或内容不全，再 Read ${JSON.stringify(`${projectPath}/.pi/skills/chapter-generation/references/content-format.md`)} 补充。之后直接用 Write 写文件。`;
  const prevContext = index > 0
    ? `前面已生成的章节：\n${previousChapters.map((t, idx) => `${idx + 1}. ${t}`).join('\n')}`
    : '这是第一章。';
  return `请使用 chapter-generation skill 生成第 ${index + 1} 章。
- chapter_index: ${index}
- chapter_title: ${JSON.stringify(chapter.title)}
- duration_minutes: ${chapter.duration_minutes}
- concepts: ${JSON.stringify(chapter.concepts)}
${courseTypeLine}- project_path: ${JSON.stringify(projectPath)}
- previous_chapters: ${JSON.stringify(previousChapters)}

${prevContext}

重要：
${skillNote}
2. 写完三个文件后，按 SKILL.md 的 MUST-VERIFY checklist 逐项检查，不通过就改。
3. 三个文件必须都存在且 quiz.json 顶层必须有 \`questions\` 字段（不是空对象、不是其他名字）。`;
}

export async function generateChapters(queryFnUnused, config, args) {
  const { project_path, outline, chapter_indices, course_type } = args;
  const allChapters = outline.chapters;
  const total = allChapters.length;

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

    // Fresh-session mode (no session_id): the agent never saw the skill refs,
    // so inline them into the chapter prompt instead of claiming they're in
    // session context.
    const chapterPrompt = (args.session_id ? '' : collectChapterSkillRefs(project_path))
      + buildChapterPrompt({
        index: i,
        chapter,
        projectPath: project_path,
        previousChapters: allChapters.slice(0, i).map((ch) => ch.title),
        courseType: course_type,
        hasSession: Boolean(args.session_id)
      });

    try {
      const { output: raw } = await runPiTurn({
        prompt: chapterPrompt,
        config,
        cwd: project_path,
        tools: ['read', 'write', 'find', 'grep'],
        sessionId: args.session_id,
        onToolLog: () => { /* per user feedback, chapter gen stays silent: progress events suffice */ }
      });

      if (!raw || raw.trim().length < 5) {
        throw new Error('Agent response too short — likely Write tool failure or session error');
      }

      const filename = generateFilename(i, chapter.title);
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

export async function explainText(queryFnUnused, config, args) {
  const { text, context, output_file } = args;

  if (!text || text.trim().length === 0) {
    throw new Error('解释文本不能为空');
  }
  if (!output_file) {
    throw new Error('output_file is required for explain');
  }

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

  await runPiTurn({
    prompt,
    config,
    cwd: args.project_path,
    tools: ['read', 'write', 'find', 'grep'],
    sessionId: args.session_id
  });

  if (!fs.existsSync(output_file)) {
    throw new Error(`Agent did not write expected file: ${output_file}`);
  }

  log('info', 'explainText SUCCESS', { output_file });
}

/**
 * quiz-repair stage（quiz-distractor-quality C 层）：对校验违规的题目做一轮
 * 定向重写。只改被列出的题的选项文本（保持题意与正确性），不动其他题。
 */
export async function repairQuizQuality(queryFnUnused, config, args) {
  const { project_path, repairs } = args;
  if (!project_path || !Array.isArray(repairs) || !repairs.length) {
    return;
  }

  const prompt = `刚生成的章节测验未通过质量校验，请定向修复以下文件中的违规题目。
- project_path: ${JSON.stringify(project_path)}
- repairs: ${JSON.stringify(repairs)}

对每个 quiz_file：
1. 用 Read 读取 {project_path}/{quiz_file}
2. 仅重写被列出的 question_id 那道题的**选项文本**（题意不变、正确项的事实不变）：
   - 最长选项与最短选项字数比 ≤ 1.8；正确项不得明显更长
   - 正确项若被判"照抄正文"，必须用自己的话改写
   - 干扰项必须是基于常见误解的合理陷阱，不得一眼荒谬或跨领域胡扯
   - 选项位置保持原样即可（前端会自动 shuffle）
3. 用 Write 写回整个文件：必须是合法 JSON（双引号转义！），顶层 questions 数组完整、其余题目原样保留。

全部修复后回复一行总结。`;

  const { output: raw } = await runPiTurn({
    prompt,
    config,
    cwd: project_path,
    tools: ['read', 'write'],
    sessionId: args.session_id || null
  });

  if (!raw || raw.trim().length < 2) {
    throw new Error('quiz-repair: agent response empty');
  }
}

/**
 * 构造 element-repair 的定向重写 prompt（纯函数，可单测）。
 * 只删/改被标记的编程代码块，其余内容原样保留。空 repairs 返回空串。
 */
export function buildElementRepairPrompt(project_path, repairs) {
  if (!project_path || !Array.isArray(repairs) || !repairs.length) {
    return '';
  }
  return `刚生成的章节包含不应用于本课程类型的编程代码块，请定向修复。
- project_path: ${JSON.stringify(project_path)}
- repairs: ${JSON.stringify(repairs)}

对每个 file：
1. 用 Read 读取 {project_path}/{file}
2. 只处理 violations 里列出的那个编程代码块（给定行号 lang）：
   - engineering 课：删掉该代码块，改用**真实公式 + 工艺/结构 mermaid 图 + 真实工业实例（设备型号/槽型/工艺参数/产地产能）**写同一内容
   - humanities 课：删掉该代码块，改用**具体作品实例（曲目+乐章+时间点 / 作品+年代 / 文献出处）**写同一内容
3. 用 Write 写回整个文件：除该处代码块改为学科化表达外，**其余内容原样保留，一字不改**。

全部修复后回复一行总结。`;
}

/**
 * element-repair stage（D 层元素合规）：对校验违规的编程代码块做一轮定向重写。
 * 只处理被判违规的代码块，其余内容不动。
 */
export async function repairElementCompliance(queryFnUnused, config, args) {
  const { project_path, repairs } = args;
  if (!project_path || !Array.isArray(repairs) || !repairs.length) {
    return;
  }

  const prompt = buildElementRepairPrompt(project_path, repairs);

  const { output: raw } = await runPiTurn({
    prompt,
    config,
    cwd: project_path,
    tools: ['read', 'write'],
    sessionId: args.session_id || null
  });

  if (!raw || raw.trim().length < 2) {
    throw new Error('element-repair: agent response empty');
  }
}

export async function generateExtraQuiz(queryFnUnused, config, args) {
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

  await runPiTurn({
    prompt,
    config,
    cwd: project_path,
    tools: ['read', 'write', 'find', 'grep'],
    sessionId: args.session_id
  });

  if (!fs.existsSync(output_file)) {
    throw new Error(`Agent did not write expected file: ${output_file}`);
  }

  log('info', 'generate-extra-quiz SUCCESS', { output_file });
}

export async function socraticChat(queryFnUnused, config, args) {
  const { project_path, concept_titles, concept_edges, user_answer } = args;

  if (!project_path) {
    throw new Error('project_path is required for socratic review');
  }

  const isFirstTurn = !user_answer;
  log('info', 'Starting socratic review', { project_path, concept_titles, first_turn: isFirstTurn });

  let socraticPrompt;
  if (isFirstTurn) {
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
    socraticPrompt = user_answer;
  }

  const { output, sessionFile } = await runPiTurn({
    prompt: socraticPrompt,
    config,
    cwd: project_path,
    // The skill drives its own file reads; bash not needed
    tools: ['read', 'write', 'find', 'grep'],
    sessionId: args.session_id
  });

  if (!output || output.trim().length === 0) {
    throw new Error('Agent returned empty socratic response');
  }

  const done = !isFirstTurn && output.includes('[SESSION_END]');
  const content = output.replace(/\[SESSION_END\]/g, '').trim();

  const session_id = sessionFile || args.session_id || null;
  log('info', 'Socratic review turn complete', { done, content_length: content.length, has_session: !!session_id });
  return { content, done, session_id };
}

/**
 * Case Study stage（Sprint 17）：划词选概念 → AI 生成教学案例 + 自由追问。
 * 与 socratic 同构（runPiTurn + sessionId 续聊），但无 done 状态——
 * 用户手动关闭面板，无 [SESSION_END] 契约。
 */
export async function caseStudyChat(queryFnUnused, config, args) {
  const { project_path, selected_text, context, user_answer } = args;

  if (!project_path) {
    throw new Error('project_path is required for case study');
  }
  if (!selected_text || !selected_text.trim()) {
    throw new Error('selected_text is required for case study');
  }

  const isFirstTurn = !user_answer;
  log('info', 'Starting case study', { project_path, selected_text, first_turn: isFirstTurn });

  const prompt = isFirstTurn
    ? `请使用 typora-course-case-study skill 生成教学案例。\n` +
      `选中概念: ${JSON.stringify(selected_text)}\n` +
      (context ? `章节上下文: ${JSON.stringify(context)}\n` : '')
    : user_answer;

  const { output, sessionFile } = await runPiTurn({
    prompt,
    config,
    cwd: project_path,
    tools: ['read', 'write', 'find', 'grep'],
    sessionId: args.session_id,
    // Sprint 17: 流式输出——text_delta 实时 emit，Rust 逐行转发给前端渲染
    onDelta: (delta) => emit('case_study_delta', { delta })
  });

  if (!output || output.trim().length === 0) {
    throw new Error('Agent returned empty case study response');
  }

  const session_id = sessionFile || args.session_id || null;
  log('info', 'Case study turn complete', { content_length: output.trim().length, has_session: !!session_id });
  return { content: output.trim(), done: false, session_id };
}

export async function generatePaperReaderGuide(queryFnUnused, config, args) {
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

  await runPiTurn({
    prompt,
    config,
    cwd: path.dirname(paper_file),
    tools: ['read', 'write', 'find', 'grep'],
    sessionId: session_id
  });

  if (!fs.existsSync(output_file)) {
    throw new Error(`Agent did not write expected file: ${output_file}`);
  }

  log('info', 'paper-reader guide generation complete', { output_file });
  emit('complete', { output_file });
}

export async function generateReviewContent(queryFnUnused, config, args) {
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

  const { output: raw } = await runPiTurn({
    prompt,
    config,
    cwd: project_path,
    tools: ['read', 'grep'],
    sessionId: args.session_id
  });

  if (!raw || raw.trim().length < 10) {
    throw new Error('Agent returned empty review content');
  }

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

export async function generateReviewContentBatch(queryFnUnused, config, args) {
  const { project_path, concepts } = args;
  if (!project_path) {
    throw new Error('project_path is required for review-gen-batch');
  }
  if (!concepts || concepts.length === 0) {
    return { cards: {} };
  }

  log('info', 'Starting review-gen-batch', { project_path, conceptCount: concepts.length });

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

  const { output: raw } = await runPiTurn({
    prompt,
    config,
    cwd: project_path,
    tools: ['read', 'grep'],
    sessionId: args.session_id
  });

  if (!raw || raw.trim().length < 10) {
    throw new Error('Agent returned empty review content');
  }

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

export async function initSession(queryFnUnused, config, args) {
  const { project_path } = args;
  if (!project_path) {
    throw new Error('initSession requires project_path');
  }

  // Inline chapter-generation skill references into the init prompt so the
  // agent has them in session context (avoids N redundant Reads at generate).
  const refsSection = collectChapterSkillRefs(project_path);

  const { sessionFile } = await runPiTurn({
    prompt: `请使用 project-onboarding skill 了解这个项目，并返回项目摘要。

项目路径：${project_path}${refsSection}`,
    config,
    cwd: project_path,
    tools: ['read', 'find', 'grep']
  });

  if (!sessionFile) {
    throw new Error('Failed to obtain session file from pi session');
  }

  log('info', 'initSession: session established', { session_id: sessionFile });
  emit('session_init', { session_id: sessionFile });
  return { session_id: sessionFile };
}

export async function chatWithAgent(queryFnUnused, config, args) {
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

  const { output } = await runPiTurn({
    prompt: chatPrompt,
    config,
    tools: ['read', 'find', 'grep'],
    sessionId: args.session_id
  });

  if (!output || output.trim().length === 0) {
    throw new Error('Agent returned empty response');
  }

  return output.trim();
}

// Backwards-compat alias (Sprint 9 used this name)
export const exploreChat = chatWithAgent;

// ============================================
// Main
// ============================================
async function main() {
  const args = process.argv.slice(2);
  log('info', 'Agent bridge (pi kernel) started', { argv: args });

  if (args.length < 2) {
    emitError('用法: node agent-bridge.mjs <stage> <config_json>');
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

  try {
    switch (stage) {
      case 'check': {
        log('info', 'Starting check stage');
        const result = checkAgentSDK();
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
        await planCourse(null, config, taskArgs);
        log('info', 'Plan stage completed');
        process.exit(0);
        break;
      case 'generate':
        log('info', 'Starting generate stage', { project_path: taskArgs.project_path, chapterCount: taskArgs.outline?.chapters?.length, session_id: taskArgs.session_id || null });
        await generateChapters(null, config, taskArgs);
        log('info', 'Generate stage completed');
        process.exit(0);
        break;
      case 'explain':
        log('info', 'Starting explain stage', { text_length: taskArgs.text?.length, context_length: taskArgs.context?.length, output_file: taskArgs.output_file, session_id: taskArgs.session_id || null });
        await explainText(null, config, taskArgs);
        log('info', 'Explain stage completed');
        process.exit(0);
        break;
      case 'socratic': {
        log('info', 'Starting socratic stage', { project_path: taskArgs.project_path, concept_titles: taskArgs.concept_titles, session_id: taskArgs.session_id || null });
        const socraticResult = await socraticChat(null, config, taskArgs);
        console.log(JSON.stringify(socraticResult));
        log('info', 'Socratic stage completed', { done: socraticResult.done, content_length: socraticResult.content.length });
        process.exit(0);
      }
      case 'case-study': {
        log('info', 'Starting case-study stage', { project_path: taskArgs.project_path, selected_text: taskArgs.selected_text, session_id: taskArgs.session_id || null });
        const caseResult = await caseStudyChat(null, config, taskArgs);
        console.log(JSON.stringify(caseResult));
        log('info', 'Case-study stage completed', { content_length: caseResult.content.length });
        process.exit(0);
      }
      case 'review-gen': {
        log('info', 'Starting review-gen stage', { project_path: taskArgs.project_path, chapter_file: taskArgs.chapter_file, conceptCount: taskArgs.concepts?.length, session_id: taskArgs.session_id || null });
        const reviewCards = await generateReviewContent(null, config, taskArgs);
        console.log(JSON.stringify(reviewCards));
        log('info', 'Review-gen stage completed', { cardCount: Object.keys(reviewCards.cards || {}).length });
        process.exit(0);
      }
      case 'review-gen-batch': {
        log('info', 'Starting review-gen-batch stage', { project_path: taskArgs.project_path, conceptCount: taskArgs.concepts?.length, session_id: taskArgs.session_id || null });
        const batchCards = await generateReviewContentBatch(null, config, taskArgs);
        console.log(JSON.stringify(batchCards));
        log('info', 'Review-gen-batch stage completed', { cardCount: Object.keys(batchCards.cards || {}).length });
        process.exit(0);
      }
      case 'generate-extra-quiz': {
        log('info', 'Starting generate-extra-quiz stage', { project_path: taskArgs.project_path, conceptCount: taskArgs.concepts?.length, session_id: taskArgs.session_id || null });
        await generateExtraQuiz(null, config, taskArgs);
        log('info', 'Generate-extra-quiz stage completed');
        process.exit(0);
      }
      case 'quiz-repair': {
        log('info', 'Starting quiz-repair stage', { project_path: taskArgs.project_path, fileCount: taskArgs.repairs?.length });
        await repairQuizQuality(null, config, taskArgs);
        log('info', 'Quiz-repair stage completed');
        process.exit(0);
      }
      case 'element-repair': {
        log('info', 'Starting element-repair stage', { project_path: taskArgs.project_path, fileCount: taskArgs.repairs?.length });
        await repairElementCompliance(null, config, taskArgs);
        log('info', 'Element-repair stage completed');
        process.exit(0);
      }
      case 'paper-reader': {
        log('info', 'Starting paper-reader stage', { paper_file: taskArgs.paper_file, output_file: taskArgs.output_file, session_id: taskArgs.session_id || null });
        await generatePaperReaderGuide(null, config, taskArgs);
        log('info', 'Paper-reader stage completed');
        process.exit(0);
      }
      case 'init': {
        log('info', 'Starting init stage', { project_path: taskArgs.project_path });
        const initResult = await initSession(null, config, taskArgs);
        console.log(JSON.stringify(initResult));
        log('info', 'Init stage completed', { session_id: initResult.session_id });
        process.exit(0);
      }
      case 'chat':
      case 'explore': {
        log('info', 'Starting chat stage', { article_length: taskArgs.article?.length, history_length: taskArgs.history?.length, message: taskArgs.message });
        const chatResult = await chatWithAgent(null, config, taskArgs);
        console.log(chatResult);
        log('info', 'Chat stage completed', { response_length: chatResult.length });
        process.exit(0);
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

// Run if executed directly
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => {
    log('fatal', 'Unhandled exception', { error: e.message, stack: e.stack });
    emitError(e.message);
  });
}
