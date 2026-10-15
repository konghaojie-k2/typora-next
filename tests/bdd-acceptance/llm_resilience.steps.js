#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for LLM 状态感知与故障分级
 * 设计文档：docs/plans/2026-10-14-llm-provider-failover-design.md
 *
 * 真实模块执行：agent-bridge.mjs（ESM 动态 import）+ mock-pi-sdk（自定义行为
 * 注入 auto_retry_start 事件）；Rust / 前端为静态接线检查（与既有步骤同风格）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();
const REPO = path.resolve(__dirname, '../..');
const BRIDGE_PATH = path.join(REPO, 'agent-bridge.mjs');
const MOCK_SDK_PATH = path.join(REPO, 'tests', 'mock-pi-sdk', 'index.mjs');
const AI_AGENT_RS = path.join(REPO, 'src-tauri', 'src', 'ai_agent.rs');
const COMPANION_JS = path.join(REPO, 'dist', 'scripts', 'learning', 'ai-companion-modal.js');

/** 捕获 import 期间与运行期间 bridge 打到 stdout 的 JSON 行 */
async function captureStdout(fn) {
  const lines = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString();
    for (const l of s.split('\n').filter(Boolean)) {
      try { lines.push(JSON.parse(l.trim())); } catch (e) { /* 非 JSON 行忽略 */ }
    }
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return lines;
}

// ============================================
// Scenario: SDK 自动重试时 bridge 发出状态事件
// ============================================

steps.given('mock SDK 在本轮会先触发 1 次自动重试', async function() {
  process.env.TYPORA_PI_SDK_ENTRY = MOCK_SDK_PATH;
  this.mock = await import(pathToFileURL(MOCK_SDK_PATH).href);
  this.mock.__setBehavior(async () => ({
    events: [{
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      errorMessage: 'stream idle timeout'
    }],
    text: '重试后的回复'
  }));
});

steps.when('bridge 执行一轮对话', async function() {
  const bridge = await import(pathToFileURL(BRIDGE_PATH).href);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'resilience-'));
  this.stdoutLines = await captureStdout(async () => {
    const r = await bridge.runPiTurn({
      prompt: '你好',
      config: { ai_provider: 'openai', ai_base_url: 'https://x.cn', api_key: 'k', model: 'm' },
      cwd
    });
    this.turnOutput = r.output;
  });
  delete process.env.TYPORA_PI_SDK_ENTRY;
  if (this.mock) this.mock.__resetBehavior();
});

steps.then('stdout 应出现 status 事件且文案含 自动重试', function() {
  const statusEvents = (this.stdoutLines || []).filter(l => l.type === 'status');
  if (statusEvents.length === 0) {
    throw new Error('bridge 未发出任何 status 事件（auto_retry_start 应被翻译透出）');
  }
  const retry = statusEvents.find(e => e.data && e.data.message && e.data.message.includes('自动重试'));
  if (!retry) {
    throw new Error('status 事件文案不含「自动重试」: ' + JSON.stringify(statusEvents.map(e => e.data)));
  }
  if (!retry.data.message.includes('1/3') && !retry.data.message.includes('第 1')) {
    throw new Error('status 文案未带重试次数信息: ' + retry.data.message);
  }
});

// ============================================
// Scenario: classifyError 错误分级
// ============================================

steps.when('classifyError 收到看门狗断流错误', async function() {
  const bridge = await import(pathToFileURL(BRIDGE_PATH).href);
  this.errorCode = bridge.classifyError(new Error('模型响应中断（90 秒无数据，疑似网络或服务端断流），请重试'));
});

steps.when('classifyError 收到 401 错误', async function() {
  const bridge = await import(pathToFileURL(BRIDGE_PATH).href);
  this.errorCode = bridge.classifyError(new Error('HTTP 401 Unauthorized: invalid api key'));
});

steps.when('classifyError 收到 DNS 解析失败错误', async function() {
  const bridge = await import(pathToFileURL(BRIDGE_PATH).href);
  this.errorCode = bridge.classifyError(new Error('fetch failed: getaddrinfo ENOTFOUND api.deepseek.com'));
});

