/**
 * Agent Bridge (pi kernel) - Node.js script for AI Learning Designer
 * Uses @earendil-works/pi-coding-agent SDK for autonomous agent capabilities.
 *
 * Usage:
 *   node agent-bridge.mjs <stage> <config_json>
 *
 * Stages (contracts unchanged from the claude-kernel bridge):
 *   check / plan / generate / explain / socratic / case-study / own-voice /
 *   visualize / review-gen /
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

  // stderr 管道死锁（2026-10-15 实测）：Windows 上 Node 对管道的写入是同步的，
  // 调用方（Rust 流式命令）只排空 stdout；debug 洪峰（思考型模型一轮数千条
  // thinking_delta ≈ 64KB）写满管道缓冲后 console.error 阻塞整个事件循环，
  // 看门狗随事件循环一起饿死、双方互锁永不退出。debug 只落文件。
  if (level !== 'debug') console.error(`[${level}] ${message}`);
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
 *  apiKey is referenced via ENV VAR (bare name on pi ≤ 0.74, $NAME on ≥ 0.84) —
 *  the key itself never touches disk. */
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
  // pi ≥ 0.84 只插值 $VAR/${VAR} 语法，裸名会被当作字面 key（401 报 key 尾部 = pid 尾部）；
  // pi ≤ 0.74 用裸 env var 名。按已加载 SDK 的代际选择引用形式。
  const apiKeyRef = (typeof _pi?.ModelRuntime?.create === 'function') ? `$${envKey}` : envKey;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typora-pi-'));
  const modelsPath = path.join(dir, 'models.json');
  fs.writeFileSync(modelsPath, JSON.stringify({
    providers: {
      [providerId]: {
        baseUrl,
        // Probe-verified mapping (2026-08-04): anthropic-compatible endpoint
        // needs anthropic-messages; openai-completions 404s on such proxies.
        api: isAnthropic ? 'anthropic-messages' : 'openai-completions',
        apiKey: apiKeyRef,
        models: [{
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ['text'],
          contextWindow: 128000,
          // "不限制 token"：pi 总会发送 model.maxTokens（缺省回落 16384，无省略通道），
          // 每请求由 clampMaxTokensToContext 夹到 contextWindow−输入−4096。给一个恒大于
          // 剩余窗口的值（服务端实测接受 131072→HTTP 200），实际输出上限即上下文余量。
          maxTokens: 131072
        }]
      }
    }
  }, null, 2));
  return { dir, modelsPath, providerId, modelId };
}

// ============================================
// Sprint 26: wikimedia-commons skill 受限 bash 执行器
// 能力住在 skill 里（SKILL.md + scripts/wiki-fetch.mjs），bridge 只提供
// 一把「锁死的钥匙」：自定义 BashOperations 只放行 wiki-fetch.mjs 调用。
// ============================================

