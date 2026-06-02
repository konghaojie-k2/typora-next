/**
 * Learning Project Manager
 * Handles the "New Learning Project" dialog state machine and outline management
 *
 * State Machine:
 *   idle -> input -> planning -> outline -> generating
 *                    ^                    |
 *                    |____________________|
 *                    (on error or re-plan)
 */

(function() {
  'use strict';

  // ============================================
  // State (matches TDD test contract)
  // ============================================
  const dialogState = {
    step: 'idle',           // idle | input | planning | outline | generating
    goal: '',
    level: 'intermediate',
    hours: 3,
    outline: null,
    isLoading: false,
    error: null,
    projectPath: null
  };

  // Valid chapter statuses
  const CHAPTER_STATUS = {
    NOT_GENERATED: 'not_generated',
    GENERATING: 'generating',
    READY: 'ready',
    COMPLETED: 'completed',
    FAILED: 'failed'
  };

  // ============================================
  // DOM Elements
  // ============================================
  const elements = {
    modal: null,
    title: null,
    body: null,
    footer: null,
    closeBtn: null,
    cancelBtn: null,
    actionBtn: null,
    stepInput: null,
    stepPlanning: null,
    stepOutline: null,
    goalInput: null,
    levelRadios: null,
    hoursSelect: null,
    errorDisplay: null,
    outlineInfo: null,
    outlineList: null
  };

  // ============================================
  // Initialization
  // ============================================
  function init() {
    cacheElements();
    bindEvents();
  }

  function cacheElements() {
    elements.modal = document.getElementById('learningProjectModal');
    elements.title = document.getElementById('learningModalTitle');
    elements.body = document.getElementById('learningModalBody');
    elements.footer = document.getElementById('learningModalFooter');
    elements.closeBtn = document.getElementById('learningModalClose');
    elements.cancelBtn = document.getElementById('learningModalCancel');
    elements.actionBtn = document.getElementById('learningModalAction');
    elements.stepInput = document.getElementById('learningStepInput');
    elements.stepPlanning = document.getElementById('learningStepPlanning');
    elements.stepOutline = document.getElementById('learningStepOutline');
    elements.goalInput = document.getElementById('learningGoal');
    elements.levelRadios = document.querySelectorAll('input[name="learningLevel"]');
    elements.hoursSelect = document.getElementById('learningHours');
    elements.errorDisplay = document.getElementById('learningError');
    elements.outlineInfo = document.getElementById('learningOutlineInfo');
    elements.outlineList = document.getElementById('learningOutlineList');
  }

  function bindEvents() {
    // Toolbar button - smart toggle: restore panel if in learning mode, else open hub
    const toolbarBtn = document.getElementById('newLearningProjectBtn');
    if (toolbarBtn) {
      toolbarBtn.addEventListener('click', () => {
        if (document.body.classList.contains('learning-mode')) {
          // Already in learning mode - toggle progress panel
          const panel = document.getElementById('learningProgressPanel');
          if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
          }
        } else if (window.LearningHub) {
          window.LearningHub.open();
        } else {
          openDialog();
        }
      });
    }

    // Modal controls
    elements.closeBtn.addEventListener('click', closeDialog);
    elements.cancelBtn.addEventListener('click', closeDialog);
    elements.actionBtn.addEventListener('click', onActionClick);

    // Overlay click does NOT close dialog (prevent accidental close)
    // Only X button and Cancel button can close the dialog

    // Enter key on goal input triggers action
    elements.goalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onActionClick();
    });

    // Clear error on input
    elements.goalInput.addEventListener('input', () => {
      if (dialogState.error) {
        dialogState.error = null;
        showError(null);
      }
    });
  }

  // ============================================
  // Dialog State Machine
  // ============================================
  function openDialog() {
    resetState();
    transitionTo('input');
    elements.modal.style.display = 'flex';
    setTimeout(() => elements.goalInput.focus(), 100);
  }

  function closeDialog() {
    elements.modal.style.display = 'none';
    if (dialogState.step !== 'generating') {
      resetState();
    }
  }

  function resetState() {
    dialogState.step = 'idle';
    dialogState.goal = '';
    dialogState.level = 'intermediate';
    dialogState.hours = 3;
    dialogState.outline = null;
    dialogState.isLoading = false;
    dialogState.error = null;
    dialogState.projectPath = null;

    // Reset form
    elements.goalInput.value = '';
    elements.levelRadios.forEach(r => {
      r.checked = (r.value === 'intermediate');
    });
    elements.hoursSelect.value = '3';
    showError(null);
  }

  function transitionTo(step) {
    dialogState.step = step;

    // Hide all steps
    elements.stepInput.style.display = 'none';
    elements.stepPlanning.style.display = 'none';
    elements.stepOutline.style.display = 'none';

    switch (step) {
      case 'input':
        elements.stepInput.style.display = 'block';
        elements.title.textContent = '新建学习项目';
        elements.actionBtn.textContent = '开始设计';
        elements.actionBtn.disabled = false;
        elements.actionBtn.style.display = 'inline-block';
        elements.cancelBtn.style.display = 'inline-block';
        break;

      case 'planning':
        elements.stepPlanning.style.display = 'block';
        elements.title.textContent = '设计学习路径';
        elements.actionBtn.style.display = 'none';
        elements.cancelBtn.style.display = 'none';
        break;

      case 'outline':
        elements.stepOutline.style.display = 'block';
        elements.title.textContent = '学习路径预览';
        elements.actionBtn.textContent = '开始生成';
        elements.actionBtn.disabled = false;
        elements.actionBtn.style.display = 'inline-block';
        elements.cancelBtn.style.display = 'inline-block';
        elements.cancelBtn.textContent = '重新规划';
        renderOutline();
        break;

      case 'generating':
        closeDialog();
        // Hand off to progress tracker
        if (window.LearningProgress) {
          window.LearningProgress.startGeneration(dialogState.outline, dialogState.projectPath);
        }
        break;
    }
  }

  // ============================================
  // Action Handler
  // ============================================
  async function onActionClick() {
    switch (dialogState.step) {
      case 'input':
        await startPlanning();
        break;
      case 'outline':
        startGeneration();
        break;
    }
  }

  async function startPlanning() {
    // Collect form data
    dialogState.goal = elements.goalInput.value.trim();
    dialogState.level = getSelectedLevel();
    dialogState.hours = parseInt(elements.hoursSelect.value, 10);

    // Validate
    if (!dialogState.goal) {
      showError('请输入学习目标');
      return;
    }
    if (dialogState.goal.length < 3) {
      showError('学习目标至少 3 个字符');
      return;
    }

    transitionTo('planning');

    try {
      // Call Rust backend to plan course
      if (window.__TAURI__) {
        const { invoke } = window.__TAURI__.core;
        console.log('[LearningProject] Calling plan_course...', dialogState.goal, dialogState.level, dialogState.hours);
        const result = await invoke('plan_course', {
          goal: dialogState.goal,
          level: dialogState.level,
          hours: dialogState.hours
        });
        console.log('[LearningProject] plan_course invoke returned:', result);

        // Wait for agent-event with outline
        await waitForOutline();
      } else {
        // Mock for development without Tauri
        console.log('[LearningProject] No Tauri, using mock');
        await mockPlanCourse();
      }
    } catch (err) {
      console.error('[LearningProject] Error:', err);
      handleError(err.message || '生成大纲失败');
    }
  }

  function getSelectedLevel() {
    for (const radio of elements.levelRadios) {
      if (radio.checked) return radio.value;
    }
    return 'intermediate';
  }

  function waitForOutline() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('生成大纲超时，请重试'));
      }, 120000);

      let unlisten = null;

      function onAgentEvent(msg) {
        console.log('[LearningProject] onAgentEvent called, type:', msg?.type, 'data:', msg?.data);
        if (msg.type === 'outline') {
          clearTimeout(timeout);
          if (unlisten) unlisten();
          // Handle nested structure: msg.data may be {outline: {...}} or directly {chapters: [...]}
          dialogState.outline = msg.data.outline || msg.data;
          console.log('[LearningProject] Outline stored, chapters:', dialogState.outline?.chapters?.length, 'transitioning to outline view');
          transitionTo('outline');
          console.log('[LearningProject] transitionTo outline done, step:', dialogState.step);
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          if (unlisten) unlisten();
          reject(new Error(msg.data.message));
        }
      }

      // Use Tauri event system, not DOM events
      if (window.__TAURI__ && window.__TAURI__.event) {
        console.log('[LearningProject] Registering agent-event listener...');
        window.__TAURI__.event.listen('agent-event', (event) => {
          console.log('[LearningProject] Received agent-event:', event.payload?.type);
          onAgentEvent(event.payload);
        }).then(fn => {
          console.log('[LearningProject] Listener registered, unlisten stored');
          unlisten = fn;
        });
      } else {
        reject(new Error('Tauri 不可用'));
      }
    });
  }

  // ============================================
  // Mock for development
  // ============================================
  async function mockPlanCourse() {
    await new Promise(r => setTimeout(r, 1500));

    dialogState.outline = {
      chapters: [
        { title: '为什么学这个', duration_minutes: 10, concepts: ['动机', '应用场景'] },
        { title: '注意力机制的本质', duration_minutes: 25, concepts: ['注意力', '查询键值'] },
        { title: '从 RNN 到 Self-Attention', duration_minutes: 30, concepts: ['RNN', 'Self-Attention', '并行计算'] },
        { title: '多头注意力图解', duration_minutes: 25, concepts: ['多头注意力', 'Q/K/V'] },
        { title: '位置编码', duration_minutes: 20, concepts: ['位置编码', '正弦余弦'] },
        { title: '完整架构一览', duration_minutes: 20, concepts: ['Encoder', 'Decoder'] },
        { title: '动手实现', duration_minutes: 30, concepts: ['PyTorch', '代码实现'] },
        { title: '总结与知识卡片', duration_minutes: 10, concepts: ['复习', '知识卡片'] }
      ],
      total_duration: 170
    };

    transitionTo('outline');
  }

  // ============================================
  // Outline Rendering & Editing
  // ============================================
  function renderOutline() {
    const outline = dialogState.outline;
    console.log('[LearningProject] renderOutline called, outline:', outline ? 'exists' : 'null', 'chapters:', outline?.chapters?.length);
    if (!outline || !outline.chapters) return;

    const totalHours = Math.round(outline.total_duration / 60 * 10) / 10;
    elements.outlineInfo.textContent =
      `${outline.chapters.length} 章 · 预计 ${totalHours} 小时 · ${dialogState.goal}`;

    elements.outlineList.innerHTML = '';
    outline.chapters.forEach((chapter, index) => {
      const item = createOutlineItem(chapter, index);
      elements.outlineList.appendChild(item);
    });
  }

  function createOutlineItem(chapter, index) {
    const div = document.createElement('div');
    div.className = 'learning-outline-item';
    div.dataset.index = index;

    const duration = chapter.duration_minutes;
    const concepts = chapter.concepts ? chapter.concepts.join('、') : '';

    div.innerHTML = `
      <div class="learning-outline-number">${index + 1}</div>
      <div class="learning-outline-content">
        <div class="learning-outline-title">${escapeHtml(chapter.title)}</div>
        <div class="learning-outline-meta">${duration} 分钟 · ${escapeHtml(concepts)}</div>
      </div>
      <div class="learning-outline-actions">
        <button class="learning-outline-btn learning-outline-edit" title="编辑">✏️</button>
        <button class="learning-outline-btn learning-outline-delete" title="删除">🗑️</button>
      </div>
    `;

    // Edit handler
    div.querySelector('.learning-outline-edit').addEventListener('click', () => {
      enableInlineEdit(div, chapter, index);
    });

    // Delete handler
    div.querySelector('.learning-outline-delete').addEventListener('click', () => {
      deleteChapter(index);
    });

    return div;
  }

  function enableInlineEdit(itemEl, chapter, index) {
    const titleEl = itemEl.querySelector('.learning-outline-title');
    const currentTitle = chapter.title;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'learning-inline-edit';
    input.value = currentTitle;

    titleEl.innerHTML = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    function saveEdit() {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        editChapter(index, newTitle);
      } else {
        renderOutline();
      }
    }

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit();
      } else if (e.key === 'Escape') {
        renderOutline();
      }
    });
  }

  function editChapter(index, newTitle) {
    const outline = dialogState.outline;
    const updatedChapters = [...outline.chapters];
    updatedChapters[index] = { ...updatedChapters[index], title: newTitle };
    dialogState.outline = { ...outline, chapters: updatedChapters };
    renderOutline();
  }

  function deleteChapter(index) {
    const outline = dialogState.outline;
    const chapters = outline.chapters.filter((_, i) => i !== index);
    const total_duration = chapters.reduce((sum, c) => sum + (c.duration_minutes || 0), 0);
    dialogState.outline = { ...outline, chapters, total_duration };
    renderOutline();
  }

  // ============================================
  // Generation Start
  // ============================================
  async function startGeneration() {
    dialogState.step = 'generating';

    try {
      // Create project folder via Rust backend
      if (window.__TAURI__) {
        const { invoke } = window.__TAURI__.core;

        // Ask user for save location
        const savePath = await invoke('open_folder_dialog');

        if (!savePath) {
          dialogState.step = 'outline';
          return;
        }

        dialogState.projectPath = savePath;

        // Register in learning hub (file-based persistence) — must await
        if (window.LearningHub) {
          await window.LearningHub.registerProject(
            savePath,
            dialogState.goal,
            dialogState.outline.chapters.length,
            0
          );
        }

        // Create .learning/project.json
        await invoke('create_learning_project', {
          projectPath: savePath,
          outline: dialogState.outline,
          goal: dialogState.goal
        });

        // Show progress panel and start generation
        transitionTo('generating');
      } else {
        // Mock: use temp path
        dialogState.projectPath = '/tmp/learning-project';
        transitionTo('generating');
      }
    } catch (err) {
      console.error('[LearningProject] startGeneration failed:', err);
      handleError(err.message || '启动生成失败');
    }
  }

  // ============================================
  // Error Handling
  // ============================================
  function showError(message) {
    if (!message) {
      elements.errorDisplay.style.display = 'none';
      elements.errorDisplay.textContent = '';
      return;
    }
    elements.errorDisplay.textContent = message;
    elements.errorDisplay.style.display = 'block';
  }

  function handleError(message) {
    dialogState.error = message;
    dialogState.isLoading = false;
    transitionTo('input');
    showError(message);
  }

  // ============================================
  // Utilities
  // ============================================
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // Public API
  // ============================================
  window.LearningProject = {
    open: openDialog,
    close: closeDialog,
    getState: () => ({ ...dialogState }),
    CHAPTER_STATUS
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
