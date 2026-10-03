// Installs the Codex computer-use launcher and registers it in Droid's mcp.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundledNodePath, codexHome, findCodexApp, helperAppPath, resolveServer } from "../runtime/codex.mjs";
import {
  DEFAULT_SERVER_NAME,
  INSTALL_DIR_NAME,
  LAUNCHER_FILE,
  backupFile,
  factoryDir,
  isOurEntry,
  mcpConfigPath,
  parseArgs,
  readMcpConfig,
  writeJsonAtomic,
} from "./common.mjs";

const HELP = `Usage: ./install.sh [options]

Registers the Codex computer-use MCP server in Factory Droid.

Options:
  --name <name>          MCP server name in mcp.json (default: ${DEFAULT_SERVER_NAME})
  --codex-app <path>     Codex app bundle (default: auto-detect)
  --codex-home <path>    Codex data directory (default: $CODEX_HOME or ~/.codex)
  --factory-dir <path>   Factory config directory (default: $FACTORY_HOME or ~/.factory)
  --print                Print the mcp.json entry and exit without changing anything
  --dry-run              Show what would change without writing
  --force                Replace an existing entry with the same name that this tool did not create
  -h, --help             Show this help
`;

const options = parseArgs(process.argv.slice(2), {
  name: "string",
  "codex-app": "string",
  "codex-home": "string",
  "factory-dir": "string",
  print: "boolean",
  "dry-run": "boolean",
  force: "boolean",
});
if (options.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = options.name ?? DEFAULT_SERVER_NAME;
const appPath = findCodexApp(options["codex-app"]);
const home = codexHome(options["codex-home"]);
const factory = factoryDir(options["factory-dir"]);
const installDir = path.join(factory, INSTALL_DIR_NAME);
const launcherPath = path.join(installDir, LAUNCHER_FILE);
const nodePath = bundledNodePath(appPath);

// Fails early if this Codex build has no computer-use runtime.
const server = resolveServer({ appPath, home });

const entry = {
  type: "stdio",
  command: nodePath,
  args: [launcherPath],
  env: { CODEX_APP_PATH: appPath, CODEX_HOME: home },
  connectTimeout: 120000,
  timeout: 600000,
};

const log = (line = "") => process.stdout.write(`${line}\n`);

if (options.print) {
  log(JSON.stringify({ [name]: entry }, null, 2));
  process.exit(0);
}

log(`Codex app:        ${appPath}${server.version ? ` (version ${server.version})` : ""}`);
log(`Codex home:       ${home}`);
log(`Server source:    ${server.source === "codex-manifest" ? server.manifestPath : "derived from the app bundle"}`);
log(`Launcher:         ${launcherPath}`);
log(`Droid MCP config: ${mcpConfigPath(factory)} (server "${name}")`);

const helper = helperAppPath(home);
if (!fs.existsSync(helper)) {
  log();
  log(`Warning: ${helper} was not found.`);
  log("Open the Codex app, turn on Computer Use, and grant its macOS permissions once. See the README.");
}

const configFile = mcpConfigPath(factory);
const config = readMcpConfig(configFile);
const existing = config.mcpServers[name];
if (existing && !isOurEntry(existing) && !options.force) {
  log();
  log(`mcp.json already has a server named "${name}" that this tool did not create.`);
  log("Re-run with --force to replace it (a backup is made first), or pick another --name.");
  process.exit(1);
}
for (const key of ["disabled", "disabledTools"]) {
  if (existing && existing[key] !== undefined) entry[key] = existing[key];
}

if (options["dry-run"]) {
  log();
  log("Dry run. This entry would be written:");
  log(JSON.stringify({ [name]: entry }, null, 2));
  process.exit(0);
}

fs.mkdirSync(installDir, { recursive: true });
for (const file of ["launcher.mjs", "codex.mjs"]) {
  fs.copyFileSync(path.join(repoRoot, "runtime", file), path.join(installDir, file));
}

const backup = backupFile(configFile, "codex-computer-use");
config.mcpServers[name] = entry;
writeJsonAtomic(configFile, config);

log();
if (backup) log(`Backed up the previous mcp.json to ${backup}`);
log(`Installed. Droid reloads mcp.json automatically. Run ./verify.sh to test the connection.`);
