/**
 * TDD Tests for Agent Init decision functions (agent-init.js)
 * 初始化（一次性引导）与使用期检测的状态机
 */

const TestRunner = require('../../shared/test-runner');
const AgentInit = require('../../../dist/scripts/agent-init');

TestRunner.test('decideStartupAction: SDK 就绪 → mark-init-done（静默初始化）', () => {
  TestRunner.assertEquals(
    AgentInit.decideStartupAction({ sdkFound: true, initDone: false, dismissed: false }),
    'mark-init-done'
  );
});

TestRunner.test('decideStartupAction: 首次缺失且未忽略 → show-init-toast', () => {
  TestRunner.assertEquals(
    AgentInit.decideStartupAction({ sdkFound: false, initDone: false, dismissed: false }),
    'show-init-toast'
  );
});

TestRunner.test('decideStartupAction: 已初始化缺失 → none（使用期不自动弹引导）', () => {
  TestRunner.assertEquals(
    AgentInit.decideStartupAction({ sdkFound: false, initDone: true, dismissed: false }),
    'none'
  );
});

TestRunner.test('decideStartupAction: 已点不再提示 → none', () => {
  TestRunner.assertEquals(
    AgentInit.decideStartupAction({ sdkFound: false, initDone: false, dismissed: true }),
    'none'
  );
});

TestRunner.test('decideStartupAction: SDK 就绪且已忽略 → 仍 mark-init-done（就绪优先）', () => {
  TestRunner.assertEquals(
    AgentInit.decideStartupAction({ sdkFound: true, initDone: true, dismissed: true }),
    'mark-init-done'
  );
});

TestRunner.test('shouldPromptMissingApiKey: 无 key 且未提示过 → true', () => {
  TestRunner.assertEquals(AgentInit.shouldPromptMissingApiKey({ hasKey: false, prompted: false }), true);
});

TestRunner.test('shouldPromptMissingApiKey: 有 key → false', () => {
  TestRunner.assertEquals(AgentInit.shouldPromptMissingApiKey({ hasKey: true, prompted: false }), false);
});

TestRunner.test('shouldPromptMissingApiKey: 已提示过 → false（一次性）', () => {
  TestRunner.assertEquals(AgentInit.shouldPromptMissingApiKey({ hasKey: false, prompted: true }), false);
});

TestRunner.run();
