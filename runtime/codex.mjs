// Locates the Codex desktop app and the computer-use MCP server it ships.
// Shared by the runtime proxy and the setup scripts. No dependencies.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CODEX_BUNDLE_ID = "com.openai.codex";
const PLUGIN_NAME = "unified-computer-use";
const HELPER_APP_NAME = "Codex Computer Use.app";

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

export const bundledNodePath = (appPath) =>
  path.join(appPath, "Contents", "Resources", "cua_node", "bin", "node");

const isCodexApp = (appPath) => Boolean(appPath) && exists(bundledNodePath(appPath));

function spotlightCandidates() {
  try {
    const out = execFileSync("/usr/bin/mdfind", [`kMDItemCFBundleIdentifier == '${CODEX_BUNDLE_ID}'`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function findCodexApp(explicit) {
  if (explicit) {
    if (isCodexApp(explicit)) return path.resolve(explicit);
    throw new Error(
      `${explicit} is not a Codex app with Computer Use support (missing ${bundledNodePath(explicit)}).`,
    );
  }
  const candidates = [
    process.env.CODEX_APP_PATH,
    ...spotlightCandidates(),
    "/Applications/ChatGPT.app",
    "/Applications/Codex.app",
    path.join(os.homedir(), "Applications", "ChatGPT.app"),
    path.join(os.homedir(), "Applications", "Codex.app"),
  ];
  const found = candidates.find(isCodexApp);
  if (!found) {
    throw new Error(
      "Could not find the Codex desktop app. Install it, or pass its path with --codex-app (or CODEX_APP_PATH).",
    );
  }
  return found;
}

export const codexHome = (explicit) =>
  path.resolve(explicit || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));

export const helperAppPath = (home) => path.join(home, "computer-use", HELPER_APP_NAME);

export function appVersion(appPath) {
  try {
    return execFileSync(
      "/usr/bin/plutil",
      ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", path.join(appPath, "Contents", "Info.plist")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return undefined;
  }
}

// The Codex app writes a fully resolved server definition for its computer-use
// plugin into its plugin cache. Prefer that, because it carries whatever
// environment the installed Codex version expects.
function findManifest(home, version) {
  const cacheRoot = path.join(home, "plugins", "cache");
  const manifests = [];
  for (const marketplace of safeReaddir(cacheRoot)) {
    const pluginDir = path.join(cacheRoot, marketplace, PLUGIN_NAME);
    for (const versionDir of safeReaddir(pluginDir)) {
      const file = path.join(pluginDir, versionDir, ".mcp.json");
      if (exists(file)) manifests.push({ file, versionDir, mtime: fs.statSync(file).mtimeMs });
    }
  }
  manifests.sort((a, b) => b.mtime - a.mtime);
  return manifests.find((m) => m.versionDir === version) ?? manifests[0];
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function serverFromManifest(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const servers = parsed?.mcpServers ?? {};
  const server = servers.cua_repl ?? Object.values(servers)[0];
  if (!server?.command || !Array.isArray(server.args)) return undefined;
  if (!exists(server.command) || (server.args[0] && !exists(server.args[0]))) return undefined;
  return { command: server.command, args: server.args, env: server.env ?? {} };
}

// Mirrors the environment the Codex app generates. Used when the plugin cache
// has no usable manifest (for example, Computer Use was never opened in Codex).
export function deriveServer(appPath, home) {
  const resources = path.join(appPath, "Contents", "Resources");
  const cuaNode = path.join(resources, "cua_node");
  const nodeModules = path.join(cuaNode, "lib", "node_modules");
  const node = path.join(cuaNode, "bin", "node");
  return {
    command: node,
    args: [path.join(nodeModules, "@oai", "cua-repl", "bin", "cua-repl.mjs")],
    env: {
      NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS: "1000",
      NODE_REPL_NODE_MODULE_DIRS: nodeModules,
      NODE_REPL_NODE_PATH: node,
      NODE_REPL_TRUSTED_CODE_PATHS: `${home}:${nodeModules}`,
      CODEX_HOME: home,
      BROWSER_USE_AVAILABLE_BACKENDS: "chrome,iab,mcpapps",
      BROWSER_USE_TINYSKY_ENABLED: "1",
      NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER: "Control the in-app browser in conjunction with the Browser Plugin.",
      NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME:
        "Control the Chrome browser in conjunction with the Chrome Plugin. Prefer this method of controlling Chrome over alternatives (such as Computer Use) unless the user explicitly mentions an alternative.",
      NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE: "Control desktop apps on macOS through Computer Use.",
      BROWSER_USE_CODEX_APP_BUILD_FLAVOR: "prod",
      BROWSER_USE_CODEX_APP_VERSION: appVersion(appPath) ?? "",
      NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser: "@oai/browser-desktop/service", sky: "@oai/sky/service" }),
      SKY_CUA_SERVICE_PATH: helperAppPath(home),
      CODEX_CLI_PATH: path.join(resources, "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"),
      CUA_REPL_NODE_REPL_PATH: path.join(cuaNode, "bin", "node_repl"),
      CUA_REPL_ENABLED_SURFACES: "browser,computer",
    },
  };
}

export function resolveServer({ appPath, home }) {
  const version = appVersion(appPath);
  const manifest = findManifest(home, version);
  if (manifest) {
    const server = serverFromManifest(manifest.file);
    if (server) return { ...server, source: "codex-manifest", manifestPath: manifest.file, version };
  }
  const derived = deriveServer(appPath, home);
  if (!exists(derived.args[0]) || !exists(derived.env.CUA_REPL_NODE_REPL_PATH)) {
    throw new Error(
      `This Codex app build does not include the computer-use runtime (${derived.args[0]}). Update the Codex app.`,
    );
  }
  return { ...derived, source: "derived", version };
}