steps.when('classifyError 收到普通错误', async function() {
  const bridge = await import(pathToFileURL(BRIDGE_PATH).href);
  this.errorCode = bridge.classifyError(new Error('model not resolvable: x/y'));
});

steps.then('错误码应为 STALL', function() {
  if (this.errorCode !== 'STALL') throw new Error('期望 STALL，实际: ' + this.errorCode);
});

steps.then('错误码应为 AUTH_FAILED', function() {
  if (this.errorCode !== 'AUTH_FAILED') throw new Error('期望 AUTH_FAILED，实际: ' + this.errorCode);
});

steps.then('错误码应为 NETWORK', function() {
  if (this.errorCode !== 'NETWORK') throw new Error('期望 NETWORK，实际: ' + this.errorCode);
});

steps.then('错误码应为 UNKNOWN', function() {
  if (this.errorCode !== 'UNKNOWN') throw new Error('期望 UNKNOWN，实际: ' + this.errorCode);
});

// ============================================
// Scenario: Rust 透传 status 到伴学事件通道（静态接线检查）
// ============================================

steps.then('Rust 的三个伴学命令都应转发 status 事件', function() {
  const rs = fs.readFileSync(AI_AGENT_RS, 'utf-8');
  // 三个流式 chat 命令共用「逐行读 stdout → 按类型转发」循环；
  // 每个事件通道都要放行 type == "status" 的行
  for (const [cmd, eventName] of [
    ['case_study_chat', 'case-study-event'],
    ['own_voice_chat', 'own-voice-event'],
    ['visualize_chat', 'visualize-event'],
  ]) {
    const fnStart = rs.indexOf(`pub async fn ${cmd}`);
    if (fnStart === -1) throw new Error(`ai_agent.rs 缺少 ${cmd}`);
    const body = rs.slice(fnStart, fnStart + 6000);
    if (!body.includes(`emit("${eventName}"`)) {
      throw new Error(`${cmd} 未 emit ${eventName}`);
    }
    if (!body.includes('"status"')) {
      throw new Error(`${cmd} 的转发循环未放行 status 类型行`);
    }
  }
});

// ============================================
// Scenario: 伴学前端 loading 气泡响应 status（静态接线检查）
// ============================================

steps.then('伴学面板应处理 status 载荷并更新 loading 气泡', function() {
  const js = fs.readFileSync(COMPANION_JS, 'utf-8');
  const streamingTurn = js.slice(js.indexOf('async _streamingTurn'), js.indexOf('async _streamingTurn') + 4000);
  if (!streamingTurn.includes("'status'") && !streamingTurn.includes('"status"')) {
    throw new Error('_streamingTurn 未处理 payload.type === status');
  }
  // loading 气泡文本需要可更新（而不是写死「正在思考」）
  if (!/loadingEl[\s\S]{0,400}(textContent|setStatus|updateStatus)/.test(streamingTurn)) {
    throw new Error('_streamingTurn 没有用 status 载荷更新 loading 气泡');
  }
});

// ============================================
// Scenario: 故障气泡分级动作（静态接线检查 + 真实模块行为）
// ============================================

steps.then('伴学面板应实现错误分级、分级文案与重试/打开设置按钮', function() {
  const js = fs.readFileSync(COMPANION_JS, 'utf-8');
  for (const marker of ['CompanionErrors', 'appendErrorBubble', 'onRetry', 'openSettings']) {
    if (!js.includes(marker)) {
      throw new Error('ai-companion-modal.js 缺少接线: ' + marker);
    }
  }
  const shell = fs.readFileSync(path.join(REPO, 'dist', 'scripts', 'learning', 'notebook-modal.js'), 'utf-8');
  if (!shell.includes('appendErrorBubble')) {
    throw new Error('notebook-modal.js 缺少 appendErrorBubble（外壳层故障气泡）');
  }
  // 真实模块行为：分级规则与 bridge classifyError 对齐
  const { CompanionErrors } = require(COMPANION_JS);
  if (CompanionErrors.classify('模型响应中断（90 秒无数据，疑似网络或服务端断流），请重试') !== 'STALL') {
    throw new Error('CompanionErrors.classify 未识别断流错误');
  }
  if (CompanionErrors.retryable('AUTH_FAILED')) {
    throw new Error('AUTH_FAILED 不应提供重试');
  }
});

