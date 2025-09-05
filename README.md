# smart-shell (MCP Server)

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
# in this repo
npm install
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

- `executeCommand({ projectName, commandKey, args? })`
  - Resolve project override → fallback to `default` → translate for OS → run.
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

## IDE Integration Examples

The server runs over stdio. Configure your IDE/agent to launch the command below; examples vary by client version.

- Claude Desktop (reference):
```json
{
  "mcpServers": {
    "smart-shell": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "env": {}
    }
  }
}
```

- Cursor (conceptual):
```json
{
  "mcpServers": {
    "smart-shell": { "command": "npx", "args": ["tsx", "src/server.ts"] }
  }
}
```

- Kiro (conceptual):
```json
{
  "servers": [
    { "name": "smart-shell", "type": "stdio", "command": "node", "args": ["dist/server.js"] }
  ]
}
```

- Windsurf (conceptual):
```json
{
  "mcpServers": {
    "smart-shell": { "command": "node", "args": ["dist/server.js"] }
  }
}
```

Note: Exact config locations vary by product and version. The key is to run the server via stdio with the command shown in the Run section.

## Project Scripts

- `npm run dev` – start in dev (tsx)
- `npm run build` – build TypeScript to `dist/`
- `npm start` – run compiled server
- `npm run typecheck` – TypeScript type checking

## Publishing (npm)

A release workflow is included. To publish:

1. Create an npm token with publish rights and add it as a repo secret named `NPM_TOKEN`.
2. Bump the version in `package.json`.
3. Create a tag and push it (format `vX.Y.Z`):
   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```
4. The `Release` workflow will build and publish with provenance: `npm publish --access public`.

If you use an Environment named `NPM`, add `NPM_TOKEN` as an environment secret and the workflow will pick it up automatically (job declares `environment: NPM`). You can also store `NPM_TOKEN` as a repository secret instead.

CLI name: `smart-shell` (installed globally provides a stdio MCP server entrypoint).

## License

MIT © Scrapybara