const WIKI_FETCH_SCRIPT_SUFFIX = /wikimedia-commons[\\/]scripts[\\/]wiki-fetch\.mjs$/;
const WIKI_FETCH_HOSTS = ['commons.wikimedia.org', 'upload.wikimedia.org'];
// 整条命令必须精确为 `node <脚本路径> <https-url>`（引号可选）——
// ^$ 锚定使任何拼接（&& ; | > 反引号 $(…)）都直接失配。
const WIKI_FETCH_CMD_RE = /^node\s+"?([^"\s]+)"?\s+"?(https:\/\/[^\s"]+)"?\s*$/;

export function isWikiFetchCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  const m = command.trim().match(WIKI_FETCH_CMD_RE);
  if (!m) return false;
  if (!WIKI_FETCH_SCRIPT_SUFFIX.test(m[1])) return false;
  try {
    return WIKI_FETCH_HOSTS.includes(new URL(m[2]).hostname);
  } catch {
    return false;
  }
}

/**
 * 构建受限 bash 工具（pi ≥ 0.84 createBashToolDefinition；旧版返回 null 跳过）。
 * exec 不经 shell，直接 execFile spawn node——命令拼接注入在 OS 层也不成立。
 */
function buildWikiFetchBashTool(pi, cwd) {
  if (typeof pi.createBashToolDefinition !== 'function') return null;
  return pi.createBashToolDefinition(cwd, {
    operations: {
      async exec(command, _cwd, { onData }) {
        const m = typeof command === 'string' ? command.trim().match(WIKI_FETCH_CMD_RE) : null;
        if (!m || !isWikiFetchCommand(command)) {
          onData(Buffer.from('rejected: this shell only runs the wikimedia-commons skill script (node .../wikimedia-commons/scripts/wiki-fetch.mjs "<https-url>")\n'));
          return { exitCode: 1 };
        }
        const { execFile } = await import('node:child_process');
        return await new Promise((resolve) => {
          // process.execPath = 当前 bridge 自己的 node 二进制，不依赖 PATH
          execFile(process.execPath, [m[1], m[2]], { timeout: 30000, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
            if (stdout) onData(Buffer.from(stdout));
            if (stderr) onData(Buffer.from(stderr));
            if (err && !stdout) onData(Buffer.from(String(err.message || err)));
            resolve({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0 });
          });
        });
      },
    },
  });
}

// ============================================
// Sprint 31: paper-rescue skill 受限 bash 执行器
// 同 wiki-fetch 模式：自定义 BashOperations 只放行 paper-rescue/scripts 下
// 两个固定端点脚本（openalex-lookup / anysearch-lookup）。
// AnySearch key 通过环境变量注入子进程（不进 argv / 日志）。
// ============================================

const PAPER_RESCUE_SCRIPT_RE = /paper-rescue[\\/]scripts[\\/](openalex-lookup|anysearch-lookup)\.mjs$/;
// 整条命令必须精确为 `node <脚本路径> "<参数>"`——^$ 锚定使任何拼接直接失配。
const PAPER_RESCUE_CMD_RE = /^node\s+"?([^"\s]+)"?\s+"([^"]+)"\s*$/;

export function isPaperRescueCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  const m = command.trim().match(PAPER_RESCUE_CMD_RE);
  if (!m) return false;
  return PAPER_RESCUE_SCRIPT_RE.test(m[1]);
}

/**
 * 构建 paper-rescue 受限 bash 工具。anysearchKey 仅在运行 anysearch-lookup.mjs
 * 时以 TYPORA_ANYSEARCH_KEY 注入子进程 env；openalex-lookup 不需要 key。
 */
function buildPaperRescueBashTool(pi, cwd, anysearchKey) {
  if (typeof pi.createBashToolDefinition !== 'function') return null;
  return pi.createBashToolDefinition(cwd, {
    operations: {
      async exec(command, _cwd, { onData }) {
        const m = typeof command === 'string' ? command.trim().match(PAPER_RESCUE_CMD_RE) : null;
        if (!m || !isPaperRescueCommand(command)) {
          onData(Buffer.from('rejected: this shell only runs the paper-rescue skill scripts (node .../paper-rescue/scripts/(openalex-lookup|anysearch-lookup).mjs "<arg>")\n'));
          return { exitCode: 1 };
        }
        const scriptPath = m[1];
        const isAnysearch = /anysearch-lookup\.mjs$/.test(scriptPath);
        const env = isAnysearch && anysearchKey
          ? { ...process.env, TYPORA_ANYSEARCH_KEY: anysearchKey }
          : process.env;
        const { execFile } = await import('node:child_process');
        return await new Promise((resolve) => {
          execFile(process.execPath, [scriptPath, m[2]], { timeout: 30000, maxBuffer: 64 * 1024, env }, (err, stdout, stderr) => {
            if (stdout) onData(Buffer.from(stdout));
            if (stderr) onData(Buffer.from(stderr));
            if (err && !stdout) onData(Buffer.from(String(err.message || err)));
            resolve({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0 });
          });
        });
      },
    },
  });
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
 * @param {boolean} [opts.wikiFetch] - inject the wikimedia-commons sandboxed bash
 *        tool (Sprint 26): a bash whose custom BashOperations only runs the
 *        skill's wiki-fetch.mjs script; every other command is rejected.
 * @param {object} [opts.paperRescue] - inject the paper-rescue sandboxed bash
 *        (Sprint 31): only runs paper-rescue/scripts lookup scripts;
 *        { anysearchKey } is passed to anysearch-lookup.mjs via env only.
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
  const { prompt, config, cwd, tools, sessionId, onToolLog, wikiFetch, paperRescue } = opts;
  const workDir = cwd || process.cwd();

  // Sprint 26: wikiFetch 模式注入受限 bash（customTools）+ 名字放行
  const customTools = [];
  let toolNames = tools || [];
  if (wikiFetch) {
    const t = buildWikiFetchBashTool(pi, workDir);
    if (t) {
      customTools.push(t);
      toolNames = [...toolNames, 'bash'];
    } else {
      log('warn', 'wiki-fetch bash tool unavailable: pi.createBashToolDefinition missing (old SDK?)');
    }
  }
  // Sprint 31: paperRescue 模式注入受限 bash（两脚本固定端点查询）
  if (paperRescue) {
    const t = buildPaperRescueBashTool(pi, workDir, paperRescue.anysearchKey || '');
    if (t) {
      customTools.push(t);
      if (!toolNames.includes('bash')) toolNames = [...toolNames, 'bash'];
    } else {
      log('warn', 'paper-rescue bash tool unavailable: pi.createBashToolDefinition missing (old SDK?)');
    }
  }

  const tmp = _writeTempModelsJson(config);
  let session = null;
  let refreshed = false;
  try {
    // pi SDK 两代 API 兼容（2026-09-03：全局包 0.74.2→0.84.3 重构后 AuthStorage
    // 不再导出、ModelRegistry.create 移除，init 全线崩溃 "Cannot read properties
    // of undefined (reading 'create')"）。0.84+ 走 ModelRuntime.create；旧版回退原路径。
    const authPath = path.join(tmp.dir, 'auth.json');
    let model, modelRuntime, authStorage, modelRegistry;
    if (typeof pi.ModelRuntime?.create === 'function') {
      // pi ≥ 0.84：ModelRuntime 是 model/auth 的唯一入口（authPath 指文件、
      // modelsPath 指我们的临时 models.json；默认无网络刷新）
      modelRuntime = await pi.ModelRuntime.create({ authPath, modelsPath: tmp.modelsPath });
      modelRegistry = new pi.ModelRegistry(modelRuntime);
      model = modelRegistry.find(tmp.providerId, tmp.modelId);
    } else {
      // pi ≤ 0.74 旧 API
      authStorage = pi.AuthStorage.create(authPath);
      modelRegistry = pi.ModelRegistry.create(authStorage, tmp.modelsPath);
      model = modelRegistry.find(tmp.providerId, tmp.modelId);
    }
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
      // pi ≥0.84 新增 thinkingLevel，默认 'medium'：reasoning 模型（deepseek-v4-flash）
      // 的思考 token 会吃掉整个 maxTokens 输出预算，正文/toolCall 在截断前就发不出
      // （2026-09-03 章节生成全停 stopReason=length、不写文件的根因）。0.74 无 thinking
      // 语义，显式 off 恢复旧行为。
      thinkingLevel: 'off',
      // LLM 流静默断流兜底（2026-10-14 两次实测 DeepSeek ~60s 处断流）：SDK 默认
      // httpIdleTimeoutMs=300s 才发现流死，叠加 3 次 turn 级自动重试最坏挂 15+ 分钟。
      // 收紧到 60s——正常流式 delta 间隔 <1s，60s 无数据即判死，交 SDK 自动重试
      // 快速恢复。inMemory：setter 会落盘，不能污染用户全局 settings.json。
      settingsManager: pi.SettingsManager.inMemory({
        httpIdleTimeoutMs: Number(process.env.TYPORA_AGENT_HTTP_IDLE_MS) || 60000,
      }),
      // 0.84+ 用 modelRuntime；旧版用 authStorage/modelRegistry（undefined 字段被忽略）
      ...(modelRuntime ? { modelRuntime } : { authStorage, modelRegistry }),
      resourceLoader: loader,
      sessionManager,
      tools: toolNames,
      ...(customTools.length ? { customTools } : {}),
    }));

    // Collect streaming text deltas + tool activity for progress_log
    const chunks = [];
    // 断流看门狗：活性信号 = 任何 session 事件（delta / tool 执行起止）。
    // 90s 余量覆盖慢 TTFT 与 wikimedia 检索；可用 TYPORA_AGENT_STALL_MS 覆盖。
    const stallMs = Number(process.env.TYPORA_AGENT_STALL_MS) || 90000;
    let rejectStall;
    const stallPromise = new Promise((_, rej) => { rejectStall = rej; });
    const watchdog = createStallWatchdog({
      stallMs,
      onStall: () => {
        log('error', 'Agent stream stalled, aborting turn', { stall_ms: stallMs });
        try { session.abort?.()?.catch?.(() => {}); } catch (_) { /* best effort */ }
        rejectStall(new Error(`模型响应中断（${Math.round(stallMs / 1000)} 秒无数据，疑似网络或服务端断流），请重试`));
      }
    });
    session.subscribe((ev) => {
      watchdog.touch();
      // 非流式事件留痕（auto_retry_start 带 errorMessage，断流排查的第一手证据）。
      // 逐 delta（text/thinking/toolcall）不记：思考型模型一轮数千条，既是日志洪水
      // 也是 stderr 管道死锁的直接推手（见 log() 内注释）；start/end 边界足够定位。
      const subType = ev.assistantMessageEvent?.type;
      const deltaNoise = subType === 'text_delta' || subType === 'thinking_delta' || subType === 'toolcall_delta';
      if (!deltaNoise && (ev.type !== 'message_update' || subType)) {
        log('debug', 'session event', { type: ev.type, sub: subType, error: ev.errorMessage });
      }
      // 断流容灾（2026-10-14 设计）：SDK 内部自动重试对用户不可见是假安全感，
      // 翻译成 status 事件透出给前端状态条
      if (ev.type === 'auto_retry_start') {
        const hint = ev.errorMessage ? `：${ev.errorMessage}` : '';
        emit('status', { stage: 'retry', message: `⚠️ 连接中断，正在自动重试（第 ${ev.attempt}/${ev.maxAttempts} 次）${hint}` });
      }
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

    try {
      // 状态透出：让用户知道请求已发出、还在等首字节（而不是对着死气泡干等）
      emit('status', { stage: 'connecting', message: '正在连接模型…' });
      await Promise.race([session.prompt(prompt), stallPromise]);
    } finally {
      watchdog.stop();
    }

    // Authoritative output: last assistant message's text blocks
    const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant?.stopReason === 'length') {
      // maxTokens 已按上下文余量放开；走到这里说明整窗打满，重试也无法变长
      throw new Error(`model output hit context limit (stopReason=length, model=${tmp.modelId})`);
    }
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

/**
 * Stall watchdog: fires onStall once if no touch() arrives within stallMs.
 *
 * 背景（2026-10-14 两次实测）：DeepSeek SSE 流式响应会在 ~60s 处被静默掐断
 * ——TCP 连接死亡但 SDK 收不到任何错误事件，`session.prompt()` 的 Promise
 * 永不 settle，node 进程空转、前端永远卡在 loading。看门狗以「任何 session
 * 事件」为活性信号挂在 subscribe 里，超窗即 abort + 让错误透出给前端。
 */
export function createStallWatchdog({ stallMs, checkMs, onStall }) {
  let lastActivity = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - lastActivity >= stallMs) {
      clearInterval(timer);
      onStall();
    }
  }, checkMs || Math.min(5000, stallMs));
  return {
    touch() { lastActivity = Date.now(); },
    stop() { clearInterval(timer); }
  };
}