// ============================================
// Scenario: check 阶段真实连通性 ping（静态接线检查）
// ============================================

steps.then('bridge 的 check 阶段应在 SDK 可用时调用 pingProvider', function() {
  const bridgeSrc = fs.readFileSync(BRIDGE_PATH, 'utf-8');
  const checkCase = bridgeSrc.slice(bridgeSrc.indexOf("case 'check'"), bridgeSrc.indexOf("case 'check'") + 1500);
  if (!checkCase.includes('pingProvider')) {
    throw new Error('check stage 未调用 pingProvider（检测仍是假绿：只看 SDK 文件存在）');
  }
});

steps.then('Rust 的 check_agent_sdk 应把真实配置传给 bridge', function() {
  const rs = fs.readFileSync(AI_AGENT_RS, 'utf-8');
  const fnStart = rs.indexOf('pub async fn check_agent_sdk');
  if (fnStart === -1) throw new Error('ai_agent.rs 缺少 check_agent_sdk');
  const body = rs.slice(fnStart, fnStart + 3000);
  if (!body.includes('get_config')) {
    throw new Error('check_agent_sdk 未读取真实配置（payload 仍是空 config）');
  }
  if (!body.includes('api_key')) {
    throw new Error('check_agent_sdk 的 payload 未带 api_key');
  }
});

// ============================================
// Scenario: ping 分级错误码（真实模块 + 注入 fetch）
// ============================================

async function runPing(ctx, fetchImpl) {
  const bridge = await import(pathToFileURL(BRIDGE_PATH).href);
  ctx.pingResult = await bridge.pingProvider(
    { ai_provider: 'openai', ai_base_url: 'https://api.example.com', api_key: 'k', model: 'm' },
    fetchImpl
  );
}

steps.when('pingProvider 收到 401 响应', async function() {
  await runPing(this, async () => ({ ok: false, status: 401, text: async () => 'invalid api key' }));
});

steps.when('pingProvider 收到 DNS 失败', async function() {
  await runPing(this, async () => { throw new Error('fetch failed: getaddrinfo ENOTFOUND api.example.com'); });
});

steps.when('pingProvider 收到正常响应', async function() {
  await runPing(this, async () => ({ ok: true, status: 200, text: async () => '{"choices":[]}' }));
});

steps.then('ping 结果错误码应为 AUTH_FAILED', function() {
  if (!this.pingResult || this.pingResult.ok !== false || this.pingResult.code !== 'AUTH_FAILED') {
    throw new Error('期望 {ok:false, code:AUTH_FAILED}，实际: ' + JSON.stringify(this.pingResult));
  }
});

steps.then('ping 结果错误码应为 NETWORK', function() {
  if (!this.pingResult || this.pingResult.ok !== false || this.pingResult.code !== 'NETWORK') {
    throw new Error('期望 {ok:false, code:NETWORK}，实际: ' + JSON.stringify(this.pingResult));
  }
});

steps.then('ping 结果应为 ok', function() {
  if (!this.pingResult || this.pingResult.ok !== true) {
    throw new Error('期望 {ok:true}，实际: ' + JSON.stringify(this.pingResult));
  }
});

// ============================================
// Scenario: 配置结构迁移（Rust 静态接线检查；纯逻辑由 cargo test --test ai_profiles_test 覆盖）
// ============================================

steps.then('AppConfig 应有 ai_profiles 与 active_profile_id 字段', function() {
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf-8');
  for (const marker of ['pub ai_profiles', 'pub active_profile_id', 'AiProfile']) {
    if (!lib.includes(marker)) throw new Error('lib.rs 缺少: ' + marker);
  }
});

