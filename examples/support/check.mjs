import { readFile } from 'node:fs/promises';

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function read(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function records(contents) {
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForText(path, expected, count, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    const contents = await read(path);
    if (contents.split(expected).length - 1 >= count) return;
    await delay(250);
  }
  throw new Error(`timed out waiting for ${count} occurrence(s) of ${expected} in ${path}`);
}

async function waitForExit(pid, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(250);
  }
  throw new Error(`process ${pid} did not exit within ${timeoutSeconds} seconds`);
}

async function assertBlocked(path) {
  const result = JSON.parse(await readFile(path, 'utf8'));
  if (result.blocked !== true || result.kind !== 'veto') {
    throw new Error(`${path} did not contain a terminal blocked tool outcome`);
  }
}

async function assertDenyLog(path) {
  const events = records(await readFile(path, 'utf8'));
  const attempted = events.filter(({ event }) => event === 'tool_call_attempted');
  const blocked = events.filter(({ event }) => event === 'tool_call_blocked');
  const expectedTools = new Set(['exec', 'write', 'totally-unknown-tool']);
  const observedTools = new Set(attempted.map(({ toolName }) => toolName));
  if (attempted.length !== 3 || blocked.length !== 3) {
    throw new Error(
      `expected 3 attempted and blocked calls, got ${attempted.length}/${blocked.length}`,
    );
  }
  if ([...expectedTools].some((toolName) => !observedTools.has(toolName))) {
    throw new Error('deny log did not contain every expected tool category');
  }
  if (blocked.some(({ decision }) => decision !== 'blocked')) {
    throw new Error('deny log contained a non-blocking terminal decision');
  }
}

async function assertRestartLog(path) {
  const events = records(await readFile(path, 'utf8'));
  const builds = events.filter(({ event }) => event === 'build_succeeded');
  const loaded = events.filter(({ event }) => event === 'target_plugin_loaded');
  const restarted = events.filter(({ event }) => event === 'gateway_restart_requested');
  const failed = events.filter(({ event }) =>
    [
      'build_failed',
      'gateway_exited',
      'gateway_start_failed',
      'target_plugin_load_failed',
    ].includes(event),
  );
  const buildIds = new Set(builds.map(({ pluginBuildId }) => pluginBuildId));
  if (builds.length < 2 || loaded.length < 2 || restarted.length < 1 || buildIds.size < 2) {
    throw new Error('restart log did not contain two distinct verified build lifecycles');
  }
  if (failed.length > 0) throw new Error(`restart log contained ${failed.length} failure event(s)`);
}

const [action, ...args] = process.argv.slice(2);

switch (action) {
  case 'wait-text':
    await waitForText(args[0], args[1], Number(args[2] ?? 1), Number(args[3] ?? 60));
    break;
  case 'wait-exit':
    await waitForExit(Number(args[0]), Number(args[1] ?? 20));
    break;
  case 'assert-jsonl':
    if (records(await readFile(args[0], 'utf8')).length === 0) {
      throw new Error(`${args[0]} did not contain JSONL records`);
    }
    break;
  case 'assert-blocked':
    await assertBlocked(args[0]);
    break;
  case 'assert-deny-log':
    await assertDenyLog(args[0]);
    break;
  case 'assert-restart-log':
    await assertRestartLog(args[0]);
    break;
  default:
    throw new Error(`unknown example check: ${String(action)}`);
}
