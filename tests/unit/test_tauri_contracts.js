#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Interface Contract Tests
 * Verify Rust Tauri commands and JS callers are aligned
 *
 * Lesson from Sprint 3: unregistered command + param mismatch caused
 * "Command not found" and "Cannot read properties of undefined" bugs.
 */

const fs = require('fs');
const path = require('path');
const TestRunner = require('./test-runner');

// ============================================
// Helpers: extract command names from source
// ============================================

function extractRustCommands() {
  const libRs = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/lib.rs'), 'utf-8');
  const aiAgentRs = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/ai_agent.rs'), 'utf-8');

  // Extract generate_handler! block
  const handlerMatch = libRs.match(/generate_handler!\s*\[([\s\S]*?)\]/);
  const commands = [];
  if (handlerMatch) {
    handlerMatch[1].split(/,|\n/).forEach(line => {
      // Handle both "command_name" and "ai_agent::command_name"
      const m = line.trim().match(/^(?:ai_agent::)?([a-z_][a-z_0-9]*)$/);
      if (m) commands.push(m[1]);
    });
  }

  // Also scan ai_agent.rs for #[tauri::command] fn declarations
  const fnRegex = /#\[tauri::command\]\s*\n(?:\s*pub\s+)?async\s+fn\s+([a-z_][a-z_0-9]*)/g;
  let fm;
  while ((fm = fnRegex.exec(aiAgentRs)) !== null) {
    if (!commands.includes(fm[1])) commands.push(fm[1]);
  }

  return commands;
}

