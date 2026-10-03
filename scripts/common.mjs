import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SERVER_NAME = "computer-use";
export const INSTALL_DIR_NAME = "codex-computer-use";
export const LAUNCHER_FILE = "launcher.mjs";

export function parseArgs(argv, spec) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    const [flag, inline] = arg.split(/=(.*)/s, 2);
    const key = flag.replace(/^--/, "");
    if (!(key in spec)) throw new Error(`Unknown option: ${arg}`);
    if (spec[key] === "boolean") {
      options[key] = true;
    } else {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${flag}`);
      options[key] = value;
    }
  }
  return options;
}

export const factoryDir = (explicit) =>
  path.resolve(explicit || process.env.FACTORY_HOME || path.join(os.homedir(), ".factory"));

export const mcpConfigPath = (dir) => path.join(dir, "mcp.json");

export function readMcpConfig(file) {
  if (!fs.existsSync(file)) return { mcpServers: {} };
  const text = fs.readFileSync(file, "utf8");
  if (text.trim() === "") return { mcpServers: {} };
  const config = JSON.parse(text);
  config.mcpServers ??= {};
  return config;
}

export function backupFile(file, label) {
  if (!fs.existsSync(file)) return undefined;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const backup = `${file}.bak-${label}-${stamp}`;
  fs.copyFileSync(file, backup);
  return backup;
}

export function writeJsonAtomic(file, data, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode });
  fs.renameSync(tmp, file);
}

export const isOurEntry = (entry) =>
  Array.isArray(entry?.args) && entry.args.some((arg) => typeof arg === "string" && arg.includes(`${INSTALL_DIR_NAME}/${LAUNCHER_FILE}`));
