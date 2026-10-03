// Starts the installed MCP entry the same way Droid does and runs a smoke test.
import { spawn } from "node:child_process";
import {
  DEFAULT_SERVER_NAME,
  factoryDir,
  mcpConfigPath,
  parseArgs,
  readMcpConfig,
} from "./common.mjs";

const HELP = `Usage: ./verify.sh [options]

Starts the installed Droid MCP entry and checks that Computer Use works.

Options:
  --name <name>          MCP server name in mcp.json (default: ${DEFAULT_SERVER_NAME})
  --factory-dir <path>   Factory config directory (default: $FACTORY_HOME or ~/.factory)
  --app <name>           Also attach to this macOS app (for example "Calculator"),
                         which exercises the app-approval path end to end
  -h, --help             Show this help
`;

const options = parseArgs(process.argv.slice(2), {
  name: "string",
  "factory-dir": "string",
  app: "string",
});
if (options.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const name = options.name ?? DEFAULT_SERVER_NAME;
const configFile = mcpConfigPath(factoryDir(options["factory-dir"]));
const entry = readMcpConfig(configFile).mcpServers[name];
if (!entry) {
  console.error(`No "${name}" server in ${configFile}. Run ./install.sh first.`);
  process.exit(1);
}

const child = spawn(entry.command, entry.args ?? [], {
  env: { ...process.env, ...(entry.env ?? {}) },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const pending = new Map();
let buffer = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method === "elicitation/create") {
      fail("The server sent an approval request to the client. Auto-approval is not active.");
    }
  }
});

let nextId = 1;
function request(method, params, timeoutMs = 120_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`${method} failed: ${message.error.message}`));
      else resolve(message.result);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  if (stderr.trim()) console.error(`\nServer stderr:\n${stderr.trim()}`);
  child.kill();
  process.exit(1);
}

child.on("exit", (code) => {
  if (pending.size > 0) fail(`The server exited early (code ${code}).`);
});

const textOf = (result) => (result?.content ?? []).map((item) => item.text ?? "").join("\n");

async function runJs(code, title) {
  const result = await request("tools/call", { name: "js", arguments: { code, title } });
  const text = textOf(result);
  if (result?.isError) fail(`${title}: ${text.slice(0, 1000)}`);
  return text;
}

try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "codex-computer-use-verify", version: "1.0.0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  console.log("ok  server started and initialized");

  const tools = (await request("tools/list", {})).tools.map((tool) => tool.name);
  if (!tools.includes("js")) fail(`expected a "js" tool, got: ${tools.join(", ")}`);
  console.log(`ok  tools: ${tools.join(", ")}`);

  const stateText = await runJs(
    "const s = await cua.getState({ emit: false }); nodeRepl.write('@@' + JSON.stringify({ apps: s.apps.length, browsers: s.browsers.length, errors: s.errors ?? [] }) + '@@');",
    "Verify inventory",
  );
  const match = stateText.match(/@@(.*?)@@/s);
  if (!match) fail(`unexpected getState output: ${stateText.slice(-500)}`);
  const state = JSON.parse(match[1]);
  console.log(`ok  computer surface: ${state.apps} apps visible`);
  if (state.errors.length > 0) {
    console.log(`warn browser surface: ${state.errors.join("; ")}`);
  } else {
    console.log(`ok  browser surface: ${state.browsers} browser(s) visible`);
  }

  if (options.app) {
    const appText = await runJs(
      `const app = await cua.getApp(${JSON.stringify(options.app)}); nodeRepl.write("@@ATTACHED@@");`,
      `Verify attach to ${options.app}`,
    );
    if (!appText.includes("@@ATTACHED@@")) fail(`could not attach to ${options.app}`);
    console.log(`ok  attached to ${options.app} without an approval prompt`);
  }

  console.log("\nComputer Use is ready for Droid.");
  child.kill();
  process.exit(0);
} catch (error) {
  fail(error.message);
}
