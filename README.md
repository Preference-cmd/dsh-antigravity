# dsh-antigravity

<!-- Bump the first badge with the @deepseek-ai/dsh-subagent-acp peer range. -->
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

装完重启该 profile。`file:` 与 `github:` 都会把 `@deepseek-ai/dsh-subagent-acp` 等依赖一并装进 profile。

本地目录安装与反复改动：

```sh
# 普通本地安装
dsh plugin --profile web add file:/absolute/path/to/plugins/dsh-antigravity

# 改代码时用 link: 更省事——但 pnpm 不会为链接目录安装它自己的依赖，要补一条
dsh plugin --profile web add link:/absolute/path/to/plugins/dsh-antigravity \
                              link:/absolute/path/to/deepseek-harness/packages/subagent/subagent-acp
```

## 它做了什么

- **`subagent-antigravity`**（宿主侧）：复用 `@deepseek-ai/dsh-subagent-acp`。每次委派 spawn 一个 `agy acp` 进程，新建一个 ACP session，把任务发过去，取回最终答案后回收进程。
- **`subagent_antigravity`**（工具）：模型可见的委派工具。`maxDepth: provider-managed`——递归预算归子智能体自己的运行时管。
- **`antigravity-status`**（宿主 + 浏览器侧）：在插件自己的详情页底部画一张状态卡——Google 登录状态、按模型族分组的用量限额条、G1 额度，以及手动刷新。

子智能体有自己的模型、mode、工具与配额，与父会话使用的模型无关；两者只共享工作目录。

状态卡的数据全部来自零 token 的斜杠命令（`agy models`、`/usage`、`/credits`）：宿主用一条已鉴权的 `GET /api/antigravity/status` 暴露它们，缓存 60 秒；ACP 通道本身不报告配额。没有浏览器面的 profile（headless）不会挂载这一行。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: subagent-antigravity
  config:
    # 默认取 $AGY_BIN，否则 ~/.local/bin/agy
    command: /Users/you/.local/bin/agy
    # 需要在子智能体首次 prompt 之前固定的选项（见下）
    configOptions:
      model: claude-opus-4-6-thinking
      thought_level: high
      mode: accept-edits

- id: tool-subagent-antigravity
  config:
    toolName: subagent_antigravity
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `command` | `$AGY_BIN` 或 `~/.local/bin/agy` | `agy` 可执行文件；不在 `PATH` 上时用它 |
| `permission` | `reject` | 只回答真正到达 harness 的权限请求：`reject` 或选择第一个 allow 选项（`allow`） |
| `configOptions` | 无 | ACP 会话配置项，在第一次 prompt 前应用；被 `agy` 拒绝会让本次委派在启动阶段失败 |

`configOptions` 的可用值（本机 `agy` 1.5.x 实测）：

| 配置 id | 取值 |
|---|---|
| `model` | `gemini-3.8-flash`、`claude-sonnet-4-6`、`claude-opus-4-6-thinking`、`gpt-oss-120b-medium` |
| `thought_level` | `low`、`medium`、`high` |
| `mode` | `default`、`accept-edits`、`plan` |

注意 `agy acp` 自身没有 `--model` / `--mode` 开关，也不能通过 `~/.gemini/antigravity-cli/settings.json` 改变 ACP 会话默认值——要固定模型只能走 `configOptions`。

想同时挂多个模型，复制这两个行、改 `providerName` / `toolName` 即可（一个 provider 一个固定模型）。

状态卡所在的行（`antigravity-status`）只有两个配置项：`command`（同上）与 `refreshMs`（宿主缓存时长，默认 60000）。带 `?refresh=1` 的请求绕过缓存，面板的「刷新」按钮就是这么取的。

## 状态卡

打开 插件 → dsh-antigravity 即可看到：

- 登录状态（已登录 / 未登录 / 不可用）；未登录时提示去终端完成登录，不会用一次模型调用去探测——那会阻塞约 60 秒。
- 每个模型族的额度窗口（本机实测有 Gemini 与 Claude/GPT 两组，各含每周与 5 小时窗口），带剩余百分比与重置时间。
- G1 credits 余额。
- 文案跟随 Harness 的语言设置（中/英），不跟系统语言；时间也按该语言格式化。
- 首次读取约 7 秒（三次 CLI 冷启动并行），之后 60 秒内命中缓存；「刷新」带 `?refresh=1` 强制重取。

## 已知限制

1. **权限由 Antigravity 决定是否上报**。`~/.gemini/antigravity-cli/settings.json` 的 `toolPermission` 才是权威；设成 `always-proceed` 时子智能体自主执行文件与命令操作，`permission: reject` 只能拒绝真正到达的请求，不等于只读。
2. **必须先完成登录**。未登录时 `agy acp` 的行为尚未验证（print 模式会阻塞约 60 秒进入交互式 OAuth），插件不做登录预检。
3. **上游重试告警会进入正文**。Google 端抖动时 `⚠ API error (attempt 1)…` 会以 assistant 文本到达，可能被当作子智能体的答案。
4. **冷启动与长尾延迟**。每次委派新建 `agy acp` 进程，`session/new` 约 4–7 秒；单轮耗时受上游影响可能到分钟级。
5. **无临时会话**。每次委派都会在 `~/.gemini/antigravity-cli/conversations` 留下记录。
6. **要求 `~/.gemini/antigravity-cli/` 可写**。否则 `agy` 写不进 `bin/agentapi`，所有工具调用失败并在子智能体内部反复重试。

## 兼容性

需要 DeepSeek Harness ≥ 0.2.2-rc.1（`@deepseek-ai/dsh-subagent-acp` 与 `@deepseek-ai/dsh-tool-subagent` 在该版本发布）。`configOptions` 需要包含对应支持的后续版本；在更旧的 harness 上该键会被忽略，子智能体退回自身默认，不影响加载。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run build
node scripts/verify-build-output.mjs   # 确认 lib/ 与源码一致
node scripts/verify-route-cache.mjs    # 状态路由的缓存/合并/强制重取契约
```

`lib/` 是提交进仓库的构建产物：`dsh plugin add github:…` 直接消费它，不会在安装时构建。CI 因此在每次 push 上跑一遍 typecheck、build，并用 `verify-build-output` 拒绝「改了源码却没重新构建」的提交。

## 许可

MIT — 见 [LICENSE](./LICENSE)。
