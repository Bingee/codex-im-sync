# Codex IM Sync Skill

将 Telegram、Discord 或飞书桥接到本地 Codex 会话。

[English](README.md)

> **想要桌面图形界面？** 试试 [CodePilot](https://github.com/op7418/CodePilot) —— 一个功能完整的桌面应用，提供可视化聊天界面、会话管理、文件树预览、权限控制等。本 Skill 从 CodePilot 的 IM 桥接模块中提取而来，适合偏好轻量级纯 CLI 方案的用户。

## 上游来源与本 Fork 的改动

这个仓库基于 [op7418/Claude-to-IM-skill](https://github.com/op7418/Claude-to-IM-skill) 修改而来，再收口成一个以 Codex 为主的本地 IM 桥接 Skill。

这个 fork 的主要优化点：

- **复用本地 Codex 线程**：通过本地 `codex exec` / `codex exec resume` 让一个 IM 聊天持续跟随你机器上的同一条 Codex 线程
- **飞书本地线程索引**：扫描 `~/.codex/sessions`，在聊天里直接看到最近本地线程
- **更顺手的飞书切换方式**：支持 `/use <index|thread_id|project_name>`，再配合 `cti_use_1` 这类菜单快捷项
- **飞书菜单兼容兜底**：如果飞书菜单不是稳定事件回调，而是发送文字消息，`cti_*` 也能被 bridge 识别
- **Codex 优先的文档与配置**：默认运行时、示例、配置流程都围绕 Codex，而不是 Claude
- **更简洁的线程列表**：线程回复改成紧凑编号结构，减少飞书里冗长输出

---

## 工作原理

本 Skill 运行一个后台守护进程，将你的 IM 机器人连接到本地 Codex 会话。来自 IM 的消息会转发给 Codex，响应（包括工具调用、权限请求、流式预览）再回到聊天里。核心点是 `CTI_RUNTIME=codex` 会通过本地 `codex exec` / `codex exec resume` 复用 Codex 本机会话，所以同一个 IM 窗口可以持续跟随你机器上的同一条 Codex 线程。

```
你 (Telegram/Discord/飞书)
  ↕ Bot API
后台守护进程 (Node.js)
  ↕ 本地 Codex CLI
Codex → 读写你的代码库
```

## 功能特点

- **三大 IM 平台** — Telegram、Discord、飞书，可任意组合启用
- **交互式配置** — 引导式向导逐步收集 token，附带详细获取说明
- **权限控制** — bridge 自己管理的工具调用可在聊天中审批
- **流式预览** — 实时查看 Claude 的输出（Telegram 和 Discord 支持）
- **会话持久化** — 对话在守护进程重启后保留
- **密钥保护** — token 以 `chmod 600` 存储，日志中自动脱敏
- **无需编写代码** — 安装 Skill 后运行 `/codex-im-sync setup` 即可

## 前置要求

- **Node.js >= 20**
- **Codex CLI** — `npm install -g @openai/codex`
- **Codex 鉴权** — 运行 `codex auth login`，或设置 `OPENAI_API_KEY`

Claude 兼容说明：
`CTI_RUNTIME=claude` 和 `CTI_RUNTIME=auto` 还保留着，但这个 fork 的主路径和文档都围绕 Codex。

## 安装

### 本地 fork 安装

这个仓库更适合从你的本地 checkout 或你自己的 fork 安装。

### 符号链接方式

如果你想把仓库放在其他位置（比如方便开发）：

```bash
git clone <你的-fork-url> ~/code/codex-im-sync
mkdir -p ~/.claude/skills
ln -s ~/code/codex-im-sync ~/.claude/skills/codex-im-sync
```

### Codex

如果你使用 [Codex](https://github.com/openai/codex)，直接克隆到 Codex skills 目录：

```bash
bash ~/code/codex-im-sync/scripts/install-codex.sh

# 或使用符号链接模式（方便开发）
bash ~/code/codex-im-sync/scripts/install-codex.sh --link
```

### 验证安装

启动一个新的 Codex 会话，输入 `codex-im-sync setup` 或 `启动桥接`。如果识别成功，Codex 会进入配置流程。

## 快速开始

### 1. 配置

```
/codex-im-sync setup
```

向导会引导你完成以下步骤：

1. **选择渠道** — 选择 Telegram、Discord、飞书，或任意组合
2. **输入凭据** — 向导会详细说明如何获取每个 token、需要开启哪些设置、授予哪些权限
3. **设置默认值** — 工作目录、模型、模式
4. **验证** — 立即通过平台 API 验证 token 有效性

### 2. 启动

```
/codex-im-sync start
```

守护进程在后台启动。关闭终端后仍会继续运行。

### 3. 开始聊天

打开 IM 应用，给你的机器人发消息，Codex 会回复。

如果是 bridge 自己管理的审批流，聊天中会弹出 **允许** / **拒绝**。本地 Codex 执行策略则由 `CTI_CODEX_APPROVAL_POLICY`、`CTI_CODEX_FULL_AUTO`、`CTI_CODEX_DANGEROUS_BYPASS` 控制。

## 常用 Codex 提示词

| 提示词 | 说明 |
|---|---|
| `codex-im-sync setup` / `配置` | 交互式配置向导 |
| `start bridge` / `启动桥接` | 启动桥接守护进程 |
| `stop bridge` / `停止桥接` | 停止守护进程 |
| `bridge status` / `状态` | 查看运行状态 |
| `查看日志` / `logs 200` | 查看最近日志 |
| `reconfigure` / `修改配置` | 交互式修改配置 |
| `doctor` / `诊断` | 诊断问题 |

## 平台配置指南

`setup` 向导会在每一步提供内联指引，以下是概要：

### Telegram

1. 在 Telegram 中搜索 `@BotFather` → 发送 `/newbot` → 按提示操作
2. 复制 bot token（格式：`123456789:AABbCc...`）
3. 建议：`/setprivacy` → Disable（用于群组）
4. 获取 User ID：给 `@userinfobot` 发消息

### Discord

1. 前往 [Discord 开发者门户](https://discord.com/developers/applications) → 新建应用
2. Bot 标签页 → Reset Token → 复制 token
3. 在 Privileged Gateway Intents 下开启 **Message Content Intent**
4. OAuth2 → URL Generator → scope 选 `bot` → 权限选 Send Messages、Read Message History、View Channels → 复制邀请链接

### 飞书 / Lark

1. 前往[飞书开放平台](https://open.feishu.cn/app)（或 [Lark](https://open.larksuite.com/app)）
2. 创建自建应用 → 获取 App ID 和 App Secret
3. **批量添加权限**：进入"权限管理" → 使用批量配置添加所有必需权限（`setup` 向导提供完整 JSON）
4. 在"添加应用能力"中启用机器人
5. **事件与回调**：选择**长连接**作为事件订阅方式 → 添加 `im.message.receive_v1` 事件
   还需要添加 `im.chat.access_event.bot_p2p_chat_entered_v1`、`application.bot.menu_v6`
   如果你后续要接 Feishu 模板卡片交互，再额外添加回调 `card.action.trigger`
6. **发布**：进入"版本管理与发布" → 创建版本 → 提交审核 → 在管理后台审核通过
7. **注意**：版本审核通过并发布后机器人才能使用
8. **机器人菜单**：在机器人能力里配置事件型菜单，建议使用这些 key：
   `cti_threads`、`cti_threads_refresh`、`cti_new_session`、`cti_status`
   如果你想一键切最近线程，再加：
   `cti_use_1`、`cti_use_2`、`cti_use_3`、`cti_use_4`、`cti_use_5`

### 飞书聊天内可用的线程命令

- `/threads`：列出本机最近的 Codex 线程
- `/refreshthreads`：强制刷新本机线程索引
- `/use <index|thread_id|project_name>`：把当前飞书聊天切换到某条本地 Codex 线程

说明：
- `/threads` 会给最近线程编号，你可以直接发 `/use 1`
- 飞书菜单里的 `cti_use_1` 到 `cti_use_5` 会映射到 `/use 1` 到 `/use 5`
- 飞书 `schema 2.0` 原生卡片不支持旧版 `action` 按钮标签，所以线程切换不依赖卡片按钮回调

## 架构

```
~/.codex-im-sync/
├── config.env             ← 凭据与配置 (chmod 600)
├── data/                  ← 持久化 JSON 存储
│   ├── sessions.json
│   ├── bindings.json
│   ├── permissions.json
│   └── messages/          ← 按会话分文件的消息历史
├── logs/
│   └── bridge.log         ← 自动轮转，密钥脱敏
└── runtime/
    ├── bridge.pid          ← 守护进程 PID 文件
    └── status.json         ← 当前状态
```

### 核心组件

| 组件 | 职责 |
|---|---|
| `src/main.ts` | 守护进程入口，组装依赖注入，启动 bridge |
| `src/config.ts` | 加载/保存 `config.env`，映射为 bridge 设置 |
| `src/store.ts` | JSON 文件 BridgeStore（30 个方法，写穿缓存） |
| `src/llm-provider.ts` | 保留的 Claude 兼容 provider，用于 fallback runtime |
| `src/codex-provider.ts` | 本地 `codex exec` / `codex exec resume` JSONL → SSE 流 |
| `src/sse-utils.ts` | 共享的 SSE 格式化辅助函数 |
| `src/permission-gateway.ts` | 异步桥接：SDK `canUseTool` ↔ IM 按钮 |
| `src/logger.ts` | 密钥脱敏的文件日志，支持轮转 |
| `scripts/daemon.sh` | 进程管理（start/stop/status/logs） |
| `scripts/doctor.sh` | 诊断检查 |
| `SKILL.md` | Skill 定义和命令工作流 |

### 权限流程

```
1. bridge 管理的运行时需要使用工具（例如编辑文件）
2. provider 发射 `permission_request` SSE 事件
3. Bridge 在 IM 聊天中发送内联按钮：[允许] [拒绝]
4. 等待用户响应（5 分钟超时）
5. 用户点击允许 → Bridge 解除权限等待
6. 继续执行 → 结果流式发回 IM
```

## 故障排查

运行诊断：

```
/codex-im-sync doctor
```

检查项目：Node.js 版本、配置文件是否存在及权限、token 有效性（实时 API 调用）、日志目录、PID 文件一致性、最近的错误。

| 问题 | 解决方案 |
|---|---|
| `Bridge 无法启动` | 运行 `doctor`，检查 Node 版本和日志 |
| `收不到消息` | 用 `doctor` 验证 token，检查允许用户配置 |
| `权限超时` | 用户 5 分钟内未响应，工具调用自动拒绝 |
| `PID 文件残留` | 运行 `stop` 再 `start`，脚本会自动清理 |

详见 [references/troubleshooting.md](references/troubleshooting.md)。

## 安全

- 所有凭据存储在 `~/.codex-im-sync/config.env`，权限 `chmod 600`
- 日志输出中 token 自动脱敏（基于正则匹配）
- 允许用户/频道/服务器列表限制谁可以与机器人交互
- 守护进程是本地进程，没有入站网络监听
- 详见 [SECURITY.md](SECURITY.md) 了解威胁模型和应急响应

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 开发模式运行
npm run typecheck  # 类型检查
npm test           # 运行测试
npm run build      # 构建打包
```

## 最小发布清单

建议提交到 GitHub 的内容：

- `SKILL.md`
- `agents/openai.yaml`
- `README.md`
- `README_CN.md`
- `LICENSE`
- `config.env.example`
- `src/`
- `scripts/`
- `references/`
- `package.json`
- `package-lock.json`

不要提交这些内容：

- `.git/`
- `node_modules/`
- `~/.codex-im-sync/` 运行时数据
- 本地 `config.env`

可选项：

- `dist/`：如果你希望仓库里直接带预构建 bundle 就保留；如果你想保持源码仓库干净，也可以不提交

## 许可

[MIT](LICENSE)
