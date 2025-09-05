#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths for JSON config files. Prefer CWD first so users can keep configs alongside their project.
function resolvePathPreferCwd(filename: string): string {
  const candidateInCwd = path.resolve(process.cwd(), filename);
  if (fssync.existsSync(candidateInCwd)) return candidateInCwd;
  return path.resolve(__dirname, filename.startsWith("src/") ? filename.replace(/^src\//, "") : filename);
}

const COMMAND_MAP_PATH = resolvePathPreferCwd("src/command-map.json");
const PROJECT_COMMANDS_PATH = resolvePathPreferCwd("src/project-commands.json");

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const data = await fs.readFile(p, "utf8");
    return JSON.parse(data) as T;
  } catch {
    // Ensure parent folder exists
    try { await fs.mkdir(path.dirname(p), { recursive: true }); } catch {}
    await fs.writeFile(p, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

async function saveJson<T>(p: string, data: T): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2));
}

function getOS(): "windows" | "linux" | "darwin" {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "darwin";
    default:
      return "linux";
  }
}

function splitPipelines(cmd: string): string[] {
  // Split by common command separators while preserving order
  const parts: string[] = [];
  let buf = "";
  let i = 0;
  while (i < cmd.length) {
    const two = cmd.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      if (buf.trim()) parts.push(buf.trim());
      parts.push(two);
      buf = "";
      i += 2;
      continue;
    }
    const ch = cmd[i];
    if (ch === "|") {
      if (buf.trim()) parts.push(buf.trim());
      parts.push("|");
      buf = "";
      i += 1;
      continue;
    }
    if (ch === ";") {
      if (buf.trim()) parts.push(buf.trim());
      parts.push(";");
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function translateSingle(cmd: string, os: "windows" | "linux" | "darwin", map: any): string {
  const base = map?.base ?? {};
  const m = /^(\S+)(.*)$/s.exec(cmd);
  if (!m) return cmd;
  const head = m[1];
  const tail = m[2] ?? "";
  const lowerHead = head.toLowerCase();

  let replacement: string | undefined;
  for (const key of Object.keys(base)) {
    if (lowerHead === key.toLowerCase()) {
      replacement = base[key]?.[os] ?? head;
      break;
    }
  }

  // Special case: handle pattern "rm -rf <path>" -> windows rmdir /s /q
  if (!replacement) {
    if (lowerHead === "rm" && tail.trim().startsWith("-rf")) {
      const mapped = base["rm -rf"]?.[os];
      if (mapped) return `${mapped} ${tail.trim().replace(/^\-rf\s*/, "")}`.trim();
    }
  }

  return `${replacement ?? head}${tail}`.trim();
}

function translateCommandForOS(raw: string, os: "windows" | "linux" | "darwin", map: any): string {
  const segments = splitPipelines(raw);
  return segments
    .map((seg) => {
      if (["&&", "||", "|", ";"].includes(seg)) return seg;
      return translateSingle(seg, os, map);
    })
    .join(" ");
}

function quoteArg(a: string): string {
  if (a === undefined || a === null) return "";
  if (/^[A-Za-z0-9_\-\.\/]+$/.test(a)) return a;
  // Escape quotes
  return `"${a.replace(/"/g, '\\"')}"`;
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function detectProjectFlavor(): Promise<{ bun: boolean; yarn: boolean; pnpm: boolean; poetry: boolean; pipenv: boolean; }> {
  const cwd = process.cwd();
  const bun = await fileExists(path.join(cwd, "bun.lockb")) || await (async () => {
    try {
      const pkgPath = path.join(cwd, "package.json");
      const txt = await fs.readFile(pkgPath, "utf8");
      return /"packageManager"\s*:\s*"bun@/i.test(txt);
    } catch { return false; }
  })();
  const yarn = await fileExists(path.join(cwd, "yarn.lock"));
  const pnpm = await fileExists(path.join(cwd, "pnpm-lock.yaml"));
  const poetry = await fileExists(path.join(cwd, "poetry.lock")) || await (async () => {
    try {
      const txt = await fs.readFile(path.join(cwd, "pyproject.toml"), "utf8");
      return /\[tool\.poetry\]/i.test(txt);
    } catch { return false; }
  })();
  const pipenv = await fileExists(path.join(cwd, "Pipfile"));
  return { bun, yarn, pnpm, poetry, pipenv };
}

async function resolveProjectCommand(projectName: string, key: string): Promise<string | undefined> {
  const defaults = {
    default: {
      install: "npm install",
      run: "npm start"
    }
  } as Record<string, Record<string, string>>;
  const fileData = await loadJson<Record<string, Record<string, string>>>(PROJECT_COMMANDS_PATH, defaults);
  const fromDefault = fileData["default"]?.[key];
  const fromProject = fileData[projectName]?.[key];
  return fromProject ?? fromDefault;
}

async function getMergedCommands(projectName: string): Promise<Record<string, string>> {
  const data = await loadJson<Record<string, Record<string, string>>>(PROJECT_COMMANDS_PATH, { default: {} });
  return { ...(data.default || {}), ...(data[projectName] || {}) };
}

async function setProjectCommand(projectName: string, key: string, value: string) {
  const data = await loadJson<Record<string, Record<string, string>>>(PROJECT_COMMANDS_PATH, { default: {} });
  if (!data[projectName]) data[projectName] = {};
  data[projectName][key] = value;
  await saveJson(PROJECT_COMMANDS_PATH, data);
  return { projectName, key, value };
}

async function removeProjectCommand(projectName: string, key: string) {
  const data = await loadJson<Record<string, Record<string, string>>>(PROJECT_COMMANDS_PATH, { default: {} });
  if (!data[projectName]) return { removed: false };
  const existed = Object.prototype.hasOwnProperty.call(data[projectName], key);
  delete data[projectName][key];
  await saveJson(PROJECT_COMMANDS_PATH, data);
  return { removed: existed };
}

async function runShell(command: string): Promise<{ stdout: string; stderr: string; exitCode: number; }>{
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code: number | null) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

function buildSuggestion(cmd: string, stderr: string, flavor: { bun: boolean; yarn: boolean; pnpm: boolean; poetry: boolean; pipenv: boolean; }, key?: string): string | undefined {
  const lc = cmd.toLowerCase();
  if (lc.includes("npm ")) {
    if (flavor.bun) {
      if (key === "install") return "bun install";
      if (key === "run") return "bun run dev";
      return cmd.replace(/\bnpm\b/g, "bun");
    }
    if (flavor.yarn) {
      if (key === "install") return "yarn install";
      return cmd.replace(/\bnpm run\b/g, "yarn");
    }
    if (flavor.pnpm) {
      if (key === "install") return "pnpm install";
      return cmd.replace(/\bnpm run\b/g, "pnpm run");
    }
  }
  if (/\bpip\b/.test(lc)) {
    if (flavor.poetry) return "poetry install";
    if (flavor.pipenv) return "pipenv install";
  }
  return undefined;
}

async function main() {
  const server = new McpServer({ name: "smart-shell", version: "0.1.0" });

  server.registerTool(
    "executeCommand",
    {
      title: "Execute a project-aware command",
      description: "Executes a command after applying project overrides and OS translation",
      inputSchema: {
        projectName: z.string().describe("Project name used to select overrides"),
        commandKey: z.string().describe("Logical command key, e.g. install, run, test"),
        args: z.array(z.string()).optional().describe("Extra CLI args to append")
      }
    },
    async ({ projectName, commandKey, args }) => {
      const os = getOS();
      const cmdMap = await loadJson<any>(COMMAND_MAP_PATH, { base: {} });
      const projectCmd = await resolveProjectCommand(projectName, commandKey);
      const flavor = await detectProjectFlavor();

      if (!projectCmd) {
        const result = {
          errorCode: "COMMAND_NOT_FOUND",
          message: `No command mapping found for key "${commandKey}"`,
          suggestion: undefined as string | undefined
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      const translated = translateCommandForOS(projectCmd, os, cmdMap);
      const full = [translated, ...(args || []).map(quoteArg)].filter(Boolean).join(" ");

      const run = await runShell(full);
      if (run.exitCode !== 0) {
        const suggestion = buildSuggestion(projectCmd, run.stderr, flavor, commandKey);
        const result = {
          errorCode: "COMMAND_FAILED",
          message: `Command failed with exit code ${run.exitCode}`,
          suggestion,
          resolvedCommand: full,
          stdout: run.stdout,
          stderr: run.stderr,
          exitCode: run.exitCode
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      const output = {
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        resolvedCommand: full
      };
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
    }
  );

  server.registerTool(
    "getProjectCommands",
    {
      title: "Get project commands",
      description: "Return merged command mappings for a project",
      inputSchema: { projectName: z.string() }
    },
    async ({ projectName }) => {
      const merged = await getMergedCommands(projectName);
      return { content: [{ type: "text", text: JSON.stringify({ projectName, commands: merged }, null, 2) }] };
    }
  );

  server.registerTool(
    "setProjectCommand",
    {
      title: "Set a project command",
      description: "Add or update a project-specific command override",
      inputSchema: { projectName: z.string(), key: z.string(), value: z.string() }
    },
    async ({ projectName, key, value }) => {
      const res = await setProjectCommand(projectName, key, value);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  server.registerTool(
    "removeProjectCommand",
    {
      title: "Remove a project command",
      description: "Delete a command override for a project",
      inputSchema: { projectName: z.string(), key: z.string() }
    },
    async ({ projectName, key }) => {
      const res = await removeProjectCommand(projectName, key);
      return { content: [{ type: "text", text: JSON.stringify({ projectName, key, ...res }, null, 2) }] };
    }
  );

  server.registerTool(
    "translateCommand",
    {
      title: "Translate a raw command for this OS",
      description: "Show how a generic command would be adapted for the current OS",
      inputSchema: { rawCommand: z.string() }
    },
    async ({ rawCommand }) => {
      const os = getOS();
      const cmdMap = await loadJson<any>(COMMAND_MAP_PATH, { base: {} });
      const translated = translateCommandForOS(rawCommand, os, cmdMap);
      return { content: [{ type: "text", text: JSON.stringify({ os, original: rawCommand, translated }, null, 2) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("smart-shell server error:", err);
  process.exit(1);
});