steps.then('get_config 应做旧字段迁移与激活派生', function() {
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf-8');
  const fnStart = lib.indexOf('fn get_config');
  if (fnStart === -1) throw new Error('缺少 get_config');
  const body = lib.slice(fnStart, fnStart + 1500);
  // normalize_profiles 是迁移+派生的实际入口（内部调 migrate_legacy/derive_legacy）
  if (!body.includes('normalize_profiles') && !body.includes('migrate_legacy') && !body.includes('ai_profiles')) {
    throw new Error('get_config 未做迁移/派生');
  }
});

steps.then('set_config 应在落盘前从激活 profile 派生旧字段', function() {
  const lib = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf-8');
  const fnStart = lib.indexOf('fn set_config');
  if (fnStart === -1) throw new Error('缺少 set_config');
  const body = lib.slice(fnStart, fnStart + 1200);
  if (!body.includes('normalize_profiles') && !body.includes('derive_legacy') && !body.includes('ai_profiles')) {
    throw new Error('set_config 未在落盘前派生旧字段');
  }
});

// ============================================
// Scenario: profile 卡片操作（真实模块：settings-panel ProfileOps）
// ============================================

function makeCard(name, model) {
  return { id: '', name, provider: 'openai', base_url: 'https://api.example.com', api_key: 'k-' + name, model };
}

steps.when('ProfileOps 向空列表新增一张卡片', function() {
  const { ProfileOps } = require(path.join(REPO, 'dist', 'scripts', 'settings-panel.js'));
  this.ops = ProfileOps;
  this.state = { profiles: [], active_id: null };
  const r = this.ops.upsert(this.state, makeCard('DeepSeek', 'deepseek-flash'));
  this.state = r;
});

steps.then('列表应有 1 张且自动激活', function() {
  if (this.state.profiles.length !== 1) throw new Error('期望 1 张卡片，实际 ' + this.state.profiles.length);
  if (!this.state.active_id) throw new Error('首张卡片应自动激活');
  if (!this.state.profiles[0].id) throw new Error('卡片应自动生成 id');
});

steps.when('ProfileOps 再新增一张卡片', function() {
  this.state = this.ops.upsert(this.state, makeCard('备用', 'gpt-x'));
});

steps.then('列表应有 2 张且激活仍为第一张', function() {
  if (this.state.profiles.length !== 2) throw new Error('期望 2 张，实际 ' + this.state.profiles.length);
  if (this.state.active_id !== this.state.profiles[0].id) throw new Error('新增不应抢激活');
  if (this.state.profiles[0].id === this.state.profiles[1].id) throw new Error('id 冲突');
});

steps.when('ProfileOps 激活第二张卡片', function() {
  this.state = this.ops.activate(this.state, this.state.profiles[1].id);
});

steps.then('激活项应为第二张且派生旧字段等于第二张的内容', function() {
  const second = this.state.profiles[1];
  if (this.state.active_id !== second.id) throw new Error('激活项不是第二张');
  const legacy = this.ops.deriveLegacy(this.state);
  if (legacy.api_key !== second.api_key || legacy.model !== second.model || legacy.ai_base_url !== second.base_url) {
    throw new Error('派生旧字段与激活卡片不一致: ' + JSON.stringify(legacy));
  }
});

steps.when('ProfileOps 删除第二张卡片', function() {
  this.state = this.ops.remove(this.state, this.state.profiles[1].id);
});

steps.then('激活项应回退到第一张', function() {
  if (this.state.profiles.length !== 1) throw new Error('删除后应剩 1 张');
  if (this.state.active_id !== this.state.profiles[0].id) throw new Error('删除激活项后应回退到第一张');
});

// ============================================
// Scenario: 设置面板 profile 列表接线（静态检查）
// ============================================

