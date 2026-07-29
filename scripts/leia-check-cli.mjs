import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const LOG_TAIL_LINES = 120;
const LOG_TAIL_CHARACTERS = 16_000;

async function read(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export function parseRecords(contents) {
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function formatLogTail(contents) {
  const lines = contents.trimEnd().split('\n');
  if (lines.length === 1 && lines[0] === '') return '\n\nlog was empty';

  const selected = lines.slice(-LOG_TAIL_LINES);
  const omitted = lines.length - selected.length;
  const label = omitted > 0 ? `last ${selected.length} log lines` : 'log output';
  const tail = selected.join('\n').slice(-LOG_TAIL_CHARACTERS);
  return `\n\n${label}:\n${tail}`;
}

function processIsRunning(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForText(path, expected, count, timeoutSeconds, processId) {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    const contents = await read(path);
    if (contents.split(expected).length - 1 >= count) return;
    if (processId !== undefined && !processIsRunning(processId)) {
      throw new Error(
        `process ${processId} exited while waiting for ${count} occurrence(s) of ${expected} in ${path}${formatLogTail(contents)}`,
      );
    }
    await delay(250);
  }
  const contents = await read(path);
  throw new Error(
    `timed out waiting for ${count} occurrence(s) of ${expected} in ${path}${processId === undefined ? '' : formatLogTail(contents)}`,
  );
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

export function assertBlockedResult(result, label = 'result') {
  if (result.blocked !== true || result.kind !== 'veto') {
    throw new Error(`${label} did not contain a terminal blocked tool outcome`);
  }
}

export function assertDenyLogContents(contents) {
  const events = parseRecords(contents);
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
  if (contents.includes('leia-sensitive-value')) {
    throw new Error('deny log exposed the seeded tool environment secret');
  }
  if (
    attempted.some(
      ({ environment }) =>
        !environment?.toolArguments?.some(
          ({ name, redacted }) => name === 'DEVGUARD_TEST_SECRET' && redacted === true,
        ),
    )
  ) {
    throw new Error('deny log did not mark the seeded tool environment secret as redacted');
  }
  if (
    attempted.some(
      ({ agentId, pluginBuildId, pluginId, runId, sessionKey, toolCallId }) =>
        agentId !== 'leia-agent' ||
        !pluginBuildId ||
        pluginId !== 'devguard-example' ||
        runId !== 'leia-run' ||
        sessionKey !== 'agent:leia:main' ||
        !toolCallId,
    )
  ) {
    throw new Error('deny log did not retain the expected tool-call correlation fields');
  }
}

export function assertRestartEvents(events) {
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

async function assertBlocked(path) {
  assertBlockedResult(JSON.parse(await readFile(path, 'utf8')), path);
}

async function assertDenyLog(path) {
  assertDenyLogContents(await readFile(path, 'utf8'));
}

async function assertRestartLog(path) {
  assertRestartEvents(parseRecords(await readFile(path, 'utf8')));
}

export async function main(args = process.argv.slice(2)) {
  const [action, ...actionArgs] = args;

  switch (action) {
    case 'wait-text':
      await waitForText(
        actionArgs[0],
        actionArgs[1],
        Number(actionArgs[2] ?? 1),
        Number(actionArgs[3] ?? 60),
        actionArgs[4] === undefined ? undefined : Number(actionArgs[4]),
      );
      break;
    case 'wait-exit':
      await waitForExit(Number(actionArgs[0]), Number(actionArgs[1] ?? 20));
      break;
    case 'assert-jsonl':
      if (parseRecords(await readFile(actionArgs[0], 'utf8')).length === 0) {
        throw new Error(`${actionArgs[0]} did not contain JSONL records`);
      }
      break;
    case 'assert-blocked':
      await assertBlocked(actionArgs[0]);
      break;
    case 'assert-deny-log':
      await assertDenyLog(actionArgs[0]);
      break;
    case 'assert-restart-log':
      await assertRestartLog(actionArgs[0]);
      break;
    default:
      throw new Error(`unknown example check: ${String(action)}`);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) await main();
