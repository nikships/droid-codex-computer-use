// Removes the Droid MCP entry and the installed launcher files.
import fs from "node:fs";
import path from "node:path";
import { codexHome } from "../runtime/codex.mjs";
import {
  DEFAULT_SERVER_NAME,
  INSTALL_DIR_NAME,
  backupFile,
  factoryDir,
  isOurEntry,
  mcpConfigPath,
  parseArgs,
  readMcpConfig,
  writeJsonAtomic,
} from "./common.mjs";

const HELP = `Usage: ./uninstall.sh [options]

Removes the Codex computer-use server from Factory Droid.

Options:
  --name <name>          MCP server name in mcp.json (default: ${DEFAULT_SERVER_NAME})
  --factory-dir <path>   Factory config directory (default: $FACTORY_HOME or ~/.factory)
  --codex-home <path>    Codex data directory (default: $CODEX_HOME or ~/.codex)
  --force                Remove the named entry even if this tool did not create it
  -h, --help             Show this help
`;

const options = parseArgs(process.argv.slice(2), {
  name: "string",
  "factory-dir": "string",
  "codex-home": "string",
  force: "boolean",
});
if (options.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const name = options.name ?? DEFAULT_SERVER_NAME;
const factory = factoryDir(options["factory-dir"]);
const configFile = mcpConfigPath(factory);
const config = readMcpConfig(configFile);
const entry = config.mcpServers[name];

if (!entry) {
  console.log(`No "${name}" server in ${configFile}. Nothing to remove there.`);
} else if (!isOurEntry(entry) && !options.force) {
  console.error(`The "${name}" server in ${configFile} was not created by this tool. Use --force to remove it anyway.`);
  process.exit(1);
} else {
  const backup = backupFile(configFile, "codex-computer-use-uninstall");
  delete config.mcpServers[name];
  writeJsonAtomic(configFile, config);
  console.log(`Removed "${name}" from ${configFile}${backup ? ` (backup: ${backup})` : ""}`);
}

const installDir = path.join(factory, INSTALL_DIR_NAME);
if (fs.existsSync(installDir)) {
  fs.rmSync(installDir, { recursive: true, force: true });
  console.log(`Removed ${installDir}`);
}

const approvals = path.join(
  process.env.HOME,
  "Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json",
);
console.log(`\nApps approved for Computer Use are stored by Codex in:\n  ${approvals}`);
console.log(`This file is shared with the Codex app (CODEX_HOME ${codexHome(options["codex-home"])}), so it was left in place.`);
console.log("Delete it yourself to clear every saved app approval.");
