# Adapter SDK and Conformance

The public CommonJS entry point is `agent-trace-workbench/adapter-sdk.js`. The current Adapter API version is `1.0`.

```js
const {
  createEvent,
  defineAgentAdapter,
  runAgentAdapterConformance,
  assertConformance,
} = require('agent-trace-workbench');

const adapter = defineAgentAdapter({
  id: 'example-agent',
  displayName: 'Example Agent',
  protocols: [],
  classifyRequest() { return 'main'; },
  discoverLocalSessions() { return []; },
  parseHistory(file) { return require('fs').readFileSync(file, 'utf8'); },
  historyToEvents(raw, context) {
    return [createEvent({
      ...context,
      request_id: 'synthetic-request',
      agent: 'example-agent',
      provider: 'example-provider',
      model: 'example-model',
      event_type: 'assistant_message',
      timestamp: '2000-01-01T00:00:00.000Z',
      content: { text: String(raw).trim() },
      source: 'agent-history',
    })];
  },
});

assertConformance(await runAgentAdapterConformance(adapter, {
  fixturePath: '/absolute/path/to/synthetic-session.txt',
  expected: {
    minEvents: 1,
    requiredEventTypes: ['assistant_message'],
    reasoning: 'unavailable',
  },
}));
```

## Agent Adapter contract

An Agent Adapter normalizes an Agent's local history format. It must provide:

| Member | Contract |
|---|---|
| `id` | Stable lowercase identifier using letters, numbers, `.`, `_`, or `-`. |
| `displayName` | Human-readable name. |
| `classifyRequest(record)` | Returns `main`, `side-summary`, `side-title`, or `side-other`. |
| `discoverLocalSessions(options)` | Finds local histories. This is intentionally not run by conformance tests. |
| `parseHistory(file)` | Parses one explicit history fixture or file. |
| `historyToEvents(parsed, context)` | Returns deterministic Trace Schema v1 events. |

`historyToEvents` must preserve the supplied `session_id`. It must not invent unavailable reasoning, signatures, timestamps, tokens, tool calls, or Provider/model identities.

## Protocol Adapter contract

A Protocol Adapter normalizes API responses and SSE streams. It must provide `id`, `displayName`, `detect(firstEvent)`, `parseJSON(input, context)`, and `parseSSE(input, context)`. Both parsers return an object with `content`, `reasoning`, `toolCalls`, `events`, and `apiFormat`.

Use `defineProtocolAdapter` and `runProtocolAdapterConformance` with explicit synthetic JSON/SSE cases. Conformance verifies protocol detection, normalized event fields, expected/forbidden event types, reasoning boundaries, and deterministic repeat parsing.

## Conformance evidence

Run all bundled conformance cases with:

```bash
npm run test:adapters
```

Every compatibility claim must include:

1. an obviously synthetic fixture with no real prompt, credential, username, or private path;
2. a declared observed format/version;
3. expected event types and reasoning/signature availability;
4. deterministic conformance output;
5. an update to `docs/ADAPTER_COMPATIBILITY.md`.

The conformance runner never invokes `discoverLocalSessions`; it only reads the fixture path explicitly supplied by the test. This prevents a compatibility test from scanning a contributor's machine.

## Trust boundary

Adapters are executable JavaScript, not sandboxed data files. Loading an untrusted Adapter can run code with the same filesystem and network permissions as the ATW process. Review Adapter source and dependencies before loading it. The conformance runner checks interface and output behavior; it is not a malware scanner or a security sandbox.

ATW preserves opaque signatures but does not decrypt them. Reasoning may be emitted only when non-empty visible text or deltas are present in the source evidence.
