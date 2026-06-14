/**
 * Exploration Session
 *
 * Data layer for exploration mode (自由阅读 / AI 对话式深度阅读).
 *
 * Responsibilities:
 * - Manage multiple conversations per Markdown file
 * - Auto-title from first user message
 * - Persist using basename (not full path) to avoid illegal Windows paths
 * - Relative time formatting for conversation list
 *
 * Storage adapter interface:
 *   read(key) -> string | null
 *   write(key, data)
 *   remove(key)
 */

(function() {
  'use strict';

  // Node.js compatibility
  if (typeof window === 'undefined') {
    global.window = {};
  }

  const MAX_TITLE_LENGTH = 20;
  const STORAGE_VERSION = '1.0';

  // ============================================
  // Helpers
  // ============================================

  function generateId() {
    return 'conv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function getBasename(filePath) {
    if (!filePath) return 'untitled';
    // Normalize slashes and use last segment
    const normalized = String(filePath).replace(/\\/g, '/');
    const last = normalized.split('/').pop();
    return last || 'untitled';
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function truncateTitle(text) {
    if (!text) return '新对话';
    if (text.length <= MAX_TITLE_LENGTH) return text;
    return text.slice(0, MAX_TITLE_LENGTH - 1) + '…';
  }

  function formatRelativeTime(isoDate) {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return '未知时间';

    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return '刚刚';

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + ' 分钟前';

    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return diffHour + ' 小时前';

    const diffDay = Math.floor(diffHour / 24);
    return diffDay + ' 天前';
  }

  // ============================================
  // ExplorationSession
  // ============================================

  class ExplorationSession {
    constructor(options) {
      options = options || {};
      this.filePath = options.filePath || '';
      this.storage = options.storage || null;

      const basename = getBasename(this.filePath);
      this.storageKey = basename + '.json';
      this.fileName = basename;

      this.conversations = [];
      this.activeConversationId = null;
    }

    async load() {
      if (!this.storage) return;

      // storage.read() may be sync (localStorage/memory) or async (Tauri invoke)
      var raw = this.storage.read(this.storageKey);
      if (raw && typeof raw.then === 'function') {
        raw = await raw;
      }

      if (raw) {
        try {
          const data = JSON.parse(raw);
          if (data && Array.isArray(data.conversations)) {
            this.conversations = data.conversations.map(c => ({
              id: c.id || generateId(),
              title: c.title || '新对话',
              createdAt: c.createdAt || nowISO(),
              messages: Array.isArray(c.messages) ? c.messages : []
            }));
            this.activeConversationId = data.activeConversationId || null;
          }
        } catch (e) {
          console.warn('[ExplorationSession] Failed to load persisted data:', e);
          this.conversations = [];
          this.activeConversationId = null;
        }
      }

      // Ensure at least one default conversation
      if (this.conversations.length === 0) {
        this.createConversation();
      }

      // Ensure active conversation is valid
      if (!this.activeConversationId || !this.conversations.some(c => c.id === this.activeConversationId)) {
        this.activeConversationId = this.conversations[0].id;
      }
    }

    async save() {
      if (!this.storage) return;

      if (this.conversations.length === 0) {
        await this.storage.remove(this.storageKey);
        return;
      }

      const data = {
        version: STORAGE_VERSION,
        fileName: this.fileName,
        filePath: this.filePath,
        activeConversationId: this.activeConversationId,
        conversations: this.conversations
      };

      await this.storage.write(this.storageKey, JSON.stringify(data, null, 2));
    }

    getConversations() {
      return this.conversations.slice();
    }

    getActiveConversation() {
      return this.conversations.find(c => c.id === this.activeConversationId) || null;
    }

    setActiveConversation(id) {
      if (this.conversations.some(c => c.id === id)) {
        this.activeConversationId = id;
      }
    }

    createConversation() {
      const conversation = {
        id: generateId(),
        title: '新对话',
        createdAt: nowISO(),
        messages: []
      };
      this.conversations.push(conversation);
      this.activeConversationId = conversation.id;
      return conversation.id;
    }

    addMessage(role, content) {
      const conversation = this.getActiveConversation();
      if (!conversation) return null;

      const message = {
        role,
        content: String(content || ''),
        timestamp: nowISO()
      };
      conversation.messages.push(message);

      // Auto-title from first user message if title is still default
      if (
        role === 'user' &&
        (conversation.title === '新对话' || !conversation.title)
      ) {
        conversation.title = truncateTitle(message.content);
      }

      return message;
    }

    renameConversation(id, title) {
      const conversation = this.conversations.find(c => c.id === id);
      if (conversation) {
        conversation.title = String(title || '');
      }
    }

    deleteConversation(id) {
      const index = this.conversations.findIndex(c => c.id === id);
      if (index === -1) return;

      this.conversations.splice(index, 1);

      if (this.activeConversationId === id) {
        this.activeConversationId = this.conversations.length > 0
          ? this.conversations[0].id
          : null;
      }
    }
  }

  // ============================================
  // Exports
  // ============================================

  window.ExplorationSession = ExplorationSession;
  window.formatRelativeTime = formatRelativeTime;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ExplorationSession,
      formatRelativeTime
    };
  }
})();
