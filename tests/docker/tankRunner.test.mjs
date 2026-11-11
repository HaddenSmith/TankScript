import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { TANK_SCRIPT_ACTIONS } from '../../shared/game/tank-script/tankScriptRunnerProtocol.js';
import { startDockerTankRunner } from '../../backend/tank-runner/client.js';
import { CONTAINER_MEMORY_BYTES, CONTAINER_PIDS } from '../../backend/tank-runner/isolation.js';
import { MAX_REQUEST_BYTES } from '../../backend/tank-runner/protocol.js';

const docker = promisify(execFile);
const options = { timeout: 10_000, maxBuffer: 64 * 1024 };
const tanks = [{ tankId: 17, source: `
  if (typeof process === 'undefined' && typeof require === 'undefined' &&
      typeof fetch === 'undefined' && typeof db === 'undefined') shoot();
` }];
const snapshot = {
  tankId: 17,
  tankPosition: { x: 2, y: 3 },
  tankRotation: 0,
  tankHealth: 3,
  allTanks: [{ id: 17, name: 'Fixture', x: 2, y: 3, rotation: 0, health: 3 }],
  allBullets: [],
  arenaWidth: 8,
  arenaHeight: 8,
};

async function assertRemoved(name) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await docker('docker', ['container', 'inspect', name], options);
    } catch (error) {
      if (/No such (container|object)/.test(error.stderr)) return;
      throw error;
    }
    await delay(100);
  }
  assert.fail('Docker did not remove ' + name);
}

function execInRunner(name, source, ...args) {
  return docker('docker', ['container', 'exec', name,
    '/usr/bin/env', '-i', '/usr/local/bin/node', '--eval', source, ...args], options);
}

test('enforces Docker isolation and removes containers after disposal and cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tankscript-host-fixture-'));
  const marker = join(directory, 'dummy-secret.txt');
  try {
    await writeFile(marker, 'dummy fixture only');
    const runner = await startDockerTankRunner(tanks);
    try {
      const { stdout } = await docker('docker', ['container', 'inspect', runner.containerName], options);
      const [info] = JSON.parse(stdout);
      const { HostConfig: config } = info;
      assert.equal(info.Config.User, '10001:10001');
      assert.equal(config.NetworkMode, 'none');
      assert.equal(config.ReadonlyRootfs, true);
      assert.equal(config.Privileged, false);
      assert.ok(config.CapDrop.includes('ALL'));
      assert.ok(config.SecurityOpt.some(option => /^no-new-privileges[=:]true$/.test(option)));
      assert.equal(config.Memory, CONTAINER_MEMORY_BYTES);
      assert.equal(config.MemorySwap, CONTAINER_MEMORY_BYTES);
      assert.equal(config.NanoCpus, 1_000_000_000);
      assert.equal(config.PidsLimit, CONTAINER_PIDS);
      assert.equal(config.AutoRemove, true);
      assert.deepEqual(info.Mounts, []);

      // This trusted diagnostic runs with the same OS restrictions as the runner.
      const probe = `
        const assert = require('node:assert/strict');
        const { existsSync, readFileSync, writeFileSync } = require('node:fs');
        const runnerPid = readFileSync('/proc/1/task/1/children', 'utf8').trim();
        assert.equal(readFileSync('/proc/' + runnerPid + '/environ').length, 0);
        assert.equal(existsSync(process.argv[1]), false);
        assert.equal(existsSync('/var/run/docker.sock'), false);
        assert.throws(() => writeFileSync('/runner/dummy.txt', 'fixture'), { code: 'EROFS' });
        assert.ok(Object.values(require('node:os').networkInterfaces()).flat().every(item => item.internal));
        assert.equal(readFileSync('/proc/net/route', 'utf8').trim().split('\\n').length, 1);
      `;
      await execInRunner(runner.containerName, probe, marker);
      assert.deepEqual((await runner.runTick([snapshot])).results, [{ tankId: 17, command: { action: 'shoot' } }]);
      assert.ok((await runner.getStats()).container.cpuMs >= 0);
    } finally {
      await runner.dispose();
    }
    await assertRemoved(runner.containerName);

    const controller = new AbortController();
    const cancelled = await startDockerTankRunner([
      { tankId: 17, source: 'while (true) {}' },
    ], { signal: controller.signal });
    try {
      const tick = cancelled.runTick([snapshot]);
      controller.abort();
      await assert.rejects(tick, { code: 'DISPOSED' });
    } finally {
      await cancelled.dispose();
    }
    await assertRemoved(cancelled.containerName);
  } finally {
    await unlink(marker).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rmdir(directory);
  }
});

