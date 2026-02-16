# Moltbot (OpenClaw) 项目架构分析

> 探索时间: 2025-02-16
> 项目路径: /Users/fch/Documents/github/moltbot

## 1. 项目结构概览

```
moltbot/
├── src/
│   ├── agents/              # 核心Agent系统 (~316个文件)
│   ├── auto-reply/          # 自动回复和消息处理
│   ├── channels/            # 通道抽象层
│   ├── commands/            # CLI命令实现
│   ├── config/              # 配置类型和加载
│   ├── gateway/             # 网关RPC服务
│   ├── providers/           # 模型提供者
│   ├── routing/             # 消息路由
│   └── telegram/            # Telegram通道实现
├── extensions/              # 插件扩展
├── skills/                  # Agent技能
└── docs/                    # 文档
```

---

## 2. Agent 系统架构

### 2.1 Agent 定义与配置

**配置文件位置:** `src/config/types.agents.ts`

```typescript
// Agent配置结构
type AgentConfig = {
  id: string;                        // 唯一标识符
  default?: boolean;                 // 是否为默认agent
  name?: string;                     // 显示名称
  workspace?: string;                // 工作目录
  agentDir?: string;                 // Agent目录
  model?: AgentModelConfig;          // 模型配置
  skills?: string[];                 // 技能列表
  memorySearch?: MemorySearchConfig; // 记忆搜索
  heartbeat?: {...};                 // 心跳配置
  identity?: IdentityConfig;         // 身份配置
  groupChat?: GroupChatConfig;       // 群聊配置
  subagents?: {...};                 // 子Agent配置
  sandbox?: {...};                   // 沙箱配置
  tools?: AgentToolsConfig;          // 工具配置
};

type AgentsConfig = {
  defaults?: AgentDefaultsConfig;    // 全局默认配置
  list?: AgentConfig[];              // Agent列表
};
```

### 2.2 Agent 作用域管理

**核心文件:** `src/agents/agent-scope.ts`

关键功能:
- `listAgentIds(cfg)` - 列出所有Agent ID
- `resolveDefaultAgentId(cfg)` - 解析默认Agent
- `resolveAgentConfig(cfg, agentId)` - 获取Agent配置
- `resolveAgentWorkspaceDir(cfg, agentId)` - 获取工作目录
- `resolveAgentModelPrimary(cfg, agentId)` - 获取模型配置

### 2.3 Agent 与 Bot 的关系

OpenClaw 中 **Agent 和 Bot 是分离的概念**:

1. **Bot** = 消息通道的入口点
2. **Agent** = AI 逻辑执行器
3. **Binding** = 将消息路由到特定 Agent 的绑定规则

---

## 3. 消息处理流程

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Telegram Bot   │────►│  Route Resolver │────►│  Agent Runner   │
│  (grammy)       │     │  (resolve-route)│     │  (pi-embedded)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        │                       │                       ▼
        │                       │              ┌─────────────────┐
        │                       │              │  Model Provider │
        │                       │              │  (anthropic/    │
        │                       │              │   google/etc)   │
        │                       │              └─────────────────┘
        │                       │
        ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Session Key                                │