steps.then('设置面板应渲染 profile 卡片列表并支持激活/编辑/复制/删除/检测', function() {
  const js = fs.readFileSync(path.join(REPO, 'dist', 'scripts', 'settings-panel.js'), 'utf-8');
  for (const marker of ['ai_profiles', 'active_profile_id', 'ProfileOps', 'ai-profile-card', '复制', '检测', '激活']) {
    if (!js.includes(marker)) {
      throw new Error('settings-panel.js 缺少接线: ' + marker);
    }
  }
});

// ============================================
// Scenario: 激活卡片立即落盘（真实模块：SettingsPanel._persistProfiles + mock invoke）
// 2026-10-15 事故：激活只改内存态，磁盘仍是旧卡，状态灯检磁盘配置 → 假绿
// ============================================

const SETTINGS_PANEL_PATH = path.join(REPO, 'dist', 'scripts', 'settings-panel.js');

function setupPanelWithTwoCards(ctx) {
  const { SettingsPanel, ProfileOps } = require(SETTINGS_PANEL_PATH);
  let s = { profiles: [], active_id: null };
  s = ProfileOps.upsert(s, { id: 'profile-1', name: 'A', provider: 'openai', base_url: 'https://a.example.com', api_key: 'k-A', model: 'm1' });
  s = ProfileOps.upsert(s, { id: 'profile-2', name: 'B', provider: 'openai', base_url: 'https://b.example.com', api_key: 'k-B', model: 'm2' });
  s = ProfileOps.activate(s, 'profile-2');
  SettingsPanel._root = null;            // 无 DOM：_flushFormToSelected/hint 均有守卫
  SettingsPanel._selectedProfileId = null;
  SettingsPanel._profileState = s;
  return SettingsPanel;
}

steps.when('SettingsPanel 在无 DOM 环境下激活第二张卡片并持久化', async function() {
  const SettingsPanel = setupPanelWithTwoCards(this);
  this.setConfigPayloads = [];
  SettingsPanel.__setInvokeForTests(async (cmd, args) => {
    if (cmd === 'get_config') return { theme: 'light', mineru_model_version: 'vlm' };
    if (cmd === 'set_config') { this.setConfigPayloads.push(args.config); return null; }
    throw new Error('unexpected invoke: ' + cmd);
  });
  try {
    await SettingsPanel._persistProfiles();
  } finally {
    SettingsPanel.__setInvokeForTests(null);
  }
});

steps.then('set_config 载荷的 active_profile_id 应为第二张', function() {
  if (this.setConfigPayloads.length !== 1) {
    throw new Error('期望恰好 1 次 set_config，实际 ' + this.setConfigPayloads.length + '（激活未立即落盘）');
  }
  const p = this.setConfigPayloads[0];
  if (p.active_profile_id !== 'profile-2') {
    throw new Error('active_profile_id 应为 profile-2，实际: ' + p.active_profile_id);
  }
});

steps.then('set_config 载荷的派生旧字段应等于第二张的内容', function() {
  const p = this.setConfigPayloads[0];
  if (p.api_key !== 'k-B' || p.model !== 'm2' || p.ai_base_url !== 'https://b.example.com' || p.ai_provider !== 'openai') {
    throw new Error('派生旧字段未跟随激活卡: ' + JSON.stringify(p));
  }
  if (!Array.isArray(p.ai_profiles) || p.ai_profiles.length !== 2) {
    throw new Error('ai_profiles 应随载荷一起写入');
  }
});

steps.then('set_config 载荷应保留磁盘上的既有字段', function() {
  const p = this.setConfigPayloads[0];
  if (p.theme !== 'light' || p.mineru_model_version !== 'vlm') {
    throw new Error('merge-then-save 丢失既有字段: ' + JSON.stringify(p));
  }
});

steps.then('激活按钮处理器应调用 _persistProfiles', function() {
  const js = fs.readFileSync(SETTINGS_PANEL_PATH, 'utf-8');
  const idx = js.indexOf("el('button', 'ai-profile-btn', '激活')");
  if (idx === -1) throw new Error('找不到激活按钮');
  const handler = js.slice(idx, idx + 600);
  if (!handler.includes('_persistProfiles')) {
    throw new Error('激活按钮只改内存态，未调用 _persistProfiles（不落盘 → 磁盘配置与 UI 不一致）');
  }
});

