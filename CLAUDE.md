# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install dependencies
pnpm install

# Development (recommended - runs API + desktop app)
pnpm dev:app

# Start API server only (port 2026 dev, 2620 production)
pnpm dev:api

# Start web UI only (port 1420)
pnpm dev:web

# Start all (API + web)
pnpm dev:all

# Build
pnpm build                    # Frontend
pnpm build:api                # API to dist/
pnpm build:api:binary         # API to standalone binary

# Desktop app builds (platform-specific)
pnpm build:app:mac-arm
pnpm build:app:mac-intel
pnpm build:app:linux
pnpm build:app:windows

# Linting and formatting
pnpm lint                     # ESLint
pnpm lint:fix                 # ESLint with auto-fix
pnpm format                   # Prettier
```

## Architecture Overview

WorkAny is a **three-tier desktop AI agent application**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Tauri Desktop Shell                          │
│                    (src-tauri/ - Rust)                             │
│   - Window management, file system access, SQLite database          │
│   - Embeds API binary as sidecar (src-api/dist/workany-api)         │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
┌───────▼────────────┐              ┌───────────▼──────────┐
│  React Frontend    │              │   Hono API Server    │
│  (src/ - TSX)      │◄────────────►│  (src-api/ - TS)     │
│  Port: 1420        │  HTTP/JSON   │  Port: 2026/2620     │
└────────────────────┘              └───────────┬──────────┘
                                               │
                        ┌──────────────────────┴───────────────────┐
                        │          Provider System                  │
                        ├──────────────────────────────────────────┤
                        │  Agent Providers:                         │
                        │  - claude (Claude Agent SDK)              │
                        │  - codex (OpenAI Codex)                   │
                        │  - deepagents (DeepAgents.js)             │
                        │                                           │
                        │  Sandbox Providers:                       │
                        │  - codex (Codex CLI - VM isolation)       │
                        │  - claude (Anthropic sandbox-runtime)     │
                        │  - native (process execution)             │
                        └──────────────────────────────────────────┘
```

## Core Subsystems

### 1. Provider System (`src-api/src/shared/provider/`)

Extensible registry pattern for both Agent and Sandbox providers. Key interfaces:

- `IProviderRegistry`: Register, get, and manage provider instances
- `ProviderPlugin`: Define providers with metadata, factory, lifecycle hooks
- `defineProviderPlugin()`: Helper to create typed provider plugins

**Provider loading flow:**
1. `initProviderManager()` reads `~/.workany/config.json`
2. Registers built-in providers (codex, claude, native)
3. Initializes configured providers from config

### 2. Agent System (`src-api/src/core/agent/`)

Agent implementations wrap different AI runtimes:

| Provider | Implementation | Usage |
|----------|---------------|-------|
| `claude` | Claude Agent SDK via anthropic.ai/claude-code | Production |
| `codex` | OpenAI Codex CLI | Optional |
| `deepagents` | DeepAgents.js library | Optional |

**Key interfaces:**
- `IAgent`: `run()`, `plan()`, `execute()`, `stop()`
- `AgentMessage`: Streaming message types (`text`, `tool_use`, `tool_result`, `plan`, etc.)
- `ConversationMessage`: Role-based chat history with image attachments

**Two-phase execution:**
1. **Plan phase**: `agent.plan()` → returns `TaskPlan` with steps
2. **Execute phase**: `agent.execute(planId)` → executes approved plan

### 3. Sandbox System (`src-api/src/core/sandbox/`)

Isolated code execution providers:

| Provider | Isolation | Network | Use Case |
|----------|-----------|---------|----------|
| `codex` | VM | Blocked | Untrusted code, security-sensitive |
| `claude` | Container | Varies | Claude Code integration |
| `native` | Process | Allowed | Trusted code, local operations |

**Key interfaces:**
- `ISandboxProvider`: `exec()`, `runScript()`, `isAvailable()`
- `SandboxExecOptions`: command, args, cwd, env, timeout, image
- `VolumeMount`: hostPath ↔ guestPath mapping

**Provider selection:** Codex preferred with fallback to native (see `src-api/src/app/api/sandbox.ts:37-81`)

### 4. MCP Integration (`src-api/src/app/api/mcp.ts`)

Model Context Protocol server support:

**Config paths searched:**
- `~/.workany/mcp.json` (WorkAny-specific)
- `~/.claude/settings.json` (Claude Code shared)

**Server types:**
- `stdio`: Command with args (local process)
- `http`: URL with headers (remote service)

### 5. Skills System

Agent skills are loaded from:
- `~/.workany/skills/` (app-specific)
- `~/.claude/skills/` (shared with Claude Code)

Skills extend agent capabilities with specialized workflows.

## API Routes Structure

```
/health              - Dependency checking, setup
/agent               - Agent execution (plan/execute modes)
  POST /agent/run    - Direct execution
  POST /agent/plan   - Planning phase
  POST /agent/execute - Execute approved plan
/sandbox             - Code execution
  POST /sandbox/exec           - Run command
  POST /sandbox/run/file       - Run script file
  GET  /sandbox/available      - Provider info
/mcp                 - MCP server configuration
/files               - File operations
/providers           - Provider management
/preview             - Artifact preview server
```

## Configuration Files

| Path | Purpose |
|------|---------|
| `~/.workany/config.json` | Provider selection, API keys, model config |
| `~/.workany/mcp.json` | MCP server configurations |
| `~/.claude/settings.json` | Claude Code settings (shared MCP config) |
| `~/.claude/skills/` | Shared agent skills directory |

**Config structure (`~/.workany/config.json`):**
```json
{
  "providers": {
    "sandbox": { "type": "codex", "config": {...} },
    "agent": { "type": "claude", "config": {...} }
  },
  "apiKey": "...",
  "model": "claude-sonnet-4-20250514"
}
```

## Important Constants

All centralized in `src-api/src/config/constants.ts`:

- `DEFAULT_API_PORT`: 2620 (production), 2026 (development)
- `DEFAULT_SANDBOX_PROVIDER`: "codex"
- `DEFAULT_AGENT_PROVIDER`: "claude"
- `SANDBOX_IMAGES`: node (node:18-alpine), python (python:3.11-slim), bun (oven/bun:latest)

## Frontend Architecture

**Main entry:** `src/main.tsx` → `src/app/App.tsx`

**Key pages:**
- `src/app/pages/Home.tsx`: Task input and agent messages
- `src/app/pages/Setup.tsx`: First-time dependency installation
- `src/app/pages/Library.tsx`: File/task library
- `src/app/pages/TaskDetail.tsx`: Task execution view

**Shared hooks:**
- `src/shared/hooks/useAgent.ts`: Agent communication
- `src/shared/hooks/useProviders.ts`: Provider management
- `src/shared/hooks/useVitePreview.ts`: Artifact preview

**Artifact previews:** `src/components/artifacts/` - Supports HTML, React, PDF, Excel, PPTX, images, video, audio, code

## Tauri Integration

**Binary embedding:** The compiled API binary (`src-api/dist/workany-api`) is bundled as a Tauri sidecar. See `src-tauri/tauri.conf.json:34-36`.

**Rust backend:** Minimal - primarily handles window lifecycle, file system dialogs via Tauri plugins. All business logic in Node.js API server.

**Database:** SQLite via `tauri-plugin-sql` for task/file storage.

## Dependency Checking Flow

When the app starts (`src/app/pages/Setup.tsx`):

1. Frontend polls `GET /health/dependencies` (5 retries, 1s delay)
2. Backend runs `which claude` and `which codex` with extended PATH
3. If unavailable, shows setup screen with install commands
4. "Codex" is optional, "Claude Code" is required

**Failure mode:** "无法检查依赖" (Unable to check dependencies) indicates API server unreachable or health check failed.

## Testing

No test suite currently exists. When adding tests:
- Unit tests for provider registry, agent base classes
- Integration tests for API endpoints
- E2E tests with Playwright for critical user flows

## Common Issues

**API server not reachable:**
- Check `pnpm dev:api` is running
- Verify `API_BASE_URL` in frontend config
- Check port conflicts (2026/2620)

**Codex sandbox unavailable:**
- Codex CLI must be installed and in PATH
- Extended PATH in `health.ts:87-113` includes common npm/global paths
- Falls back to `native` provider automatically

**MCP servers not loading:**
- Verify config file format: `{"mcpServers": {...}}`
- Check stdio command paths are absolute or in PATH
- Claude Code shares MCP config via `~/.claude/settings.json`
