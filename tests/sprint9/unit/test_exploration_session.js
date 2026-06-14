#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Sprint 9: Exploration Mode
 *
 * Module under test:
 * - dist/scripts/learning/exploration-session.js
 *
 * Business contracts:
 * - One file can have multiple conversations
 * - Persistence uses basename (not full path)
 * - Conversation title defaults to first user message
 * - Relative time formatting for conversation list
 * - Deleting conversation removes persisted record
 */

const TestRunner = require('../../shared/test-runner');

// ============================================
// Helper: in-memory storage adapter
// ============================================

function createMemoryStorage() {
  const store = new Map();
  return {
    read(key) { return store.get(key) || null; },
    write(key, data) { store.set(key, data); },
    remove(key) { store.delete(key); },
    keys() { return Array.from(store.keys()); }
  };
}

function loadSessionModule() {
  const path = require('path');
  const modPath = path.join(__dirname, '../../../dist/scripts/learning/exploration-session.js');
  try {
    delete require.cache[require.resolve(modPath)];
    require(modPath);
  } catch (e) {
    return null;
  }
  return require(modPath);
}

function requireModule() {
  const mod = loadSessionModule();
  TestRunner.assertExists(mod, 'exploration-session.js module should exist');
  return mod;
}

// ============================================
// Test Suite: ExplorationSession basics
// ============================================

TestRunner.test('ExplorationSession uses basename for storage key', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: 'C:\\papers\\transformer.md',
    storage
  });

  TestRunner.assertEquals(session.storageKey, 'transformer.md.json', 'should use basename');
});

TestRunner.test('ExplorationSession creates default conversation on load', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();

  TestRunner.assertEquals(session.getConversations().length, 1, 'should have 1 default conversation');
  TestRunner.assertExists(session.getActiveConversation(), 'should have active conversation');
});

TestRunner.test('ExplorationSession creates multiple conversations', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();

  const id1 = session.getActiveConversation().id;
  const id2 = session.createConversation();

  TestRunner.assertEquals(session.getConversations().length, 2, 'should have 2 conversations');
  TestRunner.assertEquals(session.getActiveConversation().id, id2, 'new conversation should be active');
  TestRunner.assert(id2 !== id1, 'ids should be unique');
});

TestRunner.test('ExplorationSession switches active conversation', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();

  const id1 = session.getActiveConversation().id;
  const id2 = session.createConversation();
  session.setActiveConversation(id1);

  TestRunner.assertEquals(session.getActiveConversation().id, id1, 'should switch back to first');
});

TestRunner.test('ExplorationSession auto-titles from first user message', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();

  session.addMessage('user', '这篇文章的核心观点是什么？');
  const conv = session.getActiveConversation();

  TestRunner.assertEquals(conv.title, '这篇文章的核心观点是什么？', 'title should match first user message');
});

TestRunner.test('ExplorationSession truncates auto-title to 20 chars', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();

  const longMessage = '这是一段非常非常非常非常非常非常长的用户消息';
  session.addMessage('user', longMessage);
  const conv = session.getActiveConversation();

  TestRunner.assertEquals(conv.title.length, 20, 'title should be truncated to 20 chars');
  TestRunner.assert(conv.title.endsWith('…'), 'truncated title should end with ellipsis');
});

TestRunner.test('ExplorationSession preserves explicit title over auto-title', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();

  const conv = session.getActiveConversation();
  session.renameConversation(conv.id, '核心观点讨论');
  session.addMessage('user', '这篇文章的核心观点是什么？');

  TestRunner.assertEquals(conv.title, '核心观点讨论', 'explicit title should be preserved');
});

TestRunner.test('ExplorationSession renames conversation', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();

  const conv = session.getActiveConversation();
  session.renameConversation(conv.id, '新标题');

  TestRunner.assertEquals(session.getActiveConversation().title, '新标题', 'title should be updated');
});

TestRunner.test('ExplorationSession deletes conversation', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();

  const id1 = session.getActiveConversation().id;
  session.createConversation();
  session.deleteConversation(id1);

  TestRunner.assertEquals(session.getConversations().length, 1, 'should have 1 conversation left');
  TestRunner.assert(
    !session.getConversations().some(c => c.id === id1),
    'deleted conversation should not exist'
  );
});

TestRunner.test('ExplorationSession persists to storage', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();
  session.addMessage('user', '什么是 Attention');
  session.save();

  const raw = storage.read('transformer.md.json');
  TestRunner.assertExists(raw, 'should write to storage');

  const data = JSON.parse(raw);
  TestRunner.assertEquals(data.fileName, 'transformer.md', 'should store fileName');
  TestRunner.assertEquals(data.conversations.length, 1, 'should store 1 conversation');
  TestRunner.assertEquals(data.conversations[0].messages.length, 1, 'should store 1 message');
  TestRunner.assertEquals(data.conversations[0].messages[0].role, 'user', 'message role should be user');
});

