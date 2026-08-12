const { adapter: claudeCode } = require('./claude-code');
const { adapter: codexCli } = require('./codex-cli');
const { adapter: geminiCli } = require('./gemini-cli');
const { adapter: openCode } = require('./opencode');
const { validateAgentAdapter } = require('../sdk');

const adapters = [claudeCode, codexCli, geminiCli, openCode];

function getAgentAdapter(id) {
  return adapters.find((adapter) => adapter.id === id) || null;
}

for (const adapter of adapters) validateAgentAdapter(adapter);

module.exports = { adapters, getAgentAdapter, validateAgentAdapter };