steps.when('set_config 抛错时执行持久化', async function() {
  const SettingsPanel = setupPanelWithTwoCards(this);
  this.persistThrew = false;
  this.consoleErrors = [];
  const origError = console.error;
  console.error = (...a) => { this.consoleErrors.push(a.map(String).join(' ')); };
  SettingsPanel.__setInvokeForTests(async (cmd) => {
    if (cmd === 'get_config') return {};
    if (cmd === 'set_config') throw new Error('disk full');
    throw new Error('unexpected invoke: ' + cmd);
  });
  try {
    await SettingsPanel._persistProfiles();
  } catch (e) {
    this.persistThrew = true;
  } finally {
    SettingsPanel.__setInvokeForTests(null);
    console.error = origError;
  }
});

steps.then('不应静默吞错', function() {
  if (this.persistThrew) {
    throw new Error('_persistProfiles 把异常抛给了点击处理器（unhandled rejection）');
  }
  const surfaced = this.consoleErrors.some((l) => l.includes('disk full'));
  if (!surfaced) {
    throw new Error('落盘失败未透出具体错误（console.error 应带原始 message）');
  }
});

// ============================================
// Scenario: 保存设置后重检 agent 状态灯（静态接线检查）
// ============================================

steps.then('onSettingsSaved 应触发 agent 状态重检', function() {
  const js = fs.readFileSync(path.join(REPO, 'dist', 'scripts', 'main.js'), 'utf-8');
  const idx = js.indexOf('onSettingsSaved(config)');
  if (idx === -1) throw new Error('main.js 缺少 onSettingsSaved');
  const body = js.slice(idx, idx + 800);
  if (!body.includes('checkAgentSdk')) {
    throw new Error('onSettingsSaved 未重检 agent 状态（保存新配置后状态灯仍是旧检测结果）');
  }
});

// ============================================
// Scenario: ping 失败时状态灯变红（静态接线检查，信号链最后一跳）
// ============================================

steps.then('checkAgentSdk 应将 ping 失败映射为 unreachable 红灯', function() {
  const js = fs.readFileSync(path.join(REPO, 'dist', 'scripts', 'main.js'), 'utf-8');
  const idx = js.indexOf('async function checkAgentSdk');
  if (idx === -1) throw new Error('main.js 缺少 checkAgentSdk');
  const body = js.slice(idx, idx + 2000);
  for (const marker of ['ping', "'unreachable'", 'updateAgentStatusChip']) {
    if (!body.includes(marker)) {
      throw new Error('checkAgentSdk 缺少 ping→红灯 映射: ' + marker);
    }
  }
});

// ============================================
// Scenario: Rust 直调路径统一走 base_url 归一化（静态接线检查）
// ============================================

steps.then('Rust 源码不应再出现裸拼 /v1 版本段', function() {
  for (const rel of ['src-tauri/src/lib.rs', 'src-tauri/src/ai_agent.rs']) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf-8');
    if (/format!\("\{\}\/v1\//.test(src)) {
      throw new Error(rel + ' 仍存在裸拼 /v1（应走 llm_body::versioned_url 归一化）');
    }
  }
});

steps.then('versioned_url 的语义应与 bridge 归一化一致（Rust 测试守护）', function() {
  const src = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'llm_body.rs'), 'utf-8');
  if (!src.includes('pub fn versioned_url')) {
    throw new Error('llm_body.rs 缺少 versioned_url');
  }
  const test = fs.readFileSync(path.join(REPO, 'src-tauri', 'tests', 'llm_body_test.rs'), 'utf-8');
  // 关键语义用例必须在 Rust 测试里存在（cargo test --test llm_body_test 执行）
  if (!test.includes('base_with_v1_suffix_not_duplicated')) {
    throw new Error('llm_body_test.rs 缺少 /v1 不重复用例');
  }
});

// ============================================
// Scenario: 卡片检测应先刷入表单值（静态接线检查）
// ============================================

