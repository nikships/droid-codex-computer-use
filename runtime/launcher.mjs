#!/usr/bin/env node
// Stdio MCP launcher that runs the Codex computer-use server for non-Codex
// clients such as Factory Droid. It sits between the client and the server and:
//   1. Advertises MCP form-elicitation support, then auto-accepts every
//      approval elicitation (with "always" persistence) so no form is shown.
//   2. Adds the Codex turn metadata (`x-codex-turn-metadata`) that the browser
//      surface requires on each tool call.
// The server definition is resolved at every start, so Codex app updates are
// picked up without reinstalling.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { codexHome, findCodexApp, resolveServer } from "./codex.mjs";

const TURN_METADATA_KEY = "x-codex-turn-metadata";

let server;
try {
  const appPath = findCodexApp(process.env.CODEX_APP_PATH);
  server = resolveServer({ appPath, home: codexHome(process.env.CODEX_HOME) });
} catch (error) {
  process.stderr.write(`codex-computer-use: ${error.message}\n`);
  process.exit(1);
}

const child = spawn(server.command, server.args, {
  env: { ...process.env, ...server.env },
  stdio: ["pipe", "pipe", "inherit"],
});
child.on("error", (error) => {
  process.stderr.write(`codex-computer-use: failed to start server: ${error.message}\n`);
  process.exit(1);
});

const sessionId = crypto.randomUUID();
let turnId = crypto.randomUUID();

function onLines(stream, handle) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim() !== "") handle(line);
    }
  });
}

function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

const write = (stream, message) => stream.write(`${typeof message === "string" ? message : JSON.stringify(message)}\n`);

function withTurnMetadata(params) {
  const meta = { ...(params._meta ?? {}) };
  if (meta[TURN_METADATA_KEY] == null) {
    meta[TURN_METADATA_KEY] = JSON.stringify({
      session_id: sessionId,
      thread_id: sessionId,
      turn_id: turnId,
      call_id: crypto.randomUUID(),
    });
  }
  return { ...params, _meta: meta };
}

onLines(process.stdin, (line) => {
  const message = parse(line);
  if (message?.method === "initialize" && message.params) {
    message.params.capabilities = { ...(message.params.capabilities ?? {}), elicitation: { form: {} } };
    write(child.stdin, message);
    return;
  }
  if (message?.method === "tools/call" && message.params) {
    message.params = withTurnMetadata(message.params);
    write(child.stdin, message);
    // The server treats `turn_ended` as the end of a Codex turn, so later calls
    // belong to a new turn.
    if (message.params.name === "turn_ended") turnId = crypto.randomUUID();
    return;
  }
  write(child.stdin, line);
});

onLines(child.stdout, (line) => {
  const message = parse(line);
  if (message?.method === "elicitation/create" && message.id !== undefined) {
    write(child.stdin, {
      jsonrpc: "2.0",
      id: message.id,
      result: { action: "accept", content: {}, _meta: { persist: "always" } },
    });
    return;
  }
  write(process.stdout, line);
});

process.stdin.on("end", () => child.stdin.end());
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