/**
 * 错误分级（断流容灾设计 2026-10-14）：前端按码显示分级文案与动作按钮。
 * STALL=断流/超时类（值得重试）；AUTH_FAILED=key 问题（重试无意义，引导改配置）；
 * NETWORK=连接类（检查网络/base_url）；UNKNOWN=其余。
 */
export function classifyError(err) {
  const msg = String((err && err.message) || err || '');
  if (/无数据|断流|响应中断|stream.*(stall|idle)/i.test(msg)) return 'STALL';
  if (/\b(401|403)\b|unauthorized|forbidden|invalid api key|incorrect api key/i.test(msg)) return 'AUTH_FAILED';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|getaddrinfo|timed? ?out|超时/i.test(msg)) return 'NETWORK';
  return 'UNKNOWN';
}

/**
 * 真实连通性 ping（agent 检测诚实化）：用激活配置发 max_tokens=1 的最小请求。
 * fetchImpl 可注入（测试用）；默认全局 fetch + 15s 超时。
 * @returns {Promise<{ok: true} | {ok: false, code: string, message: string}>}
 */
export async function pingProvider(config, fetchImpl) {
  const provider = (config?.ai_provider || 'anthropic').toLowerCase();
  const isAnthropic = provider !== 'openai';
  let baseUrl = (config?.ai_base_url || '').trim()
    || (isAnthropic ? 'https://api.anthropic.com' : 'https://api.openai.com');
  let url, headers;
  const body = { model: (config?.model || '').trim(), max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] };
  if (isAnthropic) {
    url = baseUrl.replace(/\/+$/, '') + '/v1/messages';
    headers = { 'content-type': 'application/json', 'x-api-key': config?.api_key || '', 'anthropic-version': '2023-06-01' };
  } else {
    // 与 _writeTempModelsJson 同一归一化语义：openai 系补 /v1 版本段
    if (!/\/v\d+\/?$/.test(baseUrl)) baseUrl = baseUrl.replace(/\/+$/, '') + '/v1';
    url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
    headers = { 'content-type': 'application/json', 'Authorization': `Bearer ${config?.api_key || ''}` };
  }

  const timeoutMs = Number(process.env.TYPORA_AGENT_PING_TIMEOUT_MS) || 15000;
  const doFetch = fetchImpl || globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    if (resp.ok) return { ok: true };
    let detail = '';
    try { detail = String(await resp.text()).slice(0, 200); } catch (_) { /* ignore */ }
    const message = `HTTP ${resp.status}: ${detail}`;
    return { ok: false, code: classifyError(message), message };
  } catch (e) {
    const message = e && e.name === 'AbortError'
      ? `连接超时（timeout after ${timeoutMs}ms）`
      : String((e && e.message) || e);
    return { ok: false, code: classifyError(message), message };
  } finally {
    clearTimeout(timer);
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
export function buildChapterPrompt({ index, chapter, projectPath, previousChapters, courseType, hasSession, prevError, prevChapter }) {
  const courseTypeLine = courseType ? `- course_type: ${courseType}\n` : '';
  const skillNote = hasSession
    ? '1. chapter-generation skill 的 SKILL.md 和 content-format.md 已经在 init session 里读过，session context 里就有；除非内容不全再 Read 补充，否则直接用 Write 写文件。'
    : `1. chapter-generation skill 的 SKILL.md 和 content-format.md 已附在上方；如未附或内容不全，再 Read ${JSON.stringify(`${projectPath}/.pi/skills/chapter-generation/references/content-format.md`)} 补充。之后直接用 Write 写文件。`;
  const prevContext = index > 0
    ? `前面已生成的章节：\n${previousChapters.map((t, idx) => `${idx + 1}. ${t}`).join('\n')}`
    : '这是第一章。';
  // 二次生成携带上次失败原因（用户裁定 2026-09-09）：agent 必须知道上次
  // 为什么被判失败，才能针对性修正——否则重试只是原样重跑同一个错误。
  const prevErrorBlock = prevError
    ? `\n上次生成失败原因：${String(prevError).slice(0, 500)}\n请针对性修正后重新生成（若是文件名问题，严格使用下方硬性下发的三个文件名；若上次文件已存在但名字不符，用 Write 按正确文件名重写）。\n`
    : '';
  // 连贯性硬要求（Sprint 31 并行生成配套）：session 记忆不再是可靠的跨章
  // 上下文来源（并行窗口内非首章走 fresh-session；且 session 历史会随章节
  // 增多被上下文窗口截断），文件才是持久真相。让 agent 生成前必读上一章
  // 正文与 concepts.json——对串行模式同样是增强。
  const coherenceBlock = index > 0 && prevChapter
    ? (() => {
        const prevMd = generateFilename(index - 1, prevChapter.title);
        const prevBase = prevMd.replace(/\.md$/, '');
        return `5. 连贯性硬要求：生成前必读上一章文件 ${JSON.stringify(prevMd)} 和 ${JSON.stringify(`${prevBase}.concepts.json`)}（用 Read 工具）。沿用其术语、译名与记号体系，不要重复讲解其已覆盖的内容；「上一章/前面章节」类衔接语必须与其实际内容相符。\n`;
      })()
    : '';
  // 文件名由 bridge 单一事实源生成并硬性下发（2026-09-09 实爆：agent 自拟
  // 文件名与 generateFilename 差词序 → existsSync 验收永远失败 → 用户无限重试）。
  // 验收侧 generateChapters 用同一个 generateFilename 核对，两边必然一致。
  const baseName = generateFilename(index, chapter.title).replace(/\.md$/, '');
  return `请使用 chapter-generation skill 生成第 ${index + 1} 章。
- chapter_index: ${index}
- chapter_title: ${JSON.stringify(chapter.title)}
- duration_minutes: ${chapter.duration_minutes}
- concepts: ${JSON.stringify(chapter.concepts)}
${courseTypeLine}- project_path: ${JSON.stringify(projectPath)}
- previous_chapters: ${JSON.stringify(previousChapters)}

${prevContext}
${prevErrorBlock}
重要：
${skillNote}
2. 文件名硬性要求（验收逐一核对，差一个字都判失败）——在 project_path 下写入且只能写入这三个文件名：
   - ${baseName}.md
   - ${baseName}.quiz.json
   - ${baseName}.concepts.json
   文件名由 chapter_title 逐字生成，不要自行改写标题的措辞或字序。
3. 写完三个文件后，按 SKILL.md 的 MUST-VERIFY checklist 逐项检查，不通过就改。
4. 三个文件必须都存在且 quiz.json 顶层必须有 \`questions\` 字段（不是空对象、不是其他名字）。
${coherenceBlock}`;
}

export async function generateChapters(queryFnUnused, config, args) {
  const { project_path, outline, chapter_indices, course_type } = args;
  const allChapters = outline.chapters;
  const total = allChapters.length;
  // 上次失败原因（index → message），由前端从 chapter_failed 事件收集传入
  const chapterErrors = args.chapter_errors || {};

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

  // 并发上限（Sprint 31）：窗口并行生成最多同时跑 2 个 turn，防 API 限流。
  const PARALLEL_CONCURRENCY = 2;

  // 单章生成（原 for 循环体抽出）。useSession=false 时走 fresh-session：
  // 同一个 session 文件不能有两个并发写者，所以并行组里只有最低位章节
  // 续接项目 session，其余章节独立会话（连贯性由 prompt 的必读上一章
  // 指令保证，见 buildChapterPrompt 的 coherenceBlock）。
  const runOneChapter = async (i, { useSession }) => {
    const chapter = allChapters[i];

    emit('progress', {
      current: i + 1,
      total,
      chapter_title: chapter.title,
      status: 'generating'
    });

    // Fresh-session mode: the agent never saw the skill refs, so inline them
    // into the chapter prompt instead of claiming they're in session context.
    const chapterPrompt = (useSession ? '' : collectChapterSkillRefs(project_path))
      + buildChapterPrompt({
        index: i,
        chapter,
        projectPath: project_path,
        previousChapters: allChapters.slice(0, i).map((ch) => ch.title),
        courseType: course_type,
        hasSession: useSession,
        prevError: chapterErrors[String(i)] || null,
        prevChapter: i > 0 ? allChapters[i - 1] : null
      });

    try {
      // Sprint 26: humanities/hybrid 章节生成注入 wikimedia-commons 受限 bash
      // （skill 内置 wiki-fetch.mjs 白名单脚本，agent 可为作品实例配试听直链）
      const wikiFetchEnabled = course_type === 'humanities' || course_type === 'hybrid';
      const { output: raw } = await runPiTurn({
        prompt: chapterPrompt,
        config,
        cwd: project_path,
        tools: ['read', 'write', 'find', 'grep'],
        sessionId: useSession ? args.session_id : null,
        wikiFetch: wikiFetchEnabled,
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
    } catch (e) {
      emit('chapter_failed', {
        index: i,
        title: chapter.title,
        error: e.message
      });
    }
  };

  // 并行调度（Sprint 31）：最低位章节保留 session 续接（项目记忆锚点），
  // 其余章节 fresh-session 并发。整组进同一个 limit-2 池——窗口 2 章的
  // 总耗时从 t1 + t2 降到 ≈ max(t1, t2)。每章独立 try/catch，单章失败
  // 不影响其他章节（错误隔离）。
  const sorted = [...indicesToGenerate].sort((a, b) => a - b);
  const jobs = [];
  if (args.session_id && sorted.length > 0) {
    const head = sorted[0];
    jobs.push(() => runOneChapter(head, { useSession: true }));
    for (const i of sorted.slice(1)) {
      jobs.push(() => runOneChapter(i, { useSession: false }));
    }
  } else {
    for (const i of sorted) {
      jobs.push(() => runOneChapter(i, { useSession: false }));
    }
  }

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(PARALLEL_CONCURRENCY, jobs.length) },
    async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        await job();
      }
    }
  );
  await Promise.all(workers);

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
 * 构造 element-repair 的定向修复 prompt（纯函数，可单测）。
 * 只修复 repairs 里列出的违规处，其余内容原样保留。
 * 按 violation.kind 分派：code-block → 学科化重写；missing-svg-figure → 补一张
 * 内联 SVG 插图（先 Read inline-svg-spec.md）。空 repairs 返回空串。
 */
