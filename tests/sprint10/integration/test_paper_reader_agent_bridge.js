#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Integration Test: Paper Reader stage of agent-bridge.js
 *
 * Verifies the end-to-end bridge contract:
 *  - paper-reader stage accepts paper_file, output_file, persona, session_id
 *  - emits status/progress events on stdout
 *  - skill writes a valid guide JSON to output_file
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const TestRunner = require('../../shared/test-runner');
const { generatePaperReaderGuide } = require('../../../agent-bridge');

function captureEvents(fn) {
  const events = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    const line = typeof chunk === 'string' ? chunk : chunk.toString();
    for (const l of line.split('\n').filter(Boolean)) {
      try {
        events.push(JSON.parse(l.trim()));
      } catch (e) {}
    }
    return true;
  };

  return fn().then(() => {
    process.stdout.write = originalWrite;
    return events;
  }).catch(e => {
    process.stdout.write = originalWrite;
    throw e;
  });
}

const mockSDK = {
  query: ({ prompt, options }) => {
    // Extract output_file from the prompt so we can simulate the skill Write
    const outputMatch = prompt.match(/output_file:\s*(".*?")/);
    const outputFile = outputMatch ? JSON.parse(outputMatch[1]) : null;

    return {
      async *[Symbol.asyncIterator]() {
        if (outputFile) {
          fs.writeFileSync(outputFile, JSON.stringify({
            title: 'Auto-Encoding Variational Bayes',
            authors: 'Diederik P. Kingma, Max Welling',
            source_file: 'C:\\\\papers\\\\vae.md',
            generated_at: '2026-07-03T10:00:00',
            persona_level: 'beginner',
            reading_order: [{ step: 1, section_id: 'sec_abstract', title: 'Abstract', goal: '核心问题', skip: false }],
            sections: [{
              id: 'sec_abstract',
              title: 'Abstract',
              level: 2,
              order: 1,
              goal: '核心问题',
              skip: false,
              key_points: [{
                id: 'kp_1',
                highlight_text: 'intractable posterior distributions',
                term_level: 'must_know',
                human_explanation: '真实后验算不出来。',
                analogy: '算不出来的后验'
              }],
              check_questions: ['为什么后验分布是 intractable 的？']
            }],
            summary_check_questions: ['VAE 解决的核心问题是什么？']
          }));
        }
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'guide written' }] } };
        yield { type: 'result', subtype: 'success', result: 'OK' };
      }
    };
  }
};

TestRunner.test('Integration: paper-reader stage writes a valid guide JSON', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-paper-reader-'));
  const paperFile = path.join(tmpDir, 'vae.md');
  const outputFile = path.join(tmpDir, 'guide.json');

  fs.writeFileSync(paperFile, '# Auto-Encoding Variational Bayes\n\n## Abstract\nWe introduce a stochastic variational inference algorithm.\n');

  const events = await captureEvents(() =>
    generatePaperReaderGuide(mockSDK.query, {}, {
      paper_file: paperFile,
      output_file: outputFile,
      persona: { level: 'beginner', background: ['neural_network_basics'] },
      session_id: 'test-session'
    })
  );

  const statusEvent = events.find(e => e.type === 'status');
  TestRunner.assertExists(statusEvent, 'Should emit status event');

  const completeEvent = events.find(e => e.type === 'complete');
  TestRunner.assertExists(completeEvent, 'Should emit complete event');
  TestRunner.assertExists(completeEvent.data.output_file, 'complete event should include output_file');

  TestRunner.assert(fs.existsSync(outputFile), 'Guide output file should exist');
  const guide = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
  TestRunner.assertExists(guide.title, 'Guide should have title');
  TestRunner.assertExists(guide.reading_order, 'Guide should have reading_order');
  TestRunner.assert(Array.isArray(guide.sections), 'Guide sections should be an array');
  TestRunner.assert(guide.sections.length > 0, 'Guide should have at least one section');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

TestRunner.test('Integration: paper-reader stage handles missing paper_file gracefully', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-paper-reader-missing-'));
  const outputFile = path.join(tmpDir, 'guide.json');

  let threw = false;
  try {
    await generatePaperReaderGuide(mockSDK.query, {}, {
      paper_file: path.join(tmpDir, 'nonexistent.md'),
      output_file: outputFile,
      persona: { level: 'beginner' }
    });
  } catch (e) {
    threw = true;
  }

  TestRunner.assert(threw, 'Should throw when paper_file does not exist');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

console.log('Running Paper Reader Integration Tests...\n');
TestRunner.run();
