# dsh-antigravity

<!-- Bump the first badge with the @deepseek-ai/dsh-subagent peer range. -->
[![DeepSeek Harness ≥ 0.2.2-rc.1](https://img.shields.io/badge/DeepSeek_Harness-%E2%89%A5%200.2.2--rc.1-5b6ee1)](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)
[![CI](https://github.com/Preference-cmd/dsh-antigravity/actions/workflows/ci.yml/badge.svg)](https://github.com/Preference-cmd/dsh-antigravity/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/github/license/Preference-cmd/dsh-antigravity)](./LICENSE)

<!-- 最近一次验证的 DeepSeek Harness 版本。 -->
最近一次验证：DeepSeek Harness 0.2.2-rc.1，`agy` 1.5.5。

面向 DeepSeek Harness 的 Antigravity 子智能体插件：模型通过 `subagent_antigravity` 工具把任务委派给本机的 Google Antigravity（`agy`）。子智能体在独立进程里跑完整的一轮，只把最终答案交回父会话——工具调用过程不进入父会话上下文。

## 安装

前置：本机已安装 `agy` 并完成 Google 登录。用 `agy models` 确认能列出模型（未登录时该命令会明确报错）。

```sh
dsh plugin --profile web add github:Preference-cmd/dsh-antigravity
```

装完重启该 profile。

本地目录安装与反复改动：

```sh
# 普通本地安装
dsh plugin --profile web add file:/absolute/path/to/plugins/dsh-antigravity

# 改代码时用 link: 更省事——但 pnpm 不会为链接目录安装它自己的依赖
dsh plugin --profile web add link:/absolute/path/to/plugins/dsh-antigravity
```

## 它做了什么

插件自带 provider，不依赖 `@deepseek-ai/dsh-subagent-acp`：每次委派 spawn 一个 `agy` print 模式子进程（`--output-format stream-json`），把答案折叠成一次子智能体结果后回收进程。

- **`subagent-antigravity`**（宿主侧）注册 `antigravity` provider，并同时提供下面那张状态卡的路由。
- **`subagent_antigravity`**（工具）：模型可见的委派工具。`maxDepth: provider-managed`——递归预算归子智能体自己的运行时管。
- **状态卡**（浏览器侧）：在插件详情页底部画 Google 登录状态、按模型族分组的用量限额条、G1 额度，以及手动刷新。

子智能体有自己的模型、推理档位、工具与配额，与父会话使用的模型无关；两者只共享工作目录。

状态卡的数据全部来自零 token 的斜杠命令（`agy models`、`/usage`、`/credits`）：宿主用一条已鉴权的 `GET /api/antigravity/status` 暴露它们，缓存 60 秒。没有浏览器面的 profile（headless）不会挂载这一半。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: subagent-antigravity
  config:
    # 默认取 $AGY_BIN，否则 ~/.local/bin/agy
    command: /Users/you/.local/bin/agy
    # 固定模型与推理档位；省略则用账号自己的默认
    model: claude-opus-4-6-thinking
    effort: high
    mode: auto

- id: tool-subagent-antigravity
  config:
    toolName: subagent_antigravity
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `command` | `$AGY_BIN` 或 `~/.local/bin/agy` | `agy` 可执行文件；不在 `PATH` 上时用它 |
| `model` | 账号默认 | 固定给每次委派的模型 id，即 `--model` |
| `effort` | 模型默认 | 推理档位 `--effort`：`low`、`medium`、`high`、`xhigh`、`max` |
| `mode` | `agy` 默认 | 执行模式 `--mode`：`accept-edits`、`auto`、`plan` |
| `args` | `[]` | 追加到上述 flag 之后、prompt 之前的其它 `agy` flag |
| `env` | `{}` | 叠加在已清理凭据的父环境之上的显式子环境 |
| `providerName` | `antigravity` | 在 `ctx.subagents` 上注册的名字 |
| `disposeGraceMs` | `3000` | 回收子进程时 SIGTERM 到 SIGKILL 的间隔 |
| `refreshMs` | `60000` | 状态卡在宿主的缓存时长；`?refresh=1` 绕过 |

`model`、`effort`、`mode` 是**CLI flag**，不是会话内协商：`agy` 在启动时就校验组合，不支持的组合会让本次委派立刻失败并给出原文（例如 `--effort is not supported for model "claude-opus-4-6-thinking"`），不会带着默认值静默跑完。

本机 `agy` 1.5.x 可用的模型 id：`gemini-3.8-flash`、`claude-sonnet-4-6`、`claude-opus-4-6-thinking`、`gpt-oss-120b-medium`；用 `agy models` 查账号实际的列表。

想同时挂多个模型，复制这两行、改 `providerName` / `toolName` / `model` 即可（一个 provider 一个固定模型）。

## 状态卡

打开 插件 → dsh-antigravity 即可看到：

- 登录状态（已登录 / 未登录 / 不可用）；未登录时提示去终端完成登录，不会用一次模型调用去探测——那会阻塞约 60 秒。
- 每个模型族的额度窗口（本机实测有 Gemini 与 Claude/GPT 两组，各含每周与 5 小时窗口），带剩余百分比与重置时间。
- G1 credits 余额。
- 文案跟随 Harness 的语言设置（中/英），不跟系统语言；时间也按该语言格式化。
- 首次读取约 7 秒（三次 CLI 冷启动并行），之后 60 秒内命中缓存；「刷新」带 `?refresh=1` 强制重取。

## 已知限制

1. **print 模式不做权限协商**。子进程以 `always-proceed` 运行，文件与命令操作直接执行，harness 拿不到可以拒绝的请求。想收窄就靠 Antigravity 自己的 `~/.gemini/antigravity-cli/settings.json`（`toolPermission`）或 `args` 里的 `--sandbox`。
2. **只接受纯文本 prompt**。prompt 里的图片/文件块会直接报错，不会被静默丢弃。
3. **prompt 上限 128 KiB**。print 模式把 prompt 放在命令行上，受宿主 `ARG_MAX` 限制；超限时报明确错误而不是 spawn 失败。
4. **单轮、不续接**。每次委派都是独立的一轮，没有多轮会话，也不 resume；ACP 路径同样不支持。
5. **必须先完成登录**。未登录时插件不做预检，委派会在子进程里失败并回传 `agy` 的原文诊断。
6. **上游重试告警会进入正文**。Google 端抖动时 `⚠ API error (attempt 1)…` 会以 assistant 文本到达，可能被当作子智能体的答案。
7. **冷启动延迟**。每次委派新建 `agy` 进程，量级为秒；单轮耗时受上游影响可能到分钟级。
8. **无临时会话**。每次委派都会在 `~/.gemini/antigravity-cli/conversations` 留下记录。
9. **要求 `~/.gemini/antigravity-cli/` 可写**。否则 `agy` 写不进自己的运行时文件，工具调用会在子智能体内部反复重试。

## 兼容性

需要 DeepSeek Harness ≥ 0.2.2-rc.1（`@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-tool-subagent` 等在该版本发布）。插件只用到这些包公开的 provider 契约，不依赖任何 harness 侧的未合并改动。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run build
node scripts/verify-build-output.mjs   # 确认 lib/ 与源码一致
node scripts/verify-route-cache.mjs    # 状态路由的缓存/合并/强制重取契约
node scripts/verify-print-runner.mjs   # provider 的 flag 传递/流折叠/失败/取消契约
```

`lib/` 是提交进仓库的构建产物：`dsh plugin add github:…` 直接消费它，不会在安装时构建。CI 因此在每次 push 上跑一遍 typecheck、build，并用 `verify-build-output` 拒绝「改了源码却没重新构建」的提交。

## 许可

MIT — 见 [LICENSE](./LICENSE)。
