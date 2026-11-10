import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { startDockerTankRunner } from './client.js';
import { CONTAINER_MEMORY_BYTES, CONTAINER_PIDS } from './isolation.js';

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
  await assert.rejects(docker('docker', ['container', 'inspect', name], options),
    error => /No such (container|object)/.test(error.stderr));
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

      // This trusted diagnostic checks the OS boundary with a dummy host file.
      const probe = `
        const assert = require('node:assert/strict');
        const { existsSync } = require('node:fs');
        assert.equal(existsSync(process.argv[1]), false);
        assert.equal(existsSync('/var/run/docker.sock'), false);
        assert.ok(Object.values(require('node:os').networkInterfaces()).flat().every(item => item.internal));
      `;
      await docker('docker', ['container', 'exec', runner.containerName,
        '/usr/bin/env', '-i', '/usr/local/bin/node', '--eval', probe, marker], options);
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
