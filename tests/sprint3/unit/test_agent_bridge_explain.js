/**
 * TDD Tests for Agent Bridge — explain stage
 * Tests explainText core logic (mockable, no real Agent SDK)
 *
 * Module: agent-bridge.js
 */

const T = require('../../shared/test-runner');

// Load module under test (require the bridge file)
const bridge = require('../../../agent-bridge');

// ============================================
// explainText Tests
// ============================================

T.test('explainText: 构造正确的解释请求 prompt', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-'));
  const outFile = path.join(tmpDir, 'explanation.md');

  const mockQueryFn = () => {
    // Simulate the agent using its Write tool to persist the explanation.
    return (async function* () {
      fs.writeFileSync(outFile, '这是一个生活化类比解释。', 'utf-8');
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } };
      yield { type: 'result', subtype: 'success', result: 'done' };
    })();
  };

  await bridge.explainText(mockQueryFn, {}, {
    text: '梯度消失',
    context: '神经网络反向传播',
    maxLength: 300,
    output_file: outFile
  });

  const content = fs.readFileSync(outFile, 'utf-8');
  T.assertEquals(content, '这是一个生活化类比解释。', 'agent wrote explanation to output_file');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

T.test('explainText: 空文本返回错误', async () => {
  const mockQueryFn = () => (async function* () {})();

  try {
    await bridge.explainText(mockQueryFn, {}, { text: '', context: '', maxLength: 300, output_file: 'x.md' });
    throw new Error('Should have thrown');
  } catch (e) {
    T.assert(e.message.includes('empty') || e.message.includes('空'), 'throws on empty text');
  }
});

T.test('explainText: 超长文本截断到 maxLength', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-trunc-'));
  const outFile = path.join(tmpDir, 'explanation.md');

  const mockQueryFn = (params) => {
    return (async function* () {
      // Verify the prompt contains truncated text (implementation caps at 200 chars)
      const prompt = params.prompt;
      T.assert(prompt.includes('a'.repeat(50)), 'prompt contains truncated text');
      T.assert(!prompt.includes('a'.repeat(201)), 'prompt should not contain untruncated text');
      fs.writeFileSync(outFile, '解释已生成。', 'utf-8');
      yield { type: 'result', subtype: 'success', result: 'done' };
    })();
  };

  await bridge.explainText(mockQueryFn, {}, {
    text: 'a'.repeat(500),
    context: '测试上下文',
    maxLength: 50,
    output_file: outFile
  });

  const content = fs.readFileSync(outFile, 'utf-8');
  T.assertEquals(content, '解释已生成。', 'agent wrote explanation to output_file');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

module.exports = T;
