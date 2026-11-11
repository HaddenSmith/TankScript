import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { createBattleManager } from '../../backend/battles/manager.js';
import { removeStaleTankRunners } from '../../backend/tank-runner/client.js';

const exec = promisify(execFile);
const docker = (args) => exec('docker', args, { timeout: 10_000, maxBuffer: 32 * 1024 });
const listRunners = async () => (await docker([
  'container', 'ls', '--all', '--filter', 'label=tankscript.runner=1', '--format', '{{.Names}}',
])).stdout.trim().split('\n').filter(Boolean).sort();

test('authoritative manager runs all five official scripts and contains a community timeout in Docker', async () => {
  const before = await listRunners();
  const manager = createBattleManager({
    getTankById: async id => ({ id, name: 'Loop fixture', color: '#123456', code: 'while (true) {}' }),
  });
  try {
    const initial = await manager.start('pilot', {
      participants: [
        ...['easy', 'medium', 'hard', 'expert', 'overkill'].map(id => ({ type: 'official', id })),
        { type: 'community', id: 'loop-fixture' },
      ],
      arenaSize: 12, startingHealth: 3, speed: 0.125,
    });
    assert.equal(initial.state.arena.tanks.length, 6);
    assert.equal((await listRunners()).length, before.length + 1);
    let state;
    for (let attempt = 0; attempt < 100; attempt++) {
      state = manager.get('pilot', initial.id);
      if (state.state.tickCount >= 2 || state.phase === 'stopped') break;
      await delay(50);
    }
    assert.ok(state.state.tickCount >= 2);
    assert.ok(state.state.events.some(event => event.includes('Loop fixture: TankScript exceeded')));
    assert.ok(state.state.events.some(event => /moved|rotated|fired/.test(event)));
    assert.ok(!state.state.events.some(event => /^(Firefly|Bloodhound|Sidewinder|Prism|Checkmate).*: TankScript/.test(event)));
    await manager.stop('pilot', initial.id);
    assert.equal(manager.get('pilot', initial.id).phase, 'stopped');
  } finally {
    await manager.shutdown();
  }
  assert.deepEqual(await listRunners(), before);
});

test('stale cleanup removes only matching, aged containers that never started', async () => {
  const names = ['tankscript-runner-' + randomUUID(), 'unrelated-' + randomUUID()];
  try {
    for (const name of names) {
      await docker(['container', 'create', '--name', name, '--label', 'tankscript.runner=1',
        '--pull=never', '--network=none', '--read-only', 'tankscript-runner:local']);
    }
    await removeStaleTankRunners();
    assert.ok((await listRunners()).includes(names[0]));
    await removeStaleTankRunners(Date.now() + 61_000);
    const remaining = await listRunners();
    assert.ok(!remaining.includes(names[0]));
    assert.ok(remaining.includes(names[1]));
  } finally {
    for (const name of names) {
      await docker(['container', 'rm', name]).catch(error => {
        if (!/No such container/.test(error.stderr)) throw error;
      });
    }
  }
});
