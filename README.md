# WorkAny

WorkAny is a desktop AI agent application that executes tasks through natural language. It provides real-time code generation, tool execution, and workspace management.

**Website:** [workany.ai](https://workany.ai)

![](./public/imgs/home.png)

## ❤️ Sponsor

<a href='https://302.ai/?utm_source=workany_github'>
  <img src="https://github.com/user-attachments/assets/a03edf82-2031-4f23-bdb8-bfc0bfd168a4" width="100%" alt="icon"/>
</a>

[302.AI](https://302.ai/?utm_source=workany_github) is a pay-as-you-go AI application platform that offers the most comprehensive AI APIs and online applications available.

> If you want to sponsor this project, please contact us via email: [hello@workany.ai](mailto:hello@workany.ai)

## Previews

- Organize files

![](./public/imgs/files.png)

- Generate website

![](./public/imgs/web.png)

- Generate document

![](./public/imgs/doc.png)

- Generate data table

![](./public/imgs/excel.png)

- Generate slides

![](./public/imgs/ppt.png)

- Use custom model provider for Agent.

![](./public/imgs/settings.png)

- Use Sandbox to execute Code

![](./public/imgs/sandbox.png)

- Configure Agent Skills

![](./public/imgs/skills.png)

## Features

- **Task Execution** - Natural language task input with real-time streaming
- **Agent Runtime** - Powered by [Claude Code](https://github.com/anthropics/claude-code)
- **Agent SDK** - Built on [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
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

# Start Web and Desktop App (recommended)
pnpm dev:app

# Start Web only (Optional)
pnpm dev:web
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Acknowledgments

Some components are built with [ShipAny.ai](https://shipany.ai) - AI-powered full-stack development platform.

## Community

- [Join Discord](https://discord.gg/rDSmZ8HS39)
- [Follow on X](https://x.com/workanyai)

## ⭐️ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=workany-ai/workany&type=Timeline)](https://star-history.com/#workany-ai/workany&Timeline)

## License

This project is licensed under the [WorkAny Community License](LICENSE), based on Apache License 2.0 with additional conditions.

© 2026 ThinkAny, LLC. All rights reserved.