test('runs every action and contains guest failures in the same container', async () => {
  const fixtures = [
    ...TANK_SCRIPT_ACTIONS.map(action => [action + '(); shoot();', action]),
    ['return {', 'COMPILE_ERROR'],
    ['while (true) {}', 'EXECUTION_TIMEOUT'],
    ['function recurse() { return 1 + recurse(); } recurse();', 'RUNTIME_ERROR'],
    ['new ArrayBuffer(32 * 1024 * 1024);', 'RUNTIME_ERROR'],
    ['throw new Error("fixture");', 'RUNTIME_ERROR'],
  ];
  const participants = fixtures.map(([source], index) => ({ tankId: index + 1, source }));
  const runner = await startDockerTankRunner(participants);
  try {
    const { results } = await runner.runTick(participants.map(({ tankId }) => ({ ...snapshot, tankId })));
    assert.deepEqual(results.map(({ command, error }) => command?.action ?? error?.code),
      fixtures.map(([, expected]) => expected));
    assert.deepEqual((await runner.runTick([{ ...snapshot, tankId: 1 }])).results,
      [{ tankId: 1, command: { action: fixtures[0][1] } }]);
  } finally {
    await runner.dispose();
  }
  await assertRemoved(runner.containerName);
});

test('force-removes an unresponsive runner after the caller deadline', async () => {
  const runner = await startDockerTankRunner(tanks);
  try {
    // Suspend the Node process to simulate a hang outside the QuickJS timer.
    await execInRunner(runner.containerName, `
      const { readFileSync } = require('node:fs');
      const runnerPid = Number(readFileSync('/proc/1/task/1/children', 'utf8').trim());
      if (runnerPid > 1) process.kill(runnerPid, 'SIGSTOP');
    `);
    await assert.rejects(runner.runTick([snapshot]), { code: 'RUNNER_TIMEOUT' });
  } finally {
    await runner.dispose();
  }
  await assertRemoved(runner.containerName);
});

test('rejects malformed and oversized IPC inside the restricted container', async () => {
  const runner = await startDockerTankRunner(tanks);
  try {
    // Use a second runner process so the trusted diagnostic can feed raw frames.
    await execInRunner(runner.containerName, `
      const assert = require('node:assert/strict');
      const { spawnSync } = require('node:child_process');
      const initialize = JSON.stringify({ id: 1, type: 'initialize', tanks: ${JSON.stringify(tanks)} }) + '\\n';
      const dispose = JSON.stringify({ id: 2, type: 'dispose' }) + '\\n';
      function run(input) {
        const result = spawnSync(process.execPath, ['/runner/backend/tank-runner/runner.js', '--container'],
          { input, env: {}, encoding: 'utf8', timeout: 3000 });
        if (result.error) throw result.error;
        return result;
      }
      const valid = run(initialize + dispose);
      assert.equal(valid.status, 0);
      assert.ok(valid.stdout.trim().split('\\n').every(line => JSON.parse(line).ok === true));
      for (const input of ['not-json\\n', 'x'.repeat(${MAX_REQUEST_BYTES} + 1) + '\\n']) {
        const invalid = run(input);
        assert.equal(invalid.status, 1);
        assert.equal(invalid.stdout, '');
      }
    `);
    assert.deepEqual((await runner.runTick([snapshot])).results, [{ tankId: 17, command: { action: 'shoot' } }]);
  } finally {
    await runner.dispose();
  }
  await assertRemoved(runner.containerName);
});

test('Docker removes a started container when the caller is killed', async () => {
  const clientUrl = new URL('../../backend/tank-runner/client.js', import.meta.url);
  const caller = `
    import { writeSync } from 'node:fs';
    import { startDockerTankRunner } from ${JSON.stringify(clientUrl.href)};
    const runner = await startDockerTankRunner(${JSON.stringify(tanks)});
    writeSync(1, runner.containerName);
    process.kill(process.pid, 'SIGKILL');
  `;
  let name;
  try {
    await assert.rejects(docker(process.execPath, ['--input-type=module', '--eval', caller], options), error => {
      const reportedName = error.stdout?.trim();
      if (/^tankscript-runner-[\da-f-]{36}$/.test(reportedName)) name = reportedName;
      return error.signal === 'SIGKILL' && Boolean(name);
    });
    await assertRemoved(name);
  } finally {
    if (name) {
      await docker('docker', ['container', 'rm', '--force', name], options).catch(error => {
        if (!/No such container|removal of container .* is already in progress/.test(error.stderr)) throw error;
      });
    }
  }
});
