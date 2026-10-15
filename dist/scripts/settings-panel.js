/**
 * Settings Panel — grouped settings UI (AI / 论文服务 / 外观).
 *
 * Extracted from main.js (refactor):
 *   - groups settings into tabs instead of one flat scrollable list
 *   - save() merges with the current config so UI state fields
 *     (sidebar_collapsed / sidebar_active_tab / last_file) are never
 *     wiped by a full-overwrite save (previous saveSettings bug)
 *   - Word 导出模板 moved from localStorage into the main config
 */

(function (global) {
  'use strict';

  // bdd-acceptance 多套件会整替换 global.window，本模块捕获的 global 不可控；
  // 注入点绕过全局探测，让测试确定性地接管 invoke 通道。
  let _invokeOverride = null;

  function invoke(cmd, args) {
    if (_invokeOverride) return _invokeOverride(cmd, args); // 测试注入（同 agent-bridge __setRunnerForTests 模式）
    if (global.TyporaNext && typeof global.TyporaNext.invoke === 'function') {
      return global.TyporaNext.invoke(cmd, args);
    }
    if (global.__TAURI__ && global.__TAURI__.core) {
      return global.__TAURI__.core.invoke(cmd, args);
    }
    return Promise.reject(new Error('Tauri 未就绪'));
  }

  const GROUPS = [
    { id: 'ai', title: 'AI' },
    { id: 'papers', title: '论文服务' },
    { id: 'appearance', title: '外观' },
    { id: 'misc', title: '通用' }
  ];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function labeledItem(labelText, input, hintId) {
    const item = el('div', 'setting-item');
    const label = el('label', 'setting-label', labelText);
    item.appendChild(label);
    item.appendChild(input);
    if (hintId) {
      const hint = el('div', 'setting-hint');
      hint.id = hintId;
      item.appendChild(hint);
    }
    return item;
  }

  function textInput(id, placeholder, password) {
    const input = el('input', 'setting-input');
    input.id = id;
    input.type = password ? 'password' : 'text';
    if (placeholder) input.placeholder = placeholder;
    return input;
  }

  /**
   * AI 模型配置 profile——纯函数状态操作（无 DOM，可 Node 直测）。
   * 平级卡片 + 一个激活项，无主备语义；与 Rust ai_profiles.rs 规则一致。
   * state 形状：{ profiles: AiProfile[], active_id: string|null }
   */
  const ProfileOps = {
    _nextId(profiles) {
      const ids = new Set(profiles.map((p) => p.id));
      let n = profiles.length + 1;
      while (ids.has(`profile-${n}`)) n++;
      return `profile-${n}`;
    },

    /** 无 id 或 id 不在列表 → 追加（首张自动激活）；id 命中 → 原位更新。 */
    upsert(state, card) {
      const profiles = (state.profiles || []).slice();
      let activeId = state.active_id || null;
      const idx = card.id ? profiles.findIndex((p) => p.id === card.id) : -1;
      if (idx >= 0) {
        profiles[idx] = Object.assign({}, card);
      } else {
        const id = card.id || this._nextId(profiles);
        profiles.push(Object.assign({}, card, { id }));
        if (!activeId) activeId = id;
      }
      return { profiles, active_id: activeId };
    },

    activate(state, id) {
      const profiles = (state.profiles || []).slice();
      if (!profiles.some((p) => p.id === id)) {
        return { profiles, active_id: state.active_id || null };
      }
      return { profiles, active_id: id };
    },

    /** 删除激活卡 → 回退第一张；删空 → active_id null。 */
    remove(state, id) {
      const profiles = (state.profiles || []).filter((p) => p.id !== id);
      let activeId = state.active_id || null;
      if (activeId === id) activeId = profiles.length ? profiles[0].id : null;
      return { profiles, active_id: activeId };
    },

    /** 旧四字段视图 = 激活卡内容；激活 id 悬空回退第一张；空列表全 null。 */
    deriveLegacy(state) {
      const profiles = state.profiles || [];
      if (!profiles.length) {
        return { api_key: null, ai_provider: null, ai_base_url: null, model: null };
      }
      const active = profiles.find((p) => p.id === state.active_id) || profiles[0];
      return {
        api_key: active.api_key || null,
        ai_provider: active.provider || null,
        ai_base_url: active.base_url || null,
        model: active.model || null
      };
    }
  };

  const SettingsPanel = {
    _root: null,
    _mounted: false,
    _resolvedPapersDir: null,
    _profileState: { profiles: [], active_id: null },
    _selectedProfileId: null,

    /** 测试注入：替换 invoke 通道；传 null 还原。 */
    __setInvokeForTests(fn) { _invokeOverride = fn; },

    mount(root) {
      if (this._mounted && this._root === root) return;
      this._root = root;
      this._mounted = true;
      root.innerHTML = '';

      const tabBar = el('div', 'settings-tabs');
      GROUPS.forEach((group) => {
        const tab = el('button', 'settings-tab', group.title);
        tab.setAttribute('data-group', group.id);
        tab.addEventListener('click', () => this._activate(group.id));
        tabBar.appendChild(tab);
      });
      root.appendChild(tabBar);

      root.appendChild(this._buildAiGroup());
      root.appendChild(this._buildPapersGroup());
      root.appendChild(this._buildAppearanceGroup());
      root.appendChild(this._buildMiscGroup());

      const footer = el('div', 'settings-actions');
      const saveBtn = el('button', 'settings-save-btn', '保存');
      saveBtn.id = 'settingsSaveBtn';
      saveBtn.addEventListener('click', () => this.save());
      footer.appendChild(saveBtn);
      root.appendChild(footer);

      this._activate('ai');
    },

    _activate(groupId) {
      const tabs = this._root.querySelectorAll('.settings-tab');
      tabs.forEach((tab) => {
        const active = tab.getAttribute('data-group') === groupId;
        tab.classList.toggle('active', active);
      });
      GROUPS.forEach((group) => {
        const section = this._root.querySelector(`#group-${group.id}`);
        if (section) section.style.display = group.id === groupId ? '' : 'none';
      });
    },

    _buildGroup(id, title) {
      const group = el('div', 'settings-group');
      group.id = `group-${id}`;
      group.appendChild(el('div', 'settings-group-title', title));
      return group;
    },

    _buildAiGroup() {
      const group = this._buildGroup('ai', 'AI');

      // profile 卡片列表：平级配置 + 一个激活项（无主备语义，谁激活谁在用）
      const listSection = el('div', 'ai-profile-section');
      listSection.appendChild(el('div', 'setting-hint', '模型配置卡片：一张卡 = 连接 + 模型；点「激活」切换生效配置'));
      const list = el('div', 'ai-profile-list');
      list.id = 'aiProfileList';
      listSection.appendChild(list);
      const addBtn = el('button', 'settings-test-btn', '+ 新增配置');
      addBtn.id = 'aiProfileAddBtn';
      addBtn.addEventListener('click', () => this._addProfileCard());
      listSection.appendChild(addBtn);
      group.appendChild(listSection);

      const editorTitle = el('div', 'setting-hint');
      editorTitle.id = 'aiProfileEditorHint';
      group.appendChild(editorTitle);

      const provider = el('select', 'setting-select');
      provider.id = 'settingApiProvider';
      [['anthropic', 'Anthropic'], ['openai', 'OpenAI']].forEach(([value, text]) => {
        const opt = el('option', '', text);
        opt.setAttribute('value', value);
        provider.appendChild(opt);
      });
      group.appendChild(labeledItem('API 格式', provider));

      group.appendChild(labeledItem('Base URL', textInput('settingAiBaseUrl', '留空使用默认地址')));

      group.appendChild(labeledItem('模型名称', textInput('settingModel', 'claude-3-5-haiku-20241022')));

      const apiKey = textInput('settingApiKey', '', true);
      group.appendChild(labeledItem('API Key', apiKey, 'settingApiKeyHint'));
      const hint = group.querySelector('#settingApiKeyHint');
      hint.textContent = '用于 AI 功能（Mermaid 修复、论文导读、章节生成等）';

      // 注：底部旧的整组连通性测试按钮已移除（2026-10-15）——每张卡有自己的「检测」，
      // 旧按钮测的是激活卡而非编辑中的卡，语义混乱。

      return group;
    },

    /** 卡片显示名：name || model || provider，复制时追加「副本」。 */
    _profileLabel(card) {
      return card.name || card.model || card.provider || '新配置';
    },

    _renderProfileCards() {
      const list = this._root && this._root.querySelector('#aiProfileList');
      if (!list) return;
      list.innerHTML = '';
      const { profiles, active_id } = this._profileState;
      profiles.forEach((card) => {
        const row = el('div', 'ai-profile-card');
        row.setAttribute('data-profile-id', card.id);
        if (card.id === active_id) row.classList.add('active');
        if (card.id === this._selectedProfileId) row.classList.add('selected');

        const main = el('div', 'ai-profile-card-main');
        const nameLine = el('div', 'ai-profile-card-name', this._profileLabel(card));
        if (card.id === active_id) nameLine.appendChild(el('span', 'ai-profile-active-badge', '使用中'));
        main.appendChild(nameLine);
        const sub = [card.provider, card.model].filter(Boolean).join(' · ');
        if (sub) main.appendChild(el('div', 'ai-profile-card-sub', sub));
        const check = el('div', 'ai-profile-card-check');
        main.appendChild(check);
        main.addEventListener('click', () => this._selectProfile(card.id));
        row.appendChild(main);

        const actions = el('div', 'ai-profile-card-actions');
        if (card.id !== active_id) {
          const activateBtn = el('button', 'ai-profile-btn', '激活');
          activateBtn.addEventListener('click', () => {
            this._flushFormToSelected();
            this._profileState = ProfileOps.activate(this._profileState, card.id);
            this._renderProfileCards();
            // 激活即落盘（2026-10-15 事故：只改内存态 → 磁盘仍是旧卡，
            // 状态灯/agent 检的是磁盘配置 → 用户分不清「到底谁在用」）
            this._persistProfiles();
          });
          actions.appendChild(activateBtn);
        }
        const editBtn = el('button', 'ai-profile-btn', '编辑');
        editBtn.addEventListener('click', () => this._selectProfile(card.id));
        actions.appendChild(editBtn);
        const copyBtn = el('button', 'ai-profile-btn', '复制');
        copyBtn.addEventListener('click', () => {
          this._flushFormToSelected();
          this._profileState = ProfileOps.upsert(this._profileState, Object.assign({}, card, {
            id: '', name: `${this._profileLabel(card)} 副本`
          }));
          this._renderProfileCards();
        });
        actions.appendChild(copyBtn);
        const checkBtn = el('button', 'ai-profile-btn', '检测');
        checkBtn.addEventListener('click', () => this._checkProfileCard(card, check));
        actions.appendChild(checkBtn);
        const removeBtn = el('button', 'ai-profile-btn', '删除');
        removeBtn.addEventListener('click', () => {
          const wasSelected = this._selectedProfileId === card.id;
          this._profileState = ProfileOps.remove(this._profileState, card.id);
          if (wasSelected) {
            this._selectedProfileId = null;
            const fallback = this._profileState.profiles.find((p) => p.id === this._profileState.active_id);
            if (fallback) this._selectProfile(fallback.id);
          }
          this._renderProfileCards();
        });
        actions.appendChild(removeBtn);
        row.appendChild(actions);

        list.appendChild(row);
      });
      this._updateEditorHint();
    },

    _updateEditorHint() {
      const hint = this._root && this._root.querySelector('#aiProfileEditorHint');
      if (!hint) return;
      const selected = this._profileState.profiles.find((p) => p.id === this._selectedProfileId);
      hint.textContent = selected ? `正在编辑：${this._profileLabel(selected)}` : '';
    },

    _addProfileCard() {
      this._flushFormToSelected();
      this._profileState = ProfileOps.upsert(this._profileState, {
        id: '', name: '', provider: 'openai', base_url: '', api_key: '', model: ''
      });
      const added = this._profileState.profiles[this._profileState.profiles.length - 1];
      this._selectProfile(added.id);
    },

    _selectProfile(id) {
      if (this._selectedProfileId && this._selectedProfileId !== id) this._flushFormToSelected();
      this._selectedProfileId = id;
      const card = this._profileState.profiles.find((p) => p.id === id);
      if (card) this._fillFormFromCard(card);
      this._renderProfileCards();
    },

    /** 表单四个字段 → 当前选中卡（内存态；落盘走 collect/save）。 */
    _flushFormToSelected() {
      const card = this._profileState.profiles.find((p) => p.id === this._selectedProfileId);
      if (!card || !this._root) return;
      const val = (id) => {
        const input = this._root.querySelector(`#${id}`);
        return input ? input.value.trim() : '';
      };
      card.provider = val('settingApiProvider') || 'anthropic';
      card.base_url = val('settingAiBaseUrl');
      card.model = val('settingModel');
      card.api_key = val('settingApiKey');
    },

    _fillFormFromCard(card) {
      const set = (id, value) => {
        const input = this._root && this._root.querySelector(`#${id}`);
        if (input) input.value = value || '';
      };
      set('settingApiProvider', card.provider || 'anthropic');
      set('settingAiBaseUrl', card.base_url);
      set('settingModel', card.model);
      set('settingApiKey', card.api_key);
    },

    /**
     * 激活变更的轻量落盘：只写 profile 相关键 + 派生旧字段，
     * 不弹 toast、不关面板（与底部「保存」的全量 save 区分）。
     * merge-then-save：先读磁盘配置再合并，避免覆盖其他模块刚写的字段。
     */
    async _persistProfiles() {
      if (!this._profileState.profiles.length) return;
      this._flushFormToSelected();
      const legacy = ProfileOps.deriveLegacy(this._profileState);
      try {
        const current = (await invoke('get_config')) || {};
        const config = Object.assign({}, current, {
          ai_profiles: this._profileState.profiles,
          active_profile_id: this._profileState.active_id,
          api_key: legacy.api_key,
          ai_provider: legacy.ai_provider || 'anthropic',
          ai_base_url: legacy.ai_base_url,
          model: legacy.model
        });
        await invoke('set_config', { config });
        // 落盘成功 → 让状态灯立刻重检新激活卡（不经过 onSettingsSaved，
        // 那条路径只在底部「保存」时触发且会关面板）
        if (global.TyporaNext && typeof global.TyporaNext.recheckAgentStatus === 'function') {
          global.TyporaNext.recheckAgentStatus();
        }
      } catch (e) {
        const message = `激活保存失败：${(e && e.message) || e}`;
        console.error('[SettingsPanel]', message);
        const hint = this._root && this._root.querySelector('#aiProfileEditorHint');
        if (hint) hint.textContent = message;
      }
    },

    /** 单卡立即检测（不经过保存）：用卡片自身字段调 test_llm_config。 */
    async _checkProfileCard(card, checkEl) {
      // 正在编辑的正是这张卡 → 先把表单值刷进来：检测的应是用户眼前看到的配置，
      // 而不是上次的存量（2026-10-15 实机踩坑：改完 base_url 点检测，测的是旧值）
      if (this._selectedProfileId === card.id) this._flushFormToSelected();
      if (checkEl) checkEl.textContent = '检测中…';
      try {
        await invoke('test_llm_config', {
          config: {
            api_key: card.api_key || null,
            ai_provider: card.provider || 'anthropic',
            ai_base_url: card.base_url || null,
            model: card.model || null
          }
        });
        if (checkEl) checkEl.textContent = '连接成功';
      } catch (err) {
        if (checkEl) checkEl.textContent = `连接失败：${(err && err.message) || err}`;
      }
    },

    _buildPapersGroup() {
      const group = this._buildGroup('papers', '论文服务');

      group.appendChild(labeledItem('minerU API Token', textInput('settingMineruToken', '', true)));
      group.appendChild(labeledItem('minerU Base URL', textInput('settingMineruBaseUrl', 'https://mineru.net')));

      const model = el('select', 'setting-select');
      model.id = 'settingMineruModel';
      [['vlm', 'vlm'], ['pipeline', 'pipeline']].forEach(([value, text]) => {
        const opt = el('option', '', text);
        opt.setAttribute('value', value);
        model.appendChild(opt);
      });
      group.appendChild(labeledItem('minerU 模型版本', model));

      group.appendChild(labeledItem('AnySearch API Key', textInput('settingAnysearchKey', '', true)));
      const hint = el('div', 'setting-hint', '论文搜索用，留空则匿名搜索（限额较低）');
      group.appendChild(hint);

      // 论文库根目录：只读输入框 + 系统目录选择对话框 + 打开所在文件夹
      const dirInput = textInput('settingPapersDir', '默认（应用数据目录）');
      dirInput.readOnly = true;
      const pickBtn = el('button', 'setting-pick-btn', '选择…');
      pickBtn.id = 'settingPapersDirPick';
      pickBtn.addEventListener('click', async () => {
        try {
          const picked = await invoke('pick_papers_dir');
          if (picked) dirInput.value = picked;
        } catch (e) {
          // 用户取消或对话框失败：保持原值
        }
      });
      const openBtn = el('button', 'setting-pick-btn', '📂 打开');
      openBtn.id = 'settingPapersDirOpen';
      openBtn.addEventListener('click', async () => {
        // 优先打开输入框里（未保存的）新选择，否则打开生效中的目录
        const target = (dirInput.value || '').trim() || this._resolvedPapersDir;
        if (!target) return;
        try {
          await invoke('open_folder', { path: target });
        } catch (e) {
          const hint = this._root.querySelector('#settingPapersDirHint');
          if (hint) hint.textContent = `打开失败：${(e && e.message) || e}`;
        }
      });
      const resetBtn = el('button', 'setting-pick-btn', '恢复默认');
      resetBtn.id = 'settingPapersDirReset';
      resetBtn.addEventListener('click', () => {
        dirInput.value = '';
      });
      const dirRow = el('div', 'setting-dir-row');
      dirRow.appendChild(dirInput);
      dirRow.appendChild(pickBtn);
      dirRow.appendChild(openBtn);
      dirRow.appendChild(resetBtn);
      group.appendChild(labeledItem('论文库根目录', dirRow));
      // hint 动态化——显示解析后的实际目录，默认位置不再是谜
      const dirHint = el('div', 'setting-hint', '缓存的论文按搜索领域自动分目录存放（根目录/领域/年月），留空用默认位置');
      dirHint.id = 'settingPapersDirHint';
      group.appendChild(dirHint);

      return group;
    },

    /** 拉取后端解析出的生效论文目录，更新提示（load/save 后都要刷新）。 */
    async _refreshPapersDirHint() {
      try {
        this._resolvedPapersDir = await invoke('get_papers_dir');
        const hint = this._root && this._root.querySelector('#settingPapersDirHint');
        if (hint && this._resolvedPapersDir) {
          hint.textContent = `当前目录：${this._resolvedPapersDir}（缓存按搜索领域分目录：领域/年月）`;
        }
      } catch (e) {
        // 解析失败静默降级为静态提示
      }
    },

    _buildAppearanceGroup() {
      const group = this._buildGroup('appearance', '外观');

      const theme = el('select', 'setting-select');
      theme.id = 'settingTheme';
      [['', '跟随系统'], ['light', '浅色'], ['dark', '深色']].forEach(([value, text]) => {
        const opt = el('option', '', text);
        opt.setAttribute('value', value);
        theme.appendChild(opt);
      });
      group.appendChild(labeledItem('主题', theme));

      const cursors = [
        ['', '系统默认'], ['pencil', '铅笔'], ['highlighter', '荧光笔'], ['pen', '圆珠笔'],
        ['cat', '猫咪'], ['microphone', '麦克风'], ['rocket', '火箭'], ['falcon9', '猎鹰九号'],
        ['wand', '魔法棒'], ['leaf', '叶子'], ['star', '星星'], ['coffee', '咖啡杯'],
        ['bulb', '灯泡']
      ];
      const cursor = el('select', 'setting-select');
      cursor.id = 'settingCustomCursor';
      cursors.forEach(([value, text]) => {
        const opt = el('option', '', text);
        opt.setAttribute('value', value);
        cursor.appendChild(opt);
      });
      group.appendChild(labeledItem('鼠标光标', cursor));

      return group;
    },

    _buildMiscGroup() {
      const group = this._buildGroup('misc', '通用');

      const onboardingRow = el('div', 'setting-item');
      const onboardingBtn = el('button', 'settings-test-btn', '重新显示引导');
      onboardingBtn.id = 'restartOnboardingBtn';
      onboardingBtn.addEventListener('click', () => {
        if (global.TyporaNext && typeof global.TyporaNext.restartOnboarding === 'function') {
          global.TyporaNext.restartOnboarding();
        }
      });
      onboardingRow.appendChild(onboardingBtn);
      onboardingRow.appendChild(el('span', 'setting-hint', '再次显示工具栏功能介绍'));
      group.appendChild(onboardingRow);

      const wordTpl = el('input', 'setting-checkbox');
      wordTpl.id = 'settingWordTemplate';
      wordTpl.type = 'checkbox';
      group.appendChild(labeledItem('Word 导出模板', wordTpl));
      group.appendChild(el('span', 'setting-hint', '启用后每次导出 Word 时可选择模板 .docx 文件控制输出样式'));

      const aboutRow = el('div', 'settings-about-link');
      const aboutBtn = el('span', 'about-link-text', '关于 Typora Next');
      aboutBtn.id = 'settingsAboutBtn';
      aboutBtn.addEventListener('click', () => {
        if (global.TyporaNext && typeof global.TyporaNext.openAbout === 'function') {
          global.TyporaNext.openAbout();
        }
      });
      aboutRow.appendChild(aboutBtn);
      group.appendChild(aboutRow);

      return group;
    },

    async load(config) {
      const cfg = config || {};
      const set = (id, value) => {
        const input = this._root.querySelector(`#${id}`);
        if (input) input.value = value || '';
      };
      // profile 卡片：Rust get_config 已做迁移（旧四字段 → ai_profiles + active_profile_id）
      if (Array.isArray(cfg.ai_profiles) && cfg.ai_profiles.length) {
        this._profileState = {
          profiles: cfg.ai_profiles.map((p) => Object.assign({}, p)),
          active_id: cfg.active_profile_id || cfg.ai_profiles[0].id
        };
        const active = this._profileState.profiles.find((p) => p.id === this._profileState.active_id)
          || this._profileState.profiles[0];
        this._selectedProfileId = active.id;
        this._fillFormFromCard(active);
        this._renderProfileCards();
      } else {
        this._profileState = { profiles: [], active_id: null };
        this._selectedProfileId = null;
        set('settingApiProvider', cfg.ai_provider || 'anthropic');
        set('settingAiBaseUrl', cfg.ai_base_url);
        set('settingModel', cfg.model);
        set('settingApiKey', cfg.api_key);
        this._renderProfileCards();
      }
      set('settingMineruToken', cfg.mineru_api_token);
      set('settingMineruBaseUrl', cfg.mineru_base_url);
      set('settingMineruModel', cfg.mineru_model_version || 'vlm');
      set('settingAnysearchKey', cfg.anysearch_api_key);
      set('settingPapersDir', cfg.papers_root || '');
      set('settingTheme', cfg.theme);
      set('settingCustomCursor', cfg.custom_cursor);
      await this._refreshPapersDirHint();

      const wordTpl = this._root.querySelector('#settingWordTemplate');
      if (wordTpl) {
        let value = cfg.word_export_use_template;
        // 旧版本存 localStorage，迁移一次
        if (value === undefined || value === null) {
          try {
            const legacy = global.localStorage && global.localStorage.getItem('wordExportUseTemplate');
            value = legacy === 'true';
          } catch (e) {
            value = false;
          }
        }
        wordTpl.checked = !!value;
      }
    },

    collect() {
      const val = (id) => {
        const input = this._root.querySelector(`#${id}`);
        return input ? input.value.trim() : '';
      };
      const wordTpl = this._root.querySelector('#settingWordTemplate');
      const config = {
        mineru_api_token: val('settingMineruToken') || null,
        mineru_base_url: val('settingMineruBaseUrl') || null,
        mineru_model_version: val('settingMineruModel') || null,
        anysearch_api_key: val('settingAnysearchKey') || null,
        papers_root: val('settingPapersDir') || null,
        theme: val('settingTheme') || null,
        custom_cursor: val('settingCustomCursor') || null,
        word_export_use_template: !!(wordTpl && wordTpl.checked)
      };
      // profile 模式：旧四字段 = 激活卡的派生视图（与 Rust derive_legacy 一致）
      if (this._profileState.profiles.length) {
        this._flushFormToSelected();
        const legacy = ProfileOps.deriveLegacy(this._profileState);
        config.ai_profiles = this._profileState.profiles;
        config.active_profile_id = this._profileState.active_id;
        config.api_key = legacy.api_key;
        config.ai_provider = legacy.ai_provider || 'anthropic';
        config.ai_base_url = legacy.ai_base_url;
        config.model = legacy.model;
      } else {
        config.api_key = val('settingApiKey') || null;
        config.ai_provider = val('settingApiProvider') || 'anthropic';
        config.ai_base_url = val('settingAiBaseUrl') || null;
        config.model = val('settingModel') || null;
      }
      return config;
    },

    /**
     * Merge-then-save: fetch current config first so UI state fields
     * (sidebar_collapsed / sidebar_active_tab / last_file) survive the
     * full-overwrite set_config.
     */
    async save() {
      const current = await invoke('get_config') || {};
      const config = Object.assign({}, current, this.collect());
      await invoke('set_config', { config });
      await this._refreshPapersDirHint();
      if (global.TyporaNext && typeof global.TyporaNext.onSettingsSaved === 'function') {
        global.TyporaNext.onSettingsSaved(config);
      }
      return config;
    }
  };

  global.SettingsPanel = SettingsPanel;
  global.ProfileOps = ProfileOps;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SettingsPanel, ProfileOps };
  }
})(typeof window !== 'undefined' ? window : global);
