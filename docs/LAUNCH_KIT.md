# Launch Kit

This kit contains factual, reusable copy for the first public launch. Update the version and installation status immediately before posting.

## Launch gate

Do not advertise `npm install -g agent-trace-workbench` until the package is visible on the public npm registry and a clean-machine install has passed. Until then, use the source-install commands from the README and say that npm publication is pending.

Before posting:

- confirm `main` CI is green on Windows, macOS, and Linux;
- confirm the linked GitHub Release and checksums exist;
- verify the README Demo loads without authentication;
- run `npm view agent-trace-workbench version` after publication;
- run one clean global install and `atw doctor`;
- review the Demo, screenshots, and trace examples for private data;
- replace preview/support wording only when its evidence level has changed.

## Demo

- Animated walkthrough: [`docs/demo/agent-trace-workbench-demo.gif`](demo/agent-trace-workbench-demo.gif)
- Duration: 30 seconds
- Data: synthetic Gemini CLI and OpenCode fixtures only
- Story: Observe → Explore → Compare → Replay/Diagnose

The four source frames are kept beside the GIF. Rebuild it on Windows with:

```powershell
py scripts/build-demo.py
```

## One-line description

Agent Trace Workbench is local-first DevTools for observing, replaying, comparing, and exporting coding-agent sessions without inventing missing reasoning.

## Show HN

**Title**

```text
Show HN: Agent Trace Workbench – local-first DevTools for coding-agent sessions
```

**Opening**

```text
I wanted something closer to browser DevTools for debugging coding agents: the actual model traffic, local agent history, tool calls, token usage, failures, and replay context in one local Session.

Agent Trace Workbench runs on localhost with no required account or telemetry. It can import supported local histories, preserve reasoning/signature fields only when the source actually contains them, compare two Sessions without double-counting duplicate sources, and export a checksummed .atwtrace with a privacy report that still requires manual review.

The linked 30-second demo uses synthetic data. I would especially value reports from Windows/macOS/Linux users and sanitized compatibility samples for upstream CLI format changes.
```

## Reddit / developer community

**Title**

```text
I built local-first DevTools for debugging Codex, Claude Code, Gemini CLI, and OpenCode sessions
```

**Body outline**

1. Problem: agent failures are spread across API streams, terminal output, local histories, and tool results.
2. Demonstration: show one failed tool call in Replay, then compare two Sessions.
3. Boundaries: historical replay is not deterministic re-execution; unavailable reasoning stays unavailable; live capture support is narrower than history import support.
4. Reproduction: provide source install steps or the verified npm command after publication.
5. Ask: request platform reports, sanitized fixture samples, and issue reports with `atw doctor` output.

## X / short post

```text
I wanted Chrome DevTools for coding agents, so I built Agent Trace Workbench: local Sessions for model traffic, agent history, tool calls, replay, evidence-based comparison, and checksummed trace export. No account, no telemetry, and no invented chain-of-thought. [demo] [repo]
```

## 中文社区

**标题**

```text
我做了一个本地优先的 Coding Agent 调试工作台：观察、回放、对比和导出完整轨迹
```

**正文开头**

```text
Coding Agent 出错时，模型流、Agent 本地历史、工具结果和终端输出往往散落在不同位置。Agent Trace Workbench 把这些已观察到的证据整理进一个本地 Session，用于定位失败请求、查看工具调用、回放历史、比较两个 Session，并导出带校验和与隐私报告的轨迹。

项目不要求账号、不上传遥测，也不会补写缺失的思维链。演示使用合成数据；希望收集 Windows/macOS/Linux 的安装反馈、脱敏后的兼容性样例和真实 Issue。
```

## Claims to avoid

- Do not call historical playback deterministic re-execution.
- Do not claim a trace is safe merely because the scanner found no known pattern.
- Do not claim Gemini CLI/OpenCode live network capture based on their history adapters.
- Do not imply hidden chain-of-thought can be recovered from an encrypted signature.
- Do not describe npm installation as available before registry verification.
- Do not manufacture adoption numbers, testimonials, issues, contributors, or compatibility evidence.