export function buildElementRepairPrompt(project_path, repairs) {
  if (!project_path || !Array.isArray(repairs) || !repairs.length) {
    return '';
  }
  const hasSvgRepairs = repairs.some(
    (r) => Array.isArray(r.violations) && r.violations.some((v) => v && v.kind === 'missing-svg-figure')
  );
  const svgSpecRead = hasSvgRepairs
    ? `涉及补图的文件，先 Read 规范再动手：${JSON.stringify(`${project_path}/.pi/skills/chapter-generation/references/inline-svg-spec.md`)}（读不到再试 ${JSON.stringify(`${project_path}/.claude/skills/chapter-generation/references/inline-svg-spec.md`)}）。
`
    : '';
  const svgMinimum = hasSvgRepairs
    ? `   - 补图最低要求（规范读不到时兜底）：<svg> 顶格、前后空行；viewBox="0 0 680 H" + width="100%"；第一个 rect 铺满浅色底卡 #F1EFE8；颜色全部 inline 写死；禁 class/style 块/var()/script/渐变；文字 ≥11px、字重 400/500；解释文字留在 markdown 正文
`
    : '';
  return `刚生成的章节未通过元素合规校验（不当代码块 / 缺失内联 SVG 插图），请定向修复。
- project_path: ${JSON.stringify(project_path)}
- repairs: ${JSON.stringify(repairs)}

${svgSpecRead}对每个 file：
1. 用 Read 读取 {project_path}/{file}
2. 只处理 violations 里列出的每一处违规，按 kind 分派：
   - kind "code-block"（给定行号 lang）：只删/改该编程代码块——
     * engineering 课：删掉该代码块，改用**真实公式 + 工艺/结构 mermaid 图 + 真实工业实例（设备型号/槽型/工艺参数/产地产能）**写同一内容
     * humanities 课：删掉该代码块，改用**具体作品实例（曲目+乐章+时间点 / 作品+年代 / 文献出处）**写同一内容
   - kind "missing-svg-figure"：该章一张内联 SVG 插图都没有——按 detail 给定的插图方向，在正文最合适的小节（核心直觉/实例段之后）插入 1 张学科相关的 SVG 插图：
${svgMinimum}     * 内容形态参考：engineering 用设备/槽型剖面（标注真实工艺参数）、机理示意、产线布局、能耗对比；humanities 用场景重构、空间布局、地理路线、构图分析、器物结构
     * 图前加一两句 markdown 正文引入，图后正文继续展开；不要用 SVG 重复 mermaid 能画的关系图
3. 用 Write 写回整个文件：除上述违规处修复外，**其余内容原样保留，一字不改**。

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

/**
 * 构造 paper-rescue 的批量补救 prompt（纯函数，可单测）。
 * 核心契约：**全部**失败条目的 url/title/error 全文一次性进 prompt
 * （批量视角，agent 先找错误共性再逐篇规划），输出契约指向 scratch JSON。
 * 空失败列表返回空串。
 */
export function buildPaperRescuePrompt(failures, outputFile) {
  if (!Array.isArray(failures) || !failures.length) {
    return '';
  }
  const list = failures.map((f, i) =>
    `${i + 1}. url: ${f.url}\n   标题: ${f.title || '(未知)'}\n   错误: ${f.error}`
  ).join('\n');
  return `以下 ${failures.length} 篇论文的自动导入全部失败。请按 paper-rescue skill 的流程批量补救（先 Read 该 skill 的 SKILL.md 了解工具与决策树）。

失败条目（错误全文即上下文，先找共性——比如全是 429 限流就该统一换 OpenAlex 源，再逐篇处理特例）：
${list}

要求：
1. 先 Read .pi/skills/paper-rescue/SKILL.md（读不到试 .claude/skills/paper-rescue/SKILL.md），严格按其中的决策流程与预算执行
2. 可用工具只有 read/write 和一个受限 bash（只能跑 skill 自带的两脚本：openalex-lookup / anysearch-lookup）
3. 把结果用 Write 写到这个文件（路径原样使用）：
   ${outputFile}
   结构：{"attempts": [{"url": "<原始 url>", "candidates": ["https://...pdf"], "notes": "一句话"}]}
   每个失败条目都必须有一条 attempt；无救的篇目 candidates 为空、notes 写明理由（会透出给用户）；candidates 每篇最多 3 个且必须是 http/https URL
4. 写完回复一行总结（n 篇有候选 / m 篇无救）`;
}

/**
 * paper-rescue stage：批量补救导入失败的论文。
 * 一次 agent 调用处理全部失败（用户原则：批量给 agent 判断规划，不是一篇一调）。
 * agent 用受限 bash 跑 skill 白名单脚本找候选源，把 attempts 写到 output_file，
 * Rust 侧读回后逐篇用候选 URL 重试导入。
 */
export async function rescuePapers(queryFnUnused, config, args) {
  const { failures, work_dir, output_file, anysearch_api_key } = args;
  if (!Array.isArray(failures) || !failures.length) {
    return;
  }

  const prompt = buildPaperRescuePrompt(failures, output_file);

  const { output: raw } = await runPiTurn({
    prompt,
    config,
    cwd: work_dir,
    tools: ['read', 'write'],
    paperRescue: { anysearchKey: anysearch_api_key || '' }
  });

  if (!raw || raw.trim().length < 2) {
    throw new Error('paper-rescue: agent response empty');
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

  // 首轮信号 = 无 session：案例研习面板（AI 伴学统一面板）首轮可能已带用户要求
  // （「用音阶举例」），不能再拿 user_answer 有无来判定首轮。
  // CaseStudyModal 旧流程不受影响：首轮 session_id 必为空，续聊轮必带。
  const isFirstTurn = !args.session_id;
  log('info', 'Starting case study', { project_path, selected_text, first_turn: isFirstTurn });

  const prompt = isFirstTurn
    ? `请使用 typora-course-case-study skill 生成教学案例。\n` +
      `选中概念: ${JSON.stringify(selected_text)}\n` +
      (context ? `章节上下文: ${JSON.stringify(context)}\n` : '') +
      (user_answer && user_answer.trim() ? `学生要求: ${JSON.stringify(user_answer)}\n` : '')
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

/**
 * Own Voice（我有话说）——学生对概念说出自己的理解，AI 给针对性反馈。
 *
 * 与 caseStudyChat 同构（runPiTurn + sessionId 续聊 + 流式 delta），差异：
 * - 首轮就是学生发言（不像案例首轮由 AI 主动开讲），first_turn 由 args 显式传入
 * - 选中概念可选（支持不划词自由发言），事件名 own_voice_delta
 */
export async function ownVoiceChat(queryFnUnused, config, args) {
  const { project_path, selected_text, context, user_answer, first_turn } = args;

  if (!project_path) {
    throw new Error('project_path is required for own-voice');
  }
  if (!user_answer || !user_answer.trim()) {
    throw new Error('user_answer is required for own-voice');
  }

  log('info', 'Starting own-voice', { project_path, selected_text: selected_text || null, first_turn: !!first_turn });

  const prompt = first_turn
    ? `请使用 typora-course-own-voice skill 听听学生的理解并给出反馈。\n` +
      `学生发言: ${JSON.stringify(user_answer)}\n` +
      (selected_text && selected_text.trim() ? `选中概念: ${JSON.stringify(selected_text)}\n` : '') +
      (context ? `章节上下文: ${JSON.stringify(context)}\n` : '')
    : user_answer;

  const { output, sessionFile } = await runPiTurn({
    prompt,
    config,
    cwd: project_path,
    tools: ['read', 'write', 'find', 'grep'],
    sessionId: args.session_id,
    onDelta: (delta) => emit('own_voice_delta', { delta })
  });

  if (!output || output.trim().length === 0) {
    throw new Error('Agent returned empty own-voice response');
  }

  const session_id = sessionFile || args.session_id || null;
  log('info', 'Own-voice turn complete', { content_length: output.trim().length, has_session: !!session_id });
  return { content: output.trim(), done: false, session_id };
}

/**
 * Visualize stage（AI 伴学「🖼️ 画个图」）：划词选概念 → AI 配图讲解。
 * 与 caseStudyChat 同构（runPiTurn + sessionId 续聊 + 流式 delta），差异：
 * - 挂载 wikimedia 受限 bash（wikiFetch: true）——skill 先检索真图，
 *   未命中再按 inline-svg-spec 手绘 SVG（```svg 围栏，气泡渲染通道）
 * - 事件名 visualize_delta
 */
export async function visualizeChat(queryFnUnused, config, args) {
  const { project_path, selected_text, context, user_answer } = args;

  if (!project_path) {
    throw new Error('project_path is required for visualize');
  }
  if (!selected_text || !selected_text.trim()) {
    throw new Error('selected_text is required for visualize');
  }

  // 首轮信号 = 无 session（同 case-study：面板首轮可能已带学生要求）
  const isFirstTurn = !args.session_id;
  log('info', 'Starting visualize', { project_path, selected_text, first_turn: isFirstTurn });

  const prompt = isFirstTurn
    ? `请使用 typora-course-visualize skill 为学生选中的概念配图讲解。\n` +
      `选中概念: ${JSON.stringify(selected_text)}\n` +
      (context ? `章节上下文: ${JSON.stringify(context)}\n` : '') +
      (user_answer && user_answer.trim() ? `学生要求: ${JSON.stringify(user_answer)}\n` : '')
    : user_answer;

  const { output, sessionFile } = await runPiTurn({
    prompt,
    config,
    cwd: project_path,
    tools: ['read', 'write', 'find', 'grep'],
    sessionId: args.session_id,
    // 维基真图检索：受限 bash 只放行 wikimedia-commons 的 wiki-fetch.mjs
    wikiFetch: true,
    onDelta: (delta) => emit('visualize_delta', { delta })
  });

  if (!output || output.trim().length === 0) {
    throw new Error('Agent returned empty visualize response');
  }

  const session_id = sessionFile || args.session_id || null;
  log('info', 'Visualize turn complete', { content_length: output.trim().length, has_session: !!session_id });
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
// API key must never reach the log file: argv[1] is the config JSON.
function _redactArgv(args) {
  return args.map((a, i) => {
    if (i !== 1) return a;
    try {
      const o = JSON.parse(a);
      if (o?.config?.api_key) o.config.api_key = '***';
      return JSON.stringify(o);
    } catch { return a; }
  });
}

async function main() {
  const args = process.argv.slice(2);
  log('info', 'Agent bridge (pi kernel) started', { argv: _redactArgv(args) });

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
        // 检测诚实化（断流容灾 2026-10-14）：SDK 文件存在 ≠ 服务可用。
        // 有激活配置就再发一个真实最小请求（max_tokens=1），不通则带分级
        // 错误码返回，前端状态灯据此显示「服务不可达 + 原因」而非假绿。
        let ping = null;
        if (result.available && config && config.api_key) {
          ping = await pingProvider(config);
          log('info', 'Provider ping', { ok: ping.ok, code: ping.code || null, message: ping.message || null });
        }
        console.log(JSON.stringify({
          available: result.available,
          error: result.error || null,
          ping
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
      case 'own-voice': {
        log('info', 'Starting own-voice stage', { project_path: taskArgs.project_path, selected_text: taskArgs.selected_text || null, first_turn: !!taskArgs.first_turn, session_id: taskArgs.session_id || null });
        const ownVoiceResult = await ownVoiceChat(null, config, taskArgs);
        console.log(JSON.stringify(ownVoiceResult));
        log('info', 'Own-voice stage completed', { content_length: ownVoiceResult.content.length });
        process.exit(0);
      }
      case 'visualize': {
        log('info', 'Starting visualize stage', { project_path: taskArgs.project_path, selected_text: taskArgs.selected_text, session_id: taskArgs.session_id || null });
        const visualizeResult = await visualizeChat(null, config, taskArgs);
        console.log(JSON.stringify(visualizeResult));
        log('info', 'Visualize stage completed', { content_length: visualizeResult.content.length });
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
      case 'paper-rescue': {
        log('info', 'Starting paper-rescue stage', { failureCount: taskArgs.failures?.length, work_dir: taskArgs.work_dir, output_file: taskArgs.output_file });
        await rescuePapers(null, config, taskArgs);
        log('info', 'Paper-rescue stage completed');
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
