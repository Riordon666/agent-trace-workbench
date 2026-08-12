# Agent Trace Workbench

面向 Coding Agent 的本地优先轨迹观察、历史回放和诊断工具。

[English README](README.md) · [架构](docs/ARCHITECTURE.md) · [适配器兼容性](docs/ADAPTER_COMPATIBILITY.md) · [Adapter SDK](docs/ADAPTER_SDK.md) · [Trace Diff](docs/TRACE_DIFF.md) · [维护流程](docs/MAINTENANCE.md) · [路线图](ROADMAP.md) · [参与贡献](CONTRIBUTING.md)

## 它解决什么问题

ATW 把模型 API 流量、本地 Agent History、工具调用、Token 用量和诊断信息整理到一个本地 Session 中，用于回答：

- Agent 实际向模型发送了什么？
- 返回了哪些 SSE、工具调用、Usage、Thinking 或 Signature？
- 流式响应是正常结束还是中途截断？
- API 抓包与 Claude Code / Codex CLI 本地历史是否一致？
- 能否导出经过已知凭证脱敏的诊断材料？

ATW 不会推测或生成缺失的思维链。上游未提供、加密或脱敏时，界面明确显示 `unavailable`。

<p align="center">
  <strong>观察 → 回放 → 对比 → 导出</strong><br /><br />
  <img src="https://raw.githubusercontent.com/Riordon666/agent-trace-workbench/main/docs/demo/agent-trace-workbench-demo.gif" alt="Agent Trace Workbench 30 秒演示" width="94%" /><br />
  <sub>演示仅使用本地合成 Session 数据，不包含真实对话内容。</sub>
</p>

## 当前能力

| 层级 | 支持情况 |
|---|---|
| Agent History | Claude Code、Codex CLI；`main` 预览支持 Gemini CLI、OpenCode |
| 实时捕获 | Legacy MITM HTTPS 代理 |
| Anthropic Messages | SSE/JSON、Thinking、Signature、工具、Usage（以上游实际返回为准） |
| OpenAI Responses | 协议适配器和合成夹具测试；实时捕获目前重点是 Anthropic Messages |
| 压缩 | identity、gzip、deflate、br、zstd |
| 查看 | Session Explorer、历史 Playback、Diagnostics |
| Analytics | Token、三态成本、工具统计、请求时间线、服务端事件分页 |
| 导出 | `.atwtrace` v2、标注目录 |

Gemini CLI、OpenCode 历史适配器以及 Session Comparison、Trace Schema v1、`.atwtrace` 导入导出和隐私扫描已在 `main` 上实现，计划在后续版本发布。历史适配不等于实时协议抓包支持；具体证据和边界见[适配器兼容性矩阵](docs/ADAPTER_COMPATIBILITY.md)。

公开的 CommonJS [Adapter SDK](docs/ADAPTER_SDK.md) 提供带版本的 Agent/协议适配器契约和确定性一致性测试。`npm run test:adapters` 只使用合成夹具，以同一套契约验证全部内置适配器。

## 从源码启动

需要 Node.js 20+、npm，以及生成 MITM 证书所需的 OpenSSL。

```bash
git clone https://github.com/Riordon666/agent-trace-workbench.git
cd agent-trace-workbench
npm install
npm run setup
npm run workbench
```

浏览器打开 <http://127.0.0.1:5177/>。

v0.2.0 是首个 Public Preview。源码与 GitHub Release 可用；npm 包只有在 npm registry 页面可查询后才算正式发布。在此之前可通过以下方式本地验证 CLI：

```bash
npm link
atw doctor
atw setup
atw
```

通过 CLI 启动时，可变数据不会写入 npm 安装目录，而是保存到当前用户的数据目录：Windows 为 `%LOCALAPPDATA%\\agent-trace-workbench`，macOS 为 `~/Library/Application Support/agent-trace-workbench`，Linux 为 `$XDG_DATA_HOME/agent-trace-workbench`。可用 `ATW_DATA_DIR` 修改根目录。通过 `npm run workbench` 启动源码仓库时，仍使用仓库内已忽略的运行目录。

## 采集 Claude Code

1. 运行 `atw setup` 生成本地 MITM 证书；
2. 在工作台创建 Session；
3. 启动 Legacy 代理；
4. 开始正式捕获；
5. 使用页面给出的代理与 CA 环境变量启动 Claude Code；
6. 等待在途请求归零后停止捕获；
7. 查看抓包、原始轨迹、Playback 和 Diagnostics。

