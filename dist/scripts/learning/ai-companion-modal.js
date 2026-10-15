/**
 * AI Companion Modal - AI 伴学统一面板
 *
 * 课程模式四个 AI 场景共用一个对话现场（入口统一：划词气泡 ✨ 伴学四选 /
 * 侧栏「💬 我有话说」不划词直达）：
 *   💡 给个解释  → explain_selection（previousQa 多轮，无 session）→ 逐轮落盘 .learning/explanations/
 *   📋 举个例子  → case_study_chat（独立 session，流式）→ 结束落盘 .learning/case-studies/
 *   💬 我有话说  → own_voice_chat（独立 session，流式）→ 结束落盘 .learning/own-voices/
 *   🖼️ 画个图    → visualize_chat（独立 session，流式，维基真图优先）→ 结束落盘 .learning/visualizations/
 *
 * 一条记录 = 一个起点（见 recordKey）：划词起点按概念跨天追加，全局起点每次一条。
 * 续聊（伴学记录 → 面板）由 opts.record 一次性恢复该起点的全部模式部分，
 * 后续内容分别写回原文件（💡 按原 cue 覆写、📋/💬 覆盖原会话文件）。
 *
 * 前端只负责表现：每条用户消息带模式标签，这一轮选什么模式，AI 就用哪种方式
 * 回答（回答风格由对应 skill 控制）。模式可中途切换；切换后首个会话轮会把
 * 已聊内容压缩成 priorDiscussion 注入上下文，AI 不丢前文。
 *
 * UI 复用 NotebookModal 外壳（与苏格拉底/案例研习同款），模式分段控件与
 * 建议 chips 由本模块注入输入区。
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') global.window = {};
  if (typeof document === 'undefined') {
    global.document = {
      createElement: () => ({
        style: {}, innerHTML: '', textContent: '', value: '',
        appendChild() {}, remove() {}, addEventListener() {},
        querySelector: () => null, querySelectorAll: () => [], setAttribute() {}
      }),
      body: { appendChild() {}, removeChild() {} },
      getElementById: () => null,
      addEventListener() {}, removeEventListener() {}
    };
  }

  // 外壳依赖（浏览器 index.html 已加载；Node 测试兜底引入）
  if (!window.NotebookModal && typeof require !== 'undefined') {
    try {
      window.NotebookModal = require('./notebook-modal.js').NotebookModal;
    } catch (_) { /* browser path */ }
  }

  function escapeHtml(text) {
    if (window.NotebookModal && window.NotebookModal.escapeHtml) {
      return window.NotebookModal.escapeHtml(text);
    }
    return String(text || '');
  }

  // ============================================
  // 纯函数层（Node 可测，不碰 DOM）
  // ============================================

  /** 章节名去掉扩展名（与 Rust chapter_stem 同规则） */
  function chapterStem(path) {
    return String(path || '').replace(/\.[^./\\]+$/, '');
  }

  /**
   * 记录的起点身份。一条伴学记录 = 一个起点：
   * - 划词起点：{chapter_stem}::{概念}（同一概念跨天/跨次面板追加成同一条）
   * - 全局起点（不划词）：每次打开面板各成一条
   */
  function recordKey(chapterFile, selectedText) {
    return selectedText
      ? chapterStem(chapterFile) + '::' + selectedText
      : 'global::' + new Date().toISOString();
  }

  var MODES = {
    explain: { name: '解释', icon: '💡', label: '💡 解释', tag: '💡 解释', placeholder: '问点什么… 比如：为什么是这样？' },
    example: { name: '举例', icon: '📋', label: '📋 举例', tag: '📋 举例', placeholder: '想要什么样的例子？直接说' },
    talk: { name: '我有话说', icon: '💬', label: '💬 我有话说', tag: '💬 我有话说', placeholder: '说说你的理解，我会给你反馈' },
    visualize: { name: '画个图', icon: '🖼️', label: '🖼️ 画个图', tag: '🖼️ 画个图', placeholder: '想怎么改这张图？直接说' }
  };

  var FALLBACK_CHIPS = {
    explain: ['这是什么意思？', '举个例子', '有什么应用场景？'],
    example: ['换个场景再讲一次', '让我试着复述这个案例', '这个概念有什么反例？'],
    talk: ['帮我总结我目前的理解水平', '我再补充一点', '再出一个检验我的问题'],
    visualize: ['换个角度再画一张', '把关键部位标出来', '画一张对比图']
  };

  // 错误分级（断流容灾 2026-10-14，与 agent-bridge.mjs classifyError 同规则）：
  // STALL=断流/超时（可重试）；NETWORK=连接类（可重试）；AUTH_FAILED=key 问题
  // （重试无意义，只引导去设置）；UNKNOWN=兜底原文。
  var CompanionErrors = {
    classify: function(msg) {
      var m = String(msg || '');
      if (/无数据|断流|响应中断|stream.*(stall|idle)/i.test(m)) return 'STALL';
      if (/\b(401|403)\b|unauthorized|forbidden|invalid api key|incorrect api key/i.test(m)) return 'AUTH_FAILED';
      if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|getaddrinfo|timed? ?out/i.test(m)) return 'NETWORK';
      return 'UNKNOWN';
    },
    /** 分级文案；UNKNOWN 返回 null（走调用方默认文案） */
    gradedText: function(code) {
      switch (code) {
        case 'STALL': return '模型无响应（连接中断，自动重试未能恢复）。可能是当前模型服务不稳定——可以重试，或去设置里切换到其他模型配置。';
        case 'NETWORK': return '无法连接模型服务器。请检查网络连接，或设置里的 base_url 是否正确。';
        case 'AUTH_FAILED': return 'API Key 无效或已过期。请打开设置检查当前模型配置。';
        default: return null;
      }
    },
    retryable: function(code) { return code === 'STALL' || code === 'NETWORK'; }
  };

  var CompanionCore = {
    MODES: MODES,
    FALLBACK_CHIPS: FALLBACK_CHIPS,
    chapterStem: chapterStem,
    recordKey: recordKey,

    /**
     * 建议 chips：优先用 LLM 返回的 suggested_questions，否则按模式给静态兜底。
     */
    chipPool: function(mode, suggestedQuestions) {
      if (Array.isArray(suggestedQuestions) && suggestedQuestions.length > 0) {
        return suggestedQuestions.slice(0, 3);
      }
      return FALLBACK_CHIPS[mode] || [];
    },

    /** 会话里学生说了几轮（= 对话轮数；tutor 轮不计） */
    userTurns: function(session) {
      return ((session && session.turns) || []).filter(function(t) {
        return t.role === 'user';
      }).length;
    },

    /**
     * 把三类落盘清单归并成「一条 = 一个起点」的记录列表（新→旧）。
     *
     * 起点身份即记录身份：
     * - 💡 解释天然按 (章节, 概念) 落盘，key 取 {chapter}::{selected_text}
     * - 📋/💬 会话带落盘时打的 start_key；旧会话没有则按 selected_text 回退，
     *   再不济各自成条（start_key 为空且无划词的全局会话 → 'session::{file}'）
     *
     * @param {{explanations:[], caseSessions:[], talkSessions:[], visualizeSessions:[]}} lists
     * @returns {Array} 记录项 {sortKey, primary, title, chapter, rounds, modes, global, record}
     *   record 直接喂给 AICompanionModal 的 opts.record 续聊
     */
    buildRecords: function(lists) {
      lists = lists || {};
      var groups = {};
      var order = [];
      function groupOf(key, init) {
        if (!Object.prototype.hasOwnProperty.call(groups, key)) {
          groups[key] = Object.assign({ key: key, explain: null, example: null, talk: null, visualize: null }, init);
          order.push(key);
        }
        return groups[key];
      }

      (lists.explanations || []).forEach(function(conv) {
        groupOf(conv.chapter + '::' + conv.selected_text, {
          term: conv.selected_text,
          chapterFile: conv.chapter
        }).explain = conv;
      });
      [['example', lists.caseSessions || []], ['talk', lists.talkSessions || []], ['visualize', lists.visualizeSessions || []]].forEach(function(pair) {
        pair[1].forEach(function(s) {
          var key = s.start_key
            || (s.selected_text ? chapterStem(s.chapter_file || '') + '::' + s.selected_text
              : 'session::' + s.file);
          var g = groupOf(key, { term: s.selected_text || '', chapterFile: s.chapter_file || '' });
          // 同一部分只留最新一次会话（续聊会覆盖原文件，正常不会有两条）
          if (!g[pair[0]] || String(g[pair[0]].ended_at || '') < String(s.ended_at || '')) {
            g[pair[0]] = s;
          }
        });
      });

      var items = [];
      order.forEach(function(key) {
        var g = groups[key];
        var rounds = (g.explain ? g.explain.rounds || 0 : 0)
          + CompanionCore.userTurns(g.example)
          + CompanionCore.userTurns(g.talk)
          + CompanionCore.userTurns(g.visualize);
        if (rounds === 0) return;

        // 主模式 = 最早起头的那部分；modes 摘要给「这次聊了哪些模式」
        var parts = [
          g.explain ? { mode: 'explain', at: g.explain.created_at, n: g.explain.rounds || 0 } : null,
          g.example ? { mode: 'example', at: g.example.started_at, n: CompanionCore.userTurns(g.example) } : null,
          g.talk ? { mode: 'talk', at: g.talk.started_at, n: CompanionCore.userTurns(g.talk) } : null,
          g.visualize ? { mode: 'visualize', at: g.visualize.started_at, n: CompanionCore.userTurns(g.visualize) } : null
        ].filter(Boolean).sort(function(a, b) {
          return String(a.at || '').localeCompare(String(b.at || ''));
        });

        var stamps = [
          g.explain && (g.explain.last_ts || g.explain.created_at),
          g.example && g.example.ended_at,
          g.talk && g.talk.ended_at,
          g.visualize && g.visualize.ended_at
        ].filter(Boolean).sort();

        items.push({
          key: key,
          sortKey: stamps.length ? stamps[stamps.length - 1] : '',
          primary: parts[0].mode,
          title: g.term || MODES[parts[0].mode].name,
          chapter: g.chapterFile ? chapterStem(g.chapterFile) : '',
          global: !g.term,
          rounds: rounds,
          modes: parts.map(function(p) {
            return MODES[p.mode].icon + p.n;
          }).join(' '),
          record: {
            start_key: key,
            selected_text: g.term,
            chapter_file: g.chapterFile,
            explain: g.explain,
            example: g.example,
            talk: g.talk,
            visualize: g.visualize
          }
        });
      });

      items.sort(function(a, b) {
        return String(b.sortKey).localeCompare(String(a.sortKey));
      });
      return items;
    },

    /**
     * 把当前线程压缩成跨模式上下文（priorDiscussion）：每轮一行、单轮截断
     * 200 字、总量截断 1600 字。给切换模式后的首个会话轮注入，AI 不丢前文。
     * @returns {string} 空线程返回空串
     */
    buildPriorDiscussion: function(turns) {
      if (!Array.isArray(turns) || turns.length === 0) return '';
      var lines = turns.map(function(t) {
        var who = t.role === 'user' ? '学生' : 'AI';
        var modeTag = MODES[t.mode] ? '(' + MODES[t.mode].tag + ')' : '';
        var content = String(t.content || '');
        if (content.length > 200) content = content.slice(0, 200) + '…';
        return who + modeTag + '：' + content;
      });
      var joined = lines.join('\n');
      if (joined.length > 1600) joined = joined.slice(0, 1600) + '\n…';
      return joined;
    }
  };

  // ============================================
  // 面板
  // ============================================

  class AICompanionModal {
    /**
     * @param {object} opts
     * @param {string} opts.projectPath
     * @param {string} [opts.selectedText] - 划词概念；空 = 自由发言
     * @param {object|null} [opts.context] - {chapterTitle, chapterGoal, surroundingText}
     * @param {string} [opts.chapterFile] - 当前章节文件名（落盘用）
     * @param {string} [opts.initialMode] - 'explain' | 'example' | 'talk'（默认 'talk'）
     * @param {object} [opts.record] - 伴学记录（一条 = 一个起点，见 recordKey）：
     *   {start_key, selected_text, chapter_file, explain?, example?, talk?}
     *   传了即续聊：回放整条线程，各部分写回原文件。打开时不发 LLM 调用。
     */
    constructor(opts) {
      this.projectPath = opts.projectPath;
      this.selectedText = opts.selectedText || '';
      this.context = opts.context || null;
      this.chapterFile = opts.chapterFile || '';
      this.initialMode = MODES[opts.initialMode] ? opts.initialMode : 'talk';

      // 起点身份：划词 = 概念（跨天追加成同一条）；无划词 = 本次面板（全局起点各一条）
      this.startKey = recordKey(this.chapterFile, this.selectedText);

      this.record = opts.record || null;
      this._resumed = !!this.record;

      // 线程：跨模式共享，{role:'user'|'tutor', mode, content}
      this.turns = [];
      // 解释场景的多轮历史（previousQa 契约）；案例/我有话说各自持有 session
      this._explainQa = [];
      this._lastSuggested = null;
      this._case = null;  // {sessionId, turns, startedAt, [overwriteFile, resumedTurnCount]}
      this._talk = null;  // 同上
      this._visualize = null;  // 同上
      this._mode = this.initialMode;
      this._busy = false;
      this._saved = false;
      this._shell = null;
      this.opened = false;

      if (this.record) this._hydrateRecord(this.record);
    }

    /**
     * 续聊：把一条记录的三个部分（💡/📋/💬）恢复成一份线程。
     * 各部分归位到自己的子状态（_explainQa / _case / _talk），结束时可分别写回原文件；
     * 线程按各部分的起始时间拼接回放。
     */
    _hydrateRecord(record) {
      this.selectedText = record.selected_text || this.selectedText;
      this.chapterFile = record.chapter_file || this.chapterFile;
      // 全局起点（无划词）沿用原 key，否则新内容会另起一条记录
      this.startKey = record.start_key || recordKey(this.chapterFile, this.selectedText);

      const parts = [];
      if (record.explain) {
        const conv = record.explain;
        // 解释的身份是 cue id（落盘 {chapter_stem}/{cue_id}.json），按原 id 覆写
        this._explainId = conv.id;
        this._explainChapter = conv.chapter || chapterStem(this.chapterFile);
        this._explainCreatedAt = conv.created_at || null;
        const qa = Array.isArray(conv.qa_history) ? conv.qa_history : [];
        this._explainQa = qa.map((h) => ({ q: h.q, a: h.a }));
        const turns = [];
        for (const h of qa) {
          if (h.q) turns.push({ role: 'user', mode: 'explain', content: h.q });
          if (h.a) turns.push({ role: 'tutor', mode: 'explain', content: h.a });
        }
        parts.push({ startAt: conv.created_at || '', turns: turns });
      }
      for (const pair of [['example', '_case'], ['talk', '_talk'], ['visualize', '_visualize']]) {
        const mode = pair[0];
        const s = record[mode];
        if (!s) continue;
        const replay = (s.turns || []).map((t) => ({ role: t.role, content: t.content }));
        this[pair[1]] = {
          sessionId: s.session_id || null,
          turns: replay.slice(),
          startedAt: s.started_at || null,
          overwriteFile: s.file || null,
          resumedTurnCount: replay.length
        };
        parts.push({
          startAt: s.started_at || '',
          turns: replay.map((t) => ({ role: t.role, mode: mode, content: t.content }))
        });
      }

      parts.sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
      this.turns = parts.reduce((acc, p) => acc.concat(p.turns), []);
      const last = this.turns[this.turns.length - 1];
      this.initialMode = last ? last.mode : 'talk';
      this._mode = this.initialMode;
    }

    async open() {
      this.opened = true;
      const esc = escapeHtml(this.selectedText);
      const chipsHtml = this.chapterFile
        ? `<span class="socratic-chip">📖 ${escapeHtml(this.chapterFile)}</span>`
        : '';

      this._shell = new window.NotebookModal({
        prefix: 'companion',
        icon: '✨',
        title: 'AI 伴学',
        subtitle: this._resumed
          ? `已恢复历史会话${this.selectedText ? ' · ' + esc : ''} · 可继续说`
          : this.selectedText
            ? `概念: ${esc} · 四种模式可随时切换`
            : '自由发言（未划词）· 四种模式可随时切换',
        chipsHtml,
        placeholder: this._resumed
          ? (this._mode === 'explain' ? '接着追问…' : '接着说你的理解…')
          : '选一种模式开始：💡 解释 / 📋 举例 / 💬 我有话说 / 🖼️ 画个图',
        tutorAvatar: '✨'
      });
      this._shell.render();
      this._shell.bindEvents({
        onSend: () => this._handleSend(),
        onEndClick: () => this._handleEndClick()
      });

      this._injectInputExtras();
      this._updateInputUi();

      if (this._resumed) {
        // 只回放，不发 LLM 调用（打开历史 ≠ 续聊）；输入保持可用
        for (const t of this.turns) {
          if (t.role === 'user') this._appendUserTurn(t.content, t.mode);
          else this._shell.appendTutorBubble(t.content);
        }
        return;
      }

      // 首轮种子：💡/📋/🖼️ 划词直达时自动开讲；💬 永远等学生先说（打开 ≠ 烧 token）
      if (this.initialMode === 'explain' && this.selectedText) {
        await this._sendExplainTurn(this.selectedText);
      } else if (this.initialMode === 'example' && this.selectedText) {
        await this._sendExampleTurn(null);
      } else if (this.initialMode === 'visualize' && this.selectedText) {
        await this._sendVisualizeTurn(null);
      }
    }

    // ---------- 输入区注入 ----------

    _injectInputExtras() {
      const inputArea = this._shell.cardEl.querySelector('.socratic-input-area');
      if (!inputArea) return;

      const inputRow = inputArea.querySelector('.socratic-input-row');

      const seg = document.createElement('div');
      seg.className = 'companion-mode-seg';
      seg.innerHTML = ['explain', 'example', 'talk', 'visualize'].map(function(m) {
        return `<button data-mode="${m}">${MODES[m].label}</button>`;
      }).join('');
      seg.addEventListener('click', (e) => {
        const mode = e.target && e.target.dataset && e.target.dataset.mode;
        if (mode) this._setMode(mode);
      });

      const chips = document.createElement('div');
      chips.className = 'companion-chips';

      if (inputRow) {
        inputArea.insertBefore(chips, inputRow);
        inputArea.insertBefore(seg, chips);
      } else {
        inputArea.appendChild(seg);
        inputArea.appendChild(chips);
      }
      this._segEl = seg;
      this._chipsEl = chips;
    }

    _setMode(mode) {
      if (!MODES[mode] || this._busy) return;
      this._mode = mode;
      this._updateInputUi();
    }

    _updateInputUi() {
      if (this._segEl) {
        const btns = this._segEl.querySelectorAll('button');
        for (let i = 0; i < btns.length; i++) {
          const b = btns[i];
          if (b.classList && b.classList.toggle) {
            b.classList.toggle('active', b.dataset && b.dataset.mode === this._mode);
          }
        }
      }
      if (this._shell && this._shell.inputEl) {
        this._shell.inputEl.placeholder = MODES[this._mode].placeholder;
      }
      this._renderChips();
    }

    _renderChips() {
      if (!this._chipsEl) return;
      const pool = CompanionCore.chipPool(this._mode, this._mode === 'explain' ? this._lastSuggested : null);
      this._chipsEl.innerHTML = pool.map(function(c) {
        return `<button class="companion-chip">${escapeHtml(c)}</button>`;
      }).join('');
      const self = this;
      const chipBtns = this._chipsEl.querySelectorAll('.companion-chip');
      for (let i = 0; i < chipBtns.length; i++) {
        chipBtns[i].addEventListener('click', function() {
          self._submitText(this.textContent);
        });
      }
    }

    // ---------- 发送与路由 ----------

    _handleSend() {
      if (this._busy) return;
      const text = this._shell.takeInput();
      if (!text) return;
      this._submitText(text);
    }

    _submitText(text) {
      if (this._busy || !this.opened) return;
      if (this._mode === 'explain') this._sendExplainTurn(text);
      else if (this._mode === 'example') this._sendExampleTurn(text);
      else if (this._mode === 'visualize') this._sendVisualizeTurn(text);
      else this._sendTalkTurn(text);
    }

    _appendUserTurn(content, mode) {
      const el = document.createElement('div');
      el.className = 'socratic-bubble-row-user';
      el.innerHTML = `
        <div class="socratic-bubble-user"><span class="companion-mode-tag t-${mode}">${MODES[mode].tag}</span>${escapeHtml(content)}</div>
        <div class="socratic-avatar-user">我</div>
      `;
      this._shell.chatEl.appendChild(el);
      this._shell.chatEl.scrollTop = this._shell.chatEl.scrollHeight;
    }

    _pushTurn(role, mode, content) {
      this.turns.push({ role: role, mode: mode, content: content });
    }

    _buildContext() {
      const ctx = Object.assign({}, this.context || {});
      const prior = CompanionCore.buildPriorDiscussion(this.turns);
      if (prior) ctx.priorDiscussion = prior;
      return ctx;
    }

    _showError(prefix, err, opts) {
      const raw = (err && err.message) || (typeof err === 'string' ? err : '') || '未知错误';
      const code = CompanionErrors.classify(raw);
      const graded = CompanionErrors.gradedText(code);
      if (!graded || !this._shell.appendErrorBubble) {
        this._shell.appendTutorBubble(prefix + raw + '。请稍后重试。');
        return;
      }
      const actions = {
        onOpenSettings: () => {
          if (window.TyporaNext && window.TyporaNext.openSettings) window.TyporaNext.openSettings();
        }
      };
      if (CompanionErrors.retryable(code) && opts && opts.onRetry) actions.onRetry = opts.onRetry;
      this._shell.appendErrorBubble(graded, actions);
    }

    // ---------- 💡 解释（explain_selection + cue 同步） ----------

    async _sendExplainTurn(question) {
      this._busy = true;
      this._appendUserTurn(question, 'explain');
      this._pushTurn('user', 'explain', question);

      const loading = this._shell.appendLoadingBubble();
      try {
        const result = await window.__TAURI__.core.invoke('explain_selection', {
          projectPath: this.projectPath,
          text: question,
          context: JSON.stringify(this._buildContext()),
          previousQa: this._explainQa.slice()
        });
        loading.remove();
        this._shell.appendTutorBubble(result.explanation);
        this._pushTurn('tutor', 'explain', result.explanation);
        this._explainQa.push({ q: question, a: result.explanation });
        this._lastSuggested = result.suggested_questions || [];
        if (this._explainId) {
          // 续聊已存在的解释记录：按原 id 覆写（不新建 cue、不落在当前章节）
          await this._persistExplain();
        } else {
          this._syncCue(question, result.explanation);
        }
      } catch (e) {
        loading.remove();
        this._showError('解释失败：', e);
      } finally {
        this._busy = false;
        this._updateInputUi();
      }
    }

    /** 续聊解释记录：按原 cue id / 章节覆写 .learning/explanations/{chapter}/{id}.json */
    async _persistExplain() {
      if (!window.__TAURI__) return;
      try {
        await window.__TAURI__.core.invoke('persist_explanation', {
          projectPath: this.projectPath,
          chapter: this._explainChapter || this.chapterFile,
          conversation: {
            id: this._explainId,
            selected_text: this.selectedText,
            anchor: null,
            qa_history: this._explainQa.map((h) => ({ q: h.q, a: h.a, ts: new Date().toISOString() })),
            created_at: this._explainCreatedAt || new Date().toISOString()
          }
        });
      } catch (e) {
        console.error('[AICompanionModal] persist_explanation failed:', e);
      }
    }

    /**
     * 解释轮次同步到康奈尔侧栏 cue 卡片（划词时）：
     * 面板是对话现场，cue 卡片是留痕 + 正文波浪线锚点。
     */
    _syncCue(question, answer) {
      if (!this.selectedText) return;
      if (window.LearningModeIntegration && window.LearningModeIntegration.syncCompanionCue) {
        window.LearningModeIntegration.syncCompanionCue({
          term: this.selectedText,
          question: question,
          answer: answer,
          suggestedQuestions: this._lastSuggested
        });
      }
    }

    // ---------- 📋 举例（case_study_chat，session + 流式） ----------

    async _sendExampleTurn(userText) {
      this._busy = true;
      const concept = this.selectedText || userText;
      const isFirst = !(this._case && this._case.sessionId);
      if (isFirst) {
        this._case = { sessionId: null, turns: [], startedAt: new Date().toISOString() };
      }

      // 用户可见轮：直达时显示划词概念，追问时显示输入原文
      const bubbleText = userText || concept;
      this._appendUserTurn(bubbleText, 'example');
      this._pushTurn('user', 'example', bubbleText);
      this._case.turns.push({ role: 'user', content: bubbleText });

      await this._streamingTurn({
        eventName: 'case-study-event',
        deltaType: 'case_study_delta',
        session: this._case,
        // 命令名字面量传入（保持可 grep + 合同测试可扫描）
        invoke: (args) => window.__TAURI__.core.invoke('case_study_chat', args),
        invokeArgs: () => ({
          projectPath: this.projectPath,
          selectedText: concept,
          context: JSON.stringify(this._buildContext()),
          userAnswer: userText || null,
          sessionId: this._case.sessionId
        })
      });
    }

    // ---------- 💬 我有话说（own_voice_chat，session + 流式） ----------

    async _sendTalkTurn(userText) {
      this._busy = true;
      const isFirst = !(this._talk && this._talk.sessionId);
      if (isFirst) {
        this._talk = { sessionId: null, turns: [], startedAt: new Date().toISOString() };
      }

      this._appendUserTurn(userText, 'talk');
      this._pushTurn('user', 'talk', userText);
      this._talk.turns.push({ role: 'user', content: userText });

      await this._streamingTurn({
        eventName: 'own-voice-event',
        deltaType: 'own_voice_delta',
        session: this._talk,
        invoke: (args) => window.__TAURI__.core.invoke('own_voice_chat', args),
        invokeArgs: () => ({
          projectPath: this.projectPath,
          selectedText: this.selectedText || null,
          context: JSON.stringify(this._buildContext()),
          userAnswer: userText,
          firstTurn: isFirst,
          sessionId: this._talk.sessionId
        })
      });
    }

    // ---------- 🖼️ 画个图（visualize_chat，session + 流式） ----------

    async _sendVisualizeTurn(userText) {
      this._busy = true;
      const concept = this.selectedText || userText;
      const isFirst = !(this._visualize && this._visualize.sessionId);
      if (isFirst) {
        this._visualize = { sessionId: null, turns: [], startedAt: new Date().toISOString() };
      }

      // 用户可见轮：直达时显示划词概念，追问时显示输入原文
      const bubbleText = userText || concept;
      this._appendUserTurn(bubbleText, 'visualize');
      this._pushTurn('user', 'visualize', bubbleText);
      this._visualize.turns.push({ role: 'user', content: bubbleText });

      await this._streamingTurn({
        eventName: 'visualize-event',
        deltaType: 'visualize_delta',
        session: this._visualize,
        // 命令名字面量传入（保持可 grep + 合同测试可扫描）
        invoke: (args) => window.__TAURI__.core.invoke('visualize_chat', args),
        invokeArgs: () => ({
          projectPath: this.projectPath,
          selectedText: concept,
          context: JSON.stringify(this._buildContext()),
          userAnswer: userText || null,
          sessionId: this._visualize.sessionId
        })
      });
    }

    /**
     * 案例/我有话说共用的流式轮：监听 Rust 转发的 delta 事件，首个 delta
     * 到达撤 loading 改流式气泡；最终以权威结果覆盖 delta 累积。
     */
    async _streamingTurn(spec) {
      let stream = null;
      let accumulated = '';
      let unlisten = null;
      const loadingEl = this._shell.appendLoadingBubble();
      try {
        if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
          try {
            unlisten = await window.__TAURI__.event.listen(spec.eventName, (ev) => {
              const payload = ev && ev.payload;
              if (!payload) return;
              // 状态透出（断流容灾 2026-10-14）：连接中/自动重试等状态更新到
              // loading 气泡，用户不再对着「思考中...」干等
              if (payload.type === 'status') {
                const msg = payload.data && payload.data.message;
                const label = msg && loadingEl.querySelector && loadingEl.querySelector('.socratic-bubble-loading');
                if (label && loadingEl.isConnected !== false) label.textContent = msg;
                return;
              }
              if (payload.type !== spec.deltaType) return;
              const delta = payload.data && payload.data.delta;
              if (!delta) return;
              if (!stream) {
                loadingEl.remove();
                stream = this._shell.startTutorStream();
              }
              accumulated += delta;
              stream.update(accumulated);
            });
          } catch (e) {
            console.warn('[AICompanionModal] event listen unavailable, non-stream fallback:', e);
          }
        }

        const args = spec.invokeArgs();
        const resp = await spec.invoke(args);
        if (unlisten) unlisten();
        if (resp.session_id) spec.session.sessionId = resp.session_id;
        spec.session.turns.push({ role: 'tutor', content: resp.content });
        this._pushTurn('tutor', this._mode, resp.content);
        if (stream) {
          stream.finalize(resp.content);  // 权威结果覆盖 delta 累积
        } else {
          loadingEl.remove();
          this._shell.appendTutorBubble(resp.content);
        }
      } catch (e) {
        if (unlisten) unlisten();
        if (stream) stream.remove();
        else loadingEl.remove();
        // 重试不重发用户气泡：invokeArgs 闭包会带上最新 sessionId 直接重跑这一轮
        this._showError('暂时无法回复：', e, {
          onRetry: () => {
            this._busy = true;
            this._updateInputUi();
            this._streamingTurn(spec);
          }
        });
      } finally {
        this._busy = false;
        this._updateInputUi();
      }
    }

    // ---------- 结束与落盘 ----------

    _handleEndClick() {
      if (this._saved) {
        this._close();
        return;
      }
      if (window.confirm('确定结束本次 AI 伴学？举例、画图与我有话说的对话会保存')) {
        this._confirmEnd();
      }
    }

    async _confirmEnd() {
      this._saved = true;
      const failures = [];
      // 续聊但没有任何新增轮次 → 不动盘（重写只会污染 ended_at 并让历史条目置顶）
      const caseDirty = this._case && this._case.turns.length > (this._case.resumedTurnCount || 0);
      const talkDirty = this._talk && this._talk.turns.length > (this._talk.resumedTurnCount || 0);
      const visualizeDirty = this._visualize && this._visualize.turns.length > (this._visualize.resumedTurnCount || 0);

      if (caseDirty) {
        const ok = await this._persistSession(
          (args) => window.__TAURI__.core.invoke('case_study_save_session', args),
          {
            version: '1.0',
            start_key: this.startKey,
            selected_text: this.selectedText || (this._case.turns[0] && this._case.turns[0].content) || '',
            chapter_file: this.chapterFile,
            session_id: this._case.sessionId,
            turns: this._case.turns,
            started_at: this._case.startedAt,
            ended_at: new Date().toISOString(),
            end_reason: 'user_ended'
          },
          this._case.overwriteFile || null);
        if (!ok) failures.push('举例对话');
      }
      if (talkDirty) {
        const ok = await this._persistSession(
          (args) => window.__TAURI__.core.invoke('own_voice_save_session', args),
          {
            version: '1.0',
            start_key: this.startKey,
            selected_text: this.selectedText || (this._talk.turns[0] && this._talk.turns[0].content) || '',
            chapter_file: this.chapterFile,
            session_id: this._talk.sessionId,
            turns: this._talk.turns,
            started_at: this._talk.startedAt,
            ended_at: new Date().toISOString(),
            end_reason: 'user_ended'
          },
          this._talk.overwriteFile || null);
        if (!ok) failures.push('我有话说对话');
      }
      if (visualizeDirty) {
        const ok = await this._persistSession(
          (args) => window.__TAURI__.core.invoke('visualize_save_session', args),
          {
            version: '1.0',
            start_key: this.startKey,
            selected_text: this.selectedText || (this._visualize.turns[0] && this._visualize.turns[0].content) || '',
            chapter_file: this.chapterFile,
            session_id: this._visualize.sessionId,
            turns: this._visualize.turns,
            started_at: this._visualize.startedAt,
            ended_at: new Date().toISOString(),
            end_reason: 'user_ended'
          },
          this._visualize.overwriteFile || null);
        if (!ok) failures.push('画图对话');
      }

      if (failures.length > 0) {
        this._saved = false;  // 允许重试
        this._shell.appendTutorBubble('保存失败（' + failures.join('、') + '）：磁盘写入错误。对话仍保留在面板中，可再次点结束。');
        return;
      }
      this._close();
    }

    async _persistSession(invokeFn, session, overwriteFile) {
      if (!window.__TAURI__) return true;
      try {
        // 续聊：覆盖原会话文件（身份来自伴学记录列表注入的 file）
        await invokeFn({
          projectPath: this.projectPath,
          session: session,
          overwriteFile: overwriteFile || null
        });
        return true;
      } catch (e) {
        console.error('[AICompanionModal] save_session failed:', e);
        return false;
      }
    }

    _close() {
      this._shell.close();
      this.opened = false;
    }
  }

  window.AICompanionModal = AICompanionModal;
  window.CompanionCore = CompanionCore;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AICompanionModal, CompanionCore, CompanionErrors };
  }
})();
