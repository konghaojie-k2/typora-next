/**
 * TDD Tests for Agent Bridge — explain stage
 * Tests explainText core logic (mockable, no real Agent SDK)
 *
 * Module: agent-bridge.js
 */

const T = require('../../unit/test-runner');

// Load module under test (require the bridge file)
const bridge = require('../../../agent-bridge');

// ============================================
// explainText Tests
// ============================================

T.test('explainText: 构造正确的解释请求 prompt', async () => {
  const mockQueryFn = (params) => {
    // Return a mock async iterable stream
    return (async function* () {
      yield { type: 'assistant', content: '这是一个生活化类比解释。' };
      yield { type: 'result', subtype: 'success', result: '这是一个生活化类比解释。' };
    })();
  };

  const result = await bridge.explainText(mockQueryFn, {}, {
    text: '梯度消失',
    context: '神经网络反向传播',
    maxLength: 300
  });

  T.assertEquals(result, '这是一个生活化类比解释。', 'returns explanation text');
});

T.test('explainText: 空文本返回错误', async () => {
  const mockQueryFn = () => (async function* () {})();

  try {
    await bridge.explainText(mockQueryFn, {}, { text: '', context: '', maxLength: 300 });
    throw new Error('Should have thrown');
  } catch (e) {
    T.assert(e.message.includes('empty') || e.message.includes('空'), 'throws on empty text');
  }
});

T.test('explainText: 超长文本截断到 maxLength', async () => {
  const mockQueryFn = (params) => {
    return (async function* () {
      // Verify the prompt contains truncated text
      const prompt = params.prompt;
      T.assert(prompt.includes('a'.repeat(50)), 'prompt contains truncated text');
      yield { type: 'result', subtype: 'success', result: '解释已生成。' };
    })();
  };

  const result = await bridge.explainText(mockQueryFn, {}, {
    text: 'a'.repeat(500),
    context: '测试上下文',
    maxLength: 50
  });

  T.assertEquals(result, '解释已生成。', 'returns explanation with truncation');
});

module.exports = T;