模型响应字节会原样交给客户端，旁路采集流负责解压和保存 SSE。只有上游实际返回 `thinking_delta` 或 `signature_delta` 时，ATW 才会记录对应内容。

## MITM 安全边界

- 证书和私钥保存在配置的证书目录中（CLI 默认位于用户数据目录，源码模式默认位于 `certs/`），绝不能提交或分享；
- 代理仅应监听本机，并尽量设置 `TARGET_HOST`；
- `TARGET_HOST` 留空时，所有通过该代理访问的 HTTPS Host 都可能被拦截；
- 抓包可能包含源码、Prompt、路径、工具参数、Cookie 和凭证；
- 不再使用时，需要从系统信任库移除证书；仅删除本地证书文件不会撤销系统信任；
- 自动脱敏只能覆盖已知模式，分享前必须人工检查。

参见 [SECURITY.md](SECURITY.md) 和 [docs/PRIVACY.md](docs/PRIVACY.md)。

## CLI

```text
atw [start] [--port <port>] [--no-open]
atw setup
atw doctor
atw export <session-id> [--output <file.atwtrace>]
atw open <file.atwtrace> [--session-id <id>] [--port <port>] [--no-open]
atw diff <baseline.atwtrace> <candidate.atwtrace> [--json] [--fail-on-regression] [--thresholds <file.json>]
atw --version
```

`atw export` 生成不会覆盖已有文件的 `.atwtrace`；`atw open` 会先校验全部条目，Session ID 冲突时导入为新 Session，再启动工作台。`atw diff` 会校验并只读比较两份轨迹，不导入 Session、不执行命令或调用模型；配合 `--fail-on-regression` 可在 CI 检测到回归时返回退出码 2。轨迹包含 manifest、metadata、events、diagnostics、隐私报告、SHA-256 校验和以及可选的脱敏 raw 文件。格式与规则见 [Portable Trace Format](docs/TRACE_FORMAT.md) 和 [Trace Diff](docs/TRACE_DIFF.md)。

## Session Comparison

在 **Session Explorer → Session Comparison** 中选择 A、B 两个 Session，即可查看 `B − A` 的耗时、输入/输出 Token、工具调用、明确观察到的文件读写、失败命令、重试信号、请求与错误差异。

为避免协议抓包与 Agent History 双重计数，每类指标只选择一个规范化数据源，并在结果中显示来源和限制。若 Adapter 没有暴露必要字段，文件和重试计数可能低于真实数量，ATW 不会推测补全。

对比结果同时标记为“等价 / 有变化 / 检测到回归”。错误、失败命令、重试、不完整请求、Reasoning 丢失，以及同时超过绝对值与百分比阈值的耗时增长可以触发回归；Token 或工具数量变化只报告，不会单独判定为回归。

## Session Analytics

在 **Session Explorer → Session Analytics** 中可以查看按模型归属的 Token、工具调用次数/失败/耗时，以及请求时间线。通用事件使用服务端分页，浏览器每页最多渲染 100 条。

成本严格区分三种状态：`observed` 表示上游事件明确提供了数值；`estimated` 表示 Provider、模型和 Token 都能精确匹配本地带日期的标准美元价目表；`unavailable` 表示证据不足。估算不是账单，也不包含批处理/优先级、区域、存储、搜索、工具、媒体、税费、折扣和合同价。可用 `WORKBENCH_PRICING_FILE` 指向人工复核过的本地价目表，详见 [Analytics 与成本语义](docs/ANALYTICS.md)。

## 开发与验证

```bash
npm ci
npm run test:adapters
npm run check
npm pack --dry-run
```

测试只能使用合成数据。禁止提交真实 Session、模型请求、凭证、证书、用户名、本机私有路径或客户资料。

## 已知限制

- 实时捕获依赖客户端、操作系统、代理和证书配置；
- 当前逐 API 调用原始轨迹主要面向 Anthropic 兼容 `/v1/messages`；
- 某些模型只返回加密 Signature，不返回可见 Thinking；
- Playback 是历史事件查看，不是确定性重新执行；
- `.atwtrace` 会扫描已知凭证、Token、Cookie、私钥、用户目录、邮箱和 IP，但人工逐项复核仍是强制要求；
- 事件查看已分页，但生成完整 Analytics 汇总仍会读取规范化事件文件，超大 Session 可能占用较多服务端内存。

代码使用 [MIT License](LICENSE)。第三方素材条款见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