steps.then('_checkProfileCard 应在检测前刷入表单值', function() {
  const js = fs.readFileSync(SETTINGS_PANEL_PATH, 'utf-8');
  const idx = js.indexOf('async _checkProfileCard');
  if (idx === -1) throw new Error('缺少 _checkProfileCard');
  const body = js.slice(idx, idx + 1200);
  const invokeIdx = body.indexOf("invoke('test_llm_config'");
  const flushIdx = body.indexOf('_flushFormToSelected');
  if (flushIdx === -1 || (invokeIdx !== -1 && flushIdx > invokeIdx)) {
    throw new Error('_checkProfileCard 未在检测前刷入表单值（编辑后点检测 → 测的是旧配置）');
  }
});

// ============================================
// Scenario: test_llm_config 必须有超时（静态接线检查）
// ============================================

steps.then('test_llm_config 的 ureq 调用应设置超时', function() {
  const src = fs.readFileSync(path.join(REPO, 'src-tauri', 'src', 'lib.rs'), 'utf-8');
  const idx = src.indexOf('fn test_llm_config');
  if (idx === -1) throw new Error('缺少 test_llm_config');
  const body = src.slice(idx, idx + 3000);
  if (!body.includes('.timeout(')) {
    throw new Error('test_llm_config 的 ureq 调用无超时（服务端挂起 → 永远「检测中…」）');
  }
});

// ============================================
// Scenario: 移除底部旧的测试连接按钮（静态接线检查）
// ============================================

steps.then('设置面板不应再有 测试连接 按钮', function() {
  const js = fs.readFileSync(SETTINGS_PANEL_PATH, 'utf-8');
  if (js.includes('测试连接') || js.includes('testConnection')) {
    throw new Error('底部旧「测试连接」仍在（每卡已有「检测」，旧按钮测的是激活卡，语义混乱）');
  }
});

// ============================================
// Scenario: stderr 管道死锁双层修复（2026-10-15 DeepSeek 画图卡死事故）
// ============================================

steps.then('log 函数的 debug 级应只落文件不写 stderr', function() {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf-8');
  const idx = src.indexOf('function log(level, message, data = null)');
  if (idx === -1) throw new Error('agent-bridge.mjs 缺少 log 函数');
  const body = src.slice(idx, idx + 1500);
  // debug 洪峰必须被挡在 stderr 之外（Windows 管道同步写 → 写满即冻结事件循环）
  if (!/level\s*!==\s*'debug'/.test(body)) {
    throw new Error("log() 未对 debug 级跳过 console.error（一轮数千条 thinking_delta ≈ 64KB 写满管道 → 事件循环冻结 → 看门狗饿死）");
  }
});

steps.then('session 事件订阅应跳过思考与工具调用的逐 delta 日志', function() {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf-8');
  const idx = src.indexOf('session.subscribe((ev) => {');
  if (idx === -1) throw new Error('缺少 session.subscribe');
  const body = src.slice(idx, idx + 1200);
  for (const noise of ['thinking_delta', 'toolcall_delta']) {
    if (!body.includes(noise)) {
      throw new Error(`subscribe 日志过滤未跳过 ${noise}（思考型模型 delta 洪峰是死锁的直接推手）`);
    }
  }
});

steps.then('三个流式聊天命令都应用线程排空 stderr', function() {
  const rs = fs.readFileSync(AI_AGENT_RS, 'utf-8');
  for (const fn of ['case_study_chat', 'own_voice_chat', 'visualize_chat']) {
    const start = rs.indexOf(`pub async fn ${fn}`);
    if (start === -1) throw new Error(`ai_agent.rs 缺少 ${fn}`);
    const next = rs.indexOf('pub async fn', start + 10);
    const body = rs.slice(start, next === -1 ? undefined : next);
    if (!body.includes('thread::spawn') || !body.includes('stderr')) {
      throw new Error(`${fn} 未用线程并发排空 stderr（只排 stdout → stderr 写满 → bridge 事件循环冻结 → 双向死锁）`);
    }
  }
});

module.exports = steps;
