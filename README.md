# smart-shell (MCP Server)

[![npm version](https://img.shields.io/npm/v/smart-shell-mcp)](https://www.npmjs.com/package/smart-shell-mcp)
[![CI](https://github.com/mr-wolf-gb/smart-shell-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mr-wolf-gb/smart-shell-mcp/actions/workflows/ci.yml) 
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](https://opensource.org/licenses/GPL-3.0)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io/)

MCP Tool Server – Cross-Platform & Project-Aware Command Runner.

This server exposes tools that execute shell commands in an OS-aware way and adapt to each project's preferred package/runtime manager (npm ↔ bun, pip ↔ poetry, etc.). Agents can read and modify per-project command mappings at runtime.

## Features

- OS-aware command translation (e.g., `ls` → `dir` on Windows). 
- Project-specific overrides stored in `src/project-commands.json` and editable via tools.
- Execute mapped commands with additional args and return `{ stdout, stderr, exitCode }`.
- Structured error objects with actionable suggestions when a command fails.
- Tools: `executeCommand`, `getProjectCommands`, `setProjectCommand`, `removeProjectCommand`, `translateCommand`.

## Requirements

- Node.js 18+ (20+ recommended)

## Install

```bash
# Dev (inside this repo)
npm install

# Production (global CLI)
npm install -g smart-shell-mcp
# or per-project without global install
npx smart-shell-mcp
```

## Run

- Dev (no build):

```bash
npx tsx src/server.ts
```

- Build + run:

```bash
npm run build
npm start
```

This starts an MCP server over stdio. Point your MCP-compatible client at the command above.

## Configuration Files

- `src/command-map.json`: base translation from generic commands → per-OS variants. Example:

```json
{
  "base": {
    "ls": { "windows": "dir", "linux": "ls", "darwin": "ls" },
    "open": { "windows": "start", "linux": "xdg-open", "darwin": "open" }
  }
}
```

- `src/project-commands.json`: project-specific command overrides. Example:

```json
{
  "default": {
    "install": "npm install",
    "run": "npm start"
  },
  "my-bun-project": {
    "install": "bun install",
    "run": "bun run dev"
  },
  "python-api": {
    "install": "pip install -r requirements.txt",
    "run": "uvicorn app:app --reload"
  }
}
```

Files are looked up in the current working directory first. If not found, the copies in `src/` are used and will be created automatically if missing.

## Tools

- `executeCommand({ projectName, commandKey, args?, options? })`
  - Resolve project override → fallback to `default` → translate for OS → run.
  - `options` (all optional):
    - `shell`: `auto | cmd | powershell | bash`
    - `activateVenv`: `auto | on | off`
    - `venvPath`: path to a venv root if not `.venv`/`venv`
    - `cwd`: working directory for the command
    - `env`: key/value environment overrides
  - Returns on success:
    ```json
    {
      "stdout": "...",
      "stderr": "",
      "exitCode": 0,
      "resolvedCommand": "npm install"
    }
    ```
  - On failure returns structured error inside the tool result body (not thrown):
    ```json
    {
      "errorCode": "COMMAND_FAILED",
      "message": "Command failed with exit code 1",
      "suggestion": "poetry install",
      "resolvedCommand": "pip install -r requirements.txt",
      "stdout": "...",
      "stderr": "...",
      "exitCode": 1
    }
    ```

- `getProjectCommands({ projectName })` → merged view `{ ...default, ...project }`.
- `setProjectCommand({ projectName, key, value })` → upsert and persist.
- `removeProjectCommand({ projectName, key })` → delete and persist.
- `translateCommand({ rawCommand })` → `{ os, original, translated }`.

## Error Handling & Suggestions

When a command exits non‑zero the server embeds a structured error with optional suggestions, e.g.:

- If `npm` fails and the workspace looks like a Bun project (`bun.lockb` or `package.json: { packageManager: "bun@..." }`), suggestion: `bun install` (or `bun run dev` for `run`).
- If `pip` fails and `poetry.lock` or `[tool.poetry]` in `pyproject.toml` is present, suggestion: `poetry install`.
- Also detects Yarn (`yarn.lock`) and pnpm (`pnpm-lock.yaml`).

## MCP JSON-RPC Examples

All examples assume stdio transport.

- List tools:
```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
```

- Call `executeCommand`:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "executeCommand",
    "arguments": {
      "projectName": "python-api",
      "commandKey": "install",
      "args": ["-q"]
    }
  }
}
```

- Call `setProjectCommand`:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "setProjectCommand",
    "arguments": {
      "projectName": "my-bun-project",
      "key": "lint",
      "value": "bun run lint"
    }
  }
}
```

## IDE Integration (Production)

After installing globally (`npm i -g smart-shell-mcp`), configure your IDE to run the `smart-shell` executable over stdio.

- Cursor, Kiro, Windsurf (example)
```json
{
  "mcpServers": {
    "smart-shell": {
      "command": "npx",
      "args": [
        "-y",
        "smart-shell-mcp"
      ],
      "env": {}
    }
  }
}
```
Or
```json
{
  "mcpServers": {
    "smart-shell": {
      "command": "smart-shell",
      "args": [],
      "env": {}
    }
  }
}
```

- Claude Desktop (reference)
```json
{
  "mcpServers": {
    "smart-shell": { "command": "smart-shell" }
  }
}
```

Notes
- If you prefer not to install globally, replace `smart-shell` with `npx smart-shell-mcp` in the examples above.
- Windows users can switch to PowerShell execution with the tool options (see below) if needed.

## Project Scripts

- `npm run dev` – start in dev (tsx)
- `npm run build` – build TypeScript to `dist/`
- `npm start` – run compiled server
- `npm run typecheck` – TypeScript type checking

**Made with ❤️ by [Mr-Wolf-GB](https://github.com/mr-wolf-gb) for the MCP community**