│  Format: agent:<agentId>:<channel>:<peerKind>:<peerId>          │
│  Example: agent:main:telegram:direct:123456789                  │
└─────────────────────────────────────────────────────────────────┘
```

**路由解析文件:** `src/routing/resolve-route.ts`

路由优先级:
1. `binding.peer` - 精确匹配用户
2. `binding.peer.parent` - 父级用户匹配
3. `binding.guild` - Discord 服务器匹配
4. `binding.team` - Slack 团队匹配
5. `binding.account` - 账号匹配
6. `binding.channel` - 通道匹配
7. `default` - 使用默认 Agent

---

## 4. 核心执行流程

**主执行入口:** `src/agents/pi-embedded-runner/run.ts`

```typescript
export async function runEmbeddedPiAgent(
  params: RunEmbeddedPiAgentParams
): Promise<EmbeddedPiRunResult> {
  // 1. 解析会话和全局队列
  // 2. 设置工作目录
  // 3. 解析模型和认证配置
  // 4. 执行 Agent 尝试
  // 5. 处理上下文溢出和故障转移
  // 6. 返回结果
}
```

**回复处理入口:** `src/auto-reply/reply/agent-runner.ts`

```typescript
export async function runReplyAgent(params: {...}): Promise<ReplyPayload | undefined> {
  // 1. 设置打字指示器
  // 2. 处理内存刷新
  // 3. 执行 Agent 轮次
  // 4. 构建回复负载
  // 5. 发送回复
}
```

---

## 5. 如何添加新的 Agent 类型

### 方法一: 配置方式 (推荐)

在 `~/.openclaw/config.json` 中添加:

```json
{
  "agents": {
    "list": [
      {
        "id": "my-custom-agent",
        "name": "Custom Agent",
        "default": false,
        "model": "anthropic/claude-sonnet-4-5",
        "workspace": "~/workspace/custom",
        "skills": ["skill1", "skill2"],
        "sandbox": {
          "mode": "non-main",
          "workspaceAccess": "rw"
        }
      }
    ],
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5"
      }
    }
  },
  "bindings": [
    {
      "agentId": "my-custom-agent",
      "match": {
        "channel": "telegram",
        "accountId": "default"
      }
    }
  ]
}
```

### 方法二: CLI 命令

```bash
# 添加新 Agent
openclaw agents add my-agent --model anthropic/claude-sonnet-4-5

# 绑定到通道
openclaw agents bind my-agent telegram
```

**命令实现文件:**
- `src/commands/agents.commands.add.ts`
- `src/commands/agents.bindings.ts`

---

## 6. 工具系统

**工具创建入口:** `src/agents/openclaw-tools.ts`

```typescript
export function createOpenClawTools(options?: {...}): AnyAgentTool[] {
  const tools: AnyAgentTool[] = [
    createBrowserTool({...}),
    createCanvasTool(),
    createNodesTool({...}),
    createCronTool({...}),
    createMessageTool({...}),
    createTtsTool({...}),
    createGatewayTool({...}),
    createAgentsListTool({...}),
    createSessionsListTool({...}),
    createSessionsHistoryTool({...}),
    createSessionsSendTool({...}),
    createSessionsSpawnTool({...}),  // 用于创建子Agent
    createSessionStatusTool({...}),
    ...(webSearchTool ? [webSearchTool] : []),
    ...(webFetchTool ? [webFetchTool] : []),
    ...(imageTool ? [imageTool] : []),
  ];
  // 添加插件工具
  const pluginTools = resolvePluginTools({...});
  return [...tools, ...pluginTools];
}
```

**工具目录:** `src/agents/tools/`

包含:
- `agents-list-tool.ts` - Agent 列表
- `sessions-spawn-tool.ts` - 子 Agent 创建
- `message-tool.ts` - 消息发送
- `browser-tool.ts` - 浏览器控制
- `canvas-tool.ts` - 画布操作
- `cron-tool.ts` - 定时任务
- `gateway-tool.ts` - 网关通信

---

## 7. 模型提供者系统

**模型选择:** `src/agents/model-selection.ts`

支持的提供者:
- `anthropic` - Claude 模型
- `google` - Gemini 模型
- `openai` - GPT 模型
- `claude-cli` - Claude CLI 后端
- `codex-cli` - Codex CLI 后端
- 自定义 CLI 后端 (通过 `cliBackends` 配置)

**认证管理:** `src/agents/model-auth.ts`

支持多种认证模式:
- `api-key` - 直接 API 密钥
- `aws-sdk` - AWS Bedrock
- `oauth` - OAuth 认证
- `cli` - CLI 后端

---

## 8. 子 Agent 系统

**注册表:** `src/agents/subagent-registry.ts`

```typescript
export type SubagentRunRecord = {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  task: string;
  cleanup: "delete" | "keep";
  outcome?: SubagentRunOutcome;
};

