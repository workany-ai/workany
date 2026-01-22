# WorkAny

WorkAny is a desktop AI agent application that executes tasks through natural language. It provides real-time code generation, tool execution, and workspace management.

**Website:** [workany.ai](https://workany.ai)

## Features

- **Task Execution** - Natural language task input with real-time streaming
- **Agent Runtime** - Powered by [Claude Code](https://github.com/anthropics/claude-code)
- **Agent SDK** - Built on [Claude Agent SDK](https://github.com/anthropics/claude-code/tree/main/packages/agent)
- **Sandbox** - Isolated execution via [Codex CLI](https://github.com/openai/codex)
- **Artifact Preview** - Live preview for HTML/React/code files
- **MCP Support** - Model Context Protocol server integration
- **Skills Support** - Custom agent skills for extended capabilities
- **Multi-provider** - OpenRouter, Anthropic, OpenAI, custom providers

## Project Structure

```
workany/
├── src/                # Frontend (React + TypeScript)
├── src-api/            # Backend API (Hono + Claude Agent SDK)
└── src-tauri/          # Desktop app (Tauri + Rust)
```

## Tech Stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| Backend | Hono, Claude Agent SDK, MCP SDK |
| Desktop | Tauri 2, SQLite |

## Development

### Requirements

- Node.js >= 20
- pnpm >= 9
- Rust >= 1.70

### Quick Start

```bash
# Install dependencies
pnpm install

# Start API server
pnpm dev:api

# Start Tauri app (recommended)
pnpm tauri dev
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Acknowledgments

Some components are built with [ShipAny.ai](https://shipany.ai) - AI-powered full-stack development platform.

## License

This project is licensed under the [WorkAny Community License](LICENSE), based on Apache License 2.0 with additional conditions.

© 2026 ThinkAny, LLC. All rights reserved.