TestRunner.test('ExplorationSession loads persisted conversations', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  storage.write('transformer.md.json', JSON.stringify({
    fileName: 'transformer.md',
    conversations: [
      {
        id: 'conv-1',
        title: '历史对话',
        createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        messages: [{ role: 'user', content: '什么是 Attention', timestamp: new Date().toISOString() }]
      }
    ],
    activeConversationId: 'conv-1'
  }));

  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();

  TestRunner.assertEquals(session.getConversations().length, 1, 'should load 1 conversation');
  TestRunner.assertEquals(session.getActiveConversation().title, '历史对话', 'should load title');
  TestRunner.assertEquals(session.getActiveConversation().messages[0].content, '什么是 Attention', 'should load messages');
});

TestRunner.test('ExplorationSession removes persisted record when last conversation deleted', () => {
  const mod = requireModule();

  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const session = new ExplorationSession({
    filePath: '/tmp/papers/transformer.md',
    storage
  });
  session.load();
  session.save();

  TestRunner.assertExists(storage.read('transformer.md.json'), 'storage should exist after save');

  const id = session.getActiveConversation().id;
  session.deleteConversation(id);
  session.save();

  TestRunner.assert(
    !storage.read('transformer.md.json'),
    'storage should be removed when no conversations left'
  );
});

// ============================================
// Test Suite: relative time formatting
// ============================================

TestRunner.test('formatRelativeTime returns 刚刚 for current time', () => {
  const mod = requireModule();

  const { formatRelativeTime } = mod;
  TestRunner.assertExists(formatRelativeTime, 'formatRelativeTime should be exported');

  const result = formatRelativeTime(new Date().toISOString());
  TestRunner.assertEquals(result, '刚刚', 'should return 刚刚');
});

TestRunner.test('formatRelativeTime returns minutes ago', () => {
  const mod = requireModule();

  const { formatRelativeTime } = mod;
  TestRunner.assertExists(formatRelativeTime, 'formatRelativeTime should be exported');

  const date = new Date(Date.now() - 5 * 60 * 1000);
  const result = formatRelativeTime(date.toISOString());
  TestRunner.assertEquals(result, '5 分钟前', 'should return 5 分钟前');
});

TestRunner.test('formatRelativeTime returns hours ago', () => {
  const mod = requireModule();

  const { formatRelativeTime } = mod;
  TestRunner.assertExists(formatRelativeTime, 'formatRelativeTime should be exported');

  const date = new Date(Date.now() - 2 * 3600 * 1000);
  const result = formatRelativeTime(date.toISOString());
  TestRunner.assertEquals(result, '2 小时前', 'should return 2 小时前');
});

TestRunner.test('formatRelativeTime returns days ago', () => {
  const mod = requireModule();

  const { formatRelativeTime } = mod;
  TestRunner.assertExists(formatRelativeTime, 'formatRelativeTime should be exported');

  const date = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  const result = formatRelativeTime(date.toISOString());
  TestRunner.assertEquals(result, '3 天前', 'should return 3 天前');
});

// ============================================
// Run
// ============================================

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});

// Sprint 9 PB3: save → close → re-open cycle
TestRunner.test('会话 save-load 闭环：保存后重新加载消息不丢失', async () => {
  const mod = requireModule();

  // Phase 1: create session, add messages, save
  const storage = createMemoryStorage();
  const { ExplorationSession } = mod;
  const sessionA = new ExplorationSession({
    filePath: '/tmp/papers/rnn.md',
    storage
  });
  sessionA.load();
  sessionA.addMessage('user', 'RNN 有什么缺点');
  sessionA.addMessage('assistant', '梯度消失和长程依赖问题');
  await sessionA.save();  // async save must complete before re-open

  // Phase 2: re-open (simulate closing tab and reopening)
  const { ExplorationSession: ES2 } = requireModule();
  const sessionB = new ES2({
    filePath: '/tmp/papers/rnn.md',
    storage
  });
  sessionB.load();

  // Phase 3: verify messages survived the cycle
  TestRunner.assertEquals(sessionB.conversations.length, 1, 'should restore 1 conversation');
  var conv = sessionB.getActiveConversation();
  TestRunner.assertExists(conv, 'active conversation exists');
  TestRunner.assertEquals(conv.messages.length, 2, 'should restore 2 messages');
  TestRunner.assertEquals(conv.messages[0].role, 'user', 'msg 1 role');
  TestRunner.assertEquals(conv.messages[0].content, 'RNN 有什么缺点', 'msg 1 content');
  TestRunner.assertEquals(conv.messages[1].role, 'assistant', 'msg 2 role');
  TestRunner.assertEquals(conv.messages[1].content, '梯度消失和长程依赖问题', 'msg 2 content');
});