export function registerSubagentRun(params: {...}) {
  // 注册子Agent运行
  // 设置监听器
  // 持久化状态
}
```

子 Agent 通过 `sessions_spawn` 工具创建，支持:
- 跨 Agent 任务委托
- 任务完成通知
- 会话自动清理

---

## 9. 关键代码位置汇总

| 功能 | 文件路径 |
|------|----------|
| Agent 配置类型 | `src/config/types.agents.ts` |
| Agent 默认配置 | `src/config/types.agent-defaults.ts` |
| Agent 作用域 | `src/agents/agent-scope.ts` |
| Agent 路由 | `src/routing/resolve-route.ts` |
| Agent 执行器 | `src/agents/pi-embedded-runner/run.ts` |
| 消息处理 | `src/auto-reply/reply/agent-runner.ts` |
| 工具创建 | `src/agents/openclaw-tools.ts` |
| 子 Agent 注册 | `src/agents/subagent-registry.ts` |
| 会话键管理 | `src/routing/session-key.ts` |
| Agent 绑定 | `src/commands/agents.bindings.ts` |
| Telegram Bot | `src/telegram/bot.ts` |
| 模型选择 | `src/agents/model-selection.ts` |
| 模型认证 | `src/agents/model-auth.ts` |

---

## 10. 架构特点总结

1. **Provider 模式**: 支持多种 LLM 提供者，通过统一接口调用
2. **Plugin 架构**: 工具和通道都可通过插件扩展
3. **Session-based**: 使用会话键管理对话状态和并发
4. **Binding 路由**: 灵活的消息到 Agent 路由机制
5. **Sandbox 隔离**: 支持沙箱执行，增强安全性
6. **Multi-Agent**: 支持多个 Agent 实例和子 Agent 委托
7. **CLI 后端**: 支持 CLI 工具作为 LLM 后端

---

## 11. 本地任务集成方案

### 目标
将本地的 Claude Code 或 Codex 作为一个 Agent，接入到 Bot 的 agent 中

### 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                              │
├─────────────────────────────────────────────────────────────────┤
│  Agent: main                                                     │
│  ├── 工具: sessions_spawn (创建子Agent)                          │
│  ├── 工具: browser, canvas, cron...                              │
│  └── 工具: local_task (新)                                       │
│       ├── 调用 Claude Code CLI                                   │
│       └── 调用 Codex CLI                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 方案对比

| 方案 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| **A: 新工具** | 添加 `local_task` 工具 | 灵活控制,可定制参数 | 需要实现工具逻辑 |
| **B: CLI Backend** | 配置为 `cliBackends` | 复用现有框架 | 功能受限 |
| **C: 子 Agent** | 通过 `sessions_spawn` | 完整 Agent 能力 | 配置复杂 |

### 推荐方案: A (新工具)

在 `src/agents/tools/` 中创建 `local-task-tool.ts`:

```typescript
export function createLocalTaskTool(options: {
  claudeCodePath?: string;
  codexPath?: string;
  workanyApiUrl?: string;
}): AnyAgentTool {
  return {
    type: "function",
    function: {
      name: "local_task",
      description: "执行本地任务,使用 Claude Code 或 Codex",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "任务描述" },
          provider: { type: "string", enum: ["claude", "codex"] },
          workspace: { type: "string", description: "工作目录" },
        },
        required: ["prompt"],
      },
    },
    async handler(params: any) {
      // 调用 WorkAny API 执行本地任务
      // 返回结果
    },
  };
}
```

---

## 12. 下一步行动

1. [ ] 确定集成方案 (A/B/C)
2. [ ] 实现 `local_task` 工具
3. [ ] 配置 Agent 绑定
4. [ ] 测试消息路由
5. [ ] 实现 WorkAny API 对接
