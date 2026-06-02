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
const LOG_FILE = path.join(process.cwd(), 'agent-bridge.log');

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, data };
  const line = JSON.stringify(entry);

  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch (e) {
    // Ignore log write errors
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
 */
async function collectAgentOutput(stream) {
  const chunks = [];
  let finalResult = null;

  for await (const msg of stream) {
    if (msg.type === 'assistant' && msg.content) {
      chunks.push(msg.content);
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
  "chapters": [
    {
      "title": "章节标题",
      "duration_minutes": 25,
      "concepts": ["概念1", "概念2"]
    }
  ],
  "total_duration": 170
}
\`\`\``,
    options: {
      allowedTools: []
    }
  });

  const output = await collectAgentOutput(stream);

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

  emit('outline', { outline });
}

/**
 * Generate chapters (testable)
 * @param {Function} queryFn - Agent SDK query function or mock
 * @param {object} config - API config
 * @param {object} args - { project_path, outline }
 */
async function generateChapters(queryFn, config, args) {
  const { project_path, outline } = args;
  const chapters = outline.chapters;
  const total = chapters.length;

  for (let i = 0; i < total; i++) {
    const chapter = chapters[i];

    emit('progress', {
      current: i + 1,
      total,
      chapter_title: chapter.title,
      status: 'generating'
    });

    const prevContext = i > 0
      ? `前面已生成的章节：\n${chapters.slice(0, i).map((ch, idx) => `${idx + 1}. ${ch.title}`).join('\n')}`
      : '这是第一章。';

    const stream = queryFn({
      prompt: `你是一个资深的技术写作专家。请生成以下章节的 Markdown 内容。

第 ${i + 1} 章：${chapter.title}
预计时长：${chapter.duration_minutes} 分钟
核心概念：${chapter.concepts.join('、')}

${prevContext}

写作风格要求：
1. 深入浅出：用生活化类比解释复杂概念
2. 逻辑连贯：每章结尾引出下一章的内容（如果有）
3. 有自己的思考：不仅罗列知识点，还要解释"为什么"
4. 适度总结：关键概念后给出简洁总结
5. 可视化：鼓励使用 Mermaid 图表、表格

内容格式要求：
- 使用标准 Markdown 语法
- 数学公式用 $...$ 和 $$...$$
- 代码块标注语言
- 每章必须包含：
  - 至少 2 个 \`> [!concept]\` 概念卡片
  - 至少 1 个 \`> [!question]\` 思考题（带 \`> [!answer]\` 答案）
  - 至少 1 个 \`> [!quiz]\` 测验题

直接输出 Markdown 内容，不要包裹在代码块中。`,
      options: {
        allowedTools: []
      }
    });

    try {
      const content = await collectAgentOutput(stream);

      if (!content || content.trim().length < 100) {
        throw new Error('Generated content is too short');
      }

      const filename = generateFilename(i, chapter.title);
      const filepath = path.join(project_path, filename);

      // Write file
      fs.writeFileSync(filepath, content, 'utf-8');

      emit('chapter_complete', {
        index: i,
        file: filename,
        title: chapter.title
      });

      // Small delay to avoid rate limiting
      if (i < total - 1) {
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

  emit('complete', { total_generated: total });
}

// ============================================
// Load Agent SDK
// ============================================
function loadAgentSDK() {
  log('info', 'Loading Claude Agent SDK...');
  try {
    const sdk = require('@anthropic-ai/claude-agent-sdk');
    log('info', 'Claude Agent SDK loaded successfully');
    return sdk.query;
  } catch (e) {
    log('error', 'Failed to load Claude Agent SDK', { error: e.message });
    emitError(
      'Claude Agent SDK not found. Please install it first:\n' +
      '  npm install -g @anthropic-ai/claude-code\n' +
      '  npm install -g @anthropic-ai/claude-agent-sdk\n\n' +
      'The Agent SDK is required for autonomous learning design capabilities.'
    );
  }
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
      case 'plan':
        log('info', 'Starting plan stage', { goal: taskArgs.goal, level: taskArgs.level, hours: taskArgs.hours });
        await planCourse(queryFn, config, taskArgs);
        log('info', 'Plan stage completed');
        process.exit(0);
        break;
      case 'generate':
        log('info', 'Starting generate stage', { project_path: taskArgs.project_path, chapterCount: taskArgs.outline?.chapters?.length });
        await generateChapters(queryFn, config, taskArgs);
        log('info', 'Generate stage completed');
        process.exit(0);
        break;
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