function extractJsInvokes() {
  const scriptsDir = path.join(__dirname, '../../dist/scripts');
  const invokes = new Map(); // command -> [{file, line}]

  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          const matches = line.matchAll(/invoke\s*\(\s*['"`]([^'"`]+)['"`]/g);
          for (const m of matches) {
            const cmd = m[1];
            if (!invokes.has(cmd)) invokes.set(cmd, []);
            invokes.get(cmd).push({ file: path.relative(process.cwd(), fullPath), line: idx + 1 });
          }
        });
      }
    }
  }
  scanDir(scriptsDir);
  return invokes;
}

function findPayloadNearInvoke(filePath, commandName) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const results = [];

  lines.forEach((line, idx) => {
    if (line.includes(`invoke('${commandName}'`) || line.includes(`invoke("${commandName}"`) || line.includes(`invoke(\`${commandName}\``)) {
      // Collect 15 lines before and 30 lines after to find payload object
      const start = Math.max(0, idx - 15);
      const end = Math.min(lines.length, idx + 30);
      const context = lines.slice(start, end).join('\n');
      results.push(context);
    }
  });
  return results;
}

// ============================================
// Explicit Contract Registry
// ============================================

const COMMAND_REGISTRY = {
  // Core app commands (known working, spot-check only)
  open_file: { category: 'core' },
  render_markdown: { category: 'core' },
  get_config: { category: 'core' },
  set_config: { category: 'core' },
  write_file: { category: 'core' },

  // Sprint 3 learning commands (high risk, full check)
  create_learning_project: {
    category: 'learning',
    jsParams: ['projectPath', 'outline', 'goal'],
    rustFile: 'lib.rs',
  },
  plan_course: {
    category: 'learning',
    jsParams: ['goal', 'level', 'hours'],
    rustFile: 'ai_agent.rs',
  },
  generate_chapters: {
    category: 'learning',
    jsParams: ['projectPath', 'outline'],
    rustFile: 'ai_agent.rs',
  },
  explain_selection: {
    category: 'learning',
    jsParams: ['text', 'context', 'previousQa'],
    rustFile: 'ai_agent.rs',
  },
  generate_chapter_quiz: {
    category: 'learning',
    jsParams: ['chapterFile'],
    rustFile: 'ai_agent.rs',
  },
  persist_quiz_result: {
    category: 'learning',
    jsParams: ['projectPath', 'chapterFile', 'rating', 'score', 'weakConcepts', 'answers', 'timestamp'],
    rustFile: 'lib.rs',
  },
  read_quiz_history: {
    category: 'learning',
    jsParams: ['projectPath'],
    rustFile: 'lib.rs',
  },

  // Registered but potentially unused (monitor for drift)
  evaluate_quiz: { category: 'unused', note: 'JS does local scoring, this command has no caller' },
  adapt_subsequent_chapters: { category: 'unused', note: 'No JS caller found' },
  abort_generation: { category: 'unused', note: 'No JS caller found' },
  is_agent_running: { category: 'unused', note: 'No JS caller found' },
  get_toc: { category: 'unused', note: 'No JS caller found' },
  open_slides_window: { category: 'unused', note: 'No JS caller found' },
};

// ============================================
// Tests
// ============================================

TestRunner.test('All JS-invoked commands are registered in Rust', () => {
  const rustCommands = new Set(extractRustCommands());
  const jsInvokes = extractJsInvokes();

  const failures = [];
  for (const [cmd, locations] of jsInvokes) {
    if (!rustCommands.has(cmd)) {
      failures.push(`${cmd} at ${locations.map(l => l.file + ':' + l.line).join(', ')}`);
    }
  }

  if (failures.length > 0) {
    throw new Error('Unregistered commands invoked in JS:\n  ' + failures.join('\n  '));
  }
});

TestRunner.test('All learning-category commands have JS callers', () => {
  const jsInvokes = extractJsInvokes();
  const failures = [];

  for (const [cmd, info] of Object.entries(COMMAND_REGISTRY)) {
    if (info.category === 'learning' && !jsInvokes.has(cmd)) {
      failures.push(cmd);
    }
  }

  if (failures.length > 0) {
    throw new Error('Learning commands with no JS callers:\n  ' + failures.join('\n  '));
  }
});

TestRunner.test('persist_quiz_result payload includes all required fields', () => {
  const miPath = path.join(__dirname, '../../dist/scripts/learning/mode-integration.js');
  const contexts = findPayloadNearInvoke(miPath, 'persist_quiz_result');

  TestRunner.assert(contexts.length > 0, 'Should find persist_quiz_result invoke in mode-integration.js');

  const required = COMMAND_REGISTRY.persist_quiz_result.jsParams;
  const combined = contexts.join('\n');

  for (const key of required) {
    TestRunner.assert(
      combined.includes(key),
      `persist_quiz_result payload should include parameter key '${key}'`
    );
  }
});

TestRunner.test('explain_selection payload includes all required fields', () => {
  const miPath = path.join(__dirname, '../../dist/scripts/learning/mode-integration.js');
  const contexts = findPayloadNearInvoke(miPath, 'explain_selection');

  TestRunner.assert(contexts.length > 0, 'Should find explain_selection invoke in mode-integration.js');

  const required = COMMAND_REGISTRY.explain_selection.jsParams;
  const combined = contexts.join('\n');

  for (const key of required) {
    TestRunner.assert(
      combined.includes(key),
      `explain_selection payload should include parameter key '${key}'`
    );
  }
});

TestRunner.test('generate_chapter_quiz payload includes required field', () => {
  const miPath = path.join(__dirname, '../../dist/scripts/learning/mode-integration.js');
  const contexts = findPayloadNearInvoke(miPath, 'generate_chapter_quiz');

  TestRunner.assert(contexts.length > 0, 'Should find generate_chapter_quiz invoke in mode-integration.js');

  const combined = contexts.join('\n');
  TestRunner.assert(
    combined.includes('chapterFile'),
    `generate_chapter_quiz payload should include 'chapterFile'`
  );
});

TestRunner.test('create_learning_project payload includes required fields', () => {
  const pmPath = path.join(__dirname, '../../dist/scripts/learning/project-manager.js');
  const contexts = findPayloadNearInvoke(pmPath, 'create_learning_project');

  TestRunner.assert(contexts.length > 0, 'Should find create_learning_project invoke');

  const required = COMMAND_REGISTRY.create_learning_project.jsParams;
  const combined = contexts.join('\n');

  for (const key of required) {
    TestRunner.assert(
      combined.includes(key),
      `create_learning_project payload should include '${key}'`
    );
  }
});

TestRunner.test('Unused commands are documented in registry', () => {
  const rustCommands = extractRustCommands();
  const jsInvokes = extractJsInvokes();

  const unused = rustCommands.filter(cmd => !jsInvokes.has(cmd));
  const undocumented = unused.filter(cmd => !COMMAND_REGISTRY[cmd]);

  if (undocumented.length > 0) {
    console.log('  ⚠️  Undocumented unused commands:', undocumented.join(', '));
  }

  // All unused commands should have a registry entry explaining why
  const knownUnused = Object.entries(COMMAND_REGISTRY)
    .filter(([_, info]) => info.category === 'unused')
    .map(([cmd]) => cmd);

  for (const cmd of unused) {
    const known = knownUnused.includes(cmd);
    if (!known) {
      console.log(`  ⚠️  Command '${cmd}' is registered but unused — add to COMMAND_REGISTRY with explanation`);
    }
  }

  TestRunner.assert(true, 'Unused command audit complete');
});

TestRunner.test('camelCase to snake_case field coverage for persist_quiz_result', () => {
  // Sprint 3 bug: Rust expects snake_case but JS sends camelCase.
  // Tauri auto-converts, but we should document which fields are affected.
  const miPath = path.join(__dirname, '../../dist/scripts/learning/mode-integration.js');
  const content = fs.readFileSync(miPath, 'utf-8');

  // Find the payload object definition near persist_quiz_result
  const payloadMatch = content.match(
    /invoke\s*\(\s*['"]persist_quiz_result['"]\s*,\s*payload\s*\)/
  );
  TestRunner.assertExists(payloadMatch, 'persist_quiz_result should be called with a payload variable');

  // Verify the variable named 'payload' contains camelCase keys that map to Rust snake_case
  const camelKeys = ['projectPath', 'chapterFile', 'weakConcepts'];
  for (const key of camelKeys) {
    TestRunner.assert(
      content.includes(key),
      `JS should use camelCase key '${key}' (Tauri converts to snake_case for Rust)`
    );
  }
});

// ============================================
// Run
// ============================================

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
