import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

export const CONTAINER_MEMORY_BYTES = 384 * 1024 * 1024;
export const CONTAINER_PIDS = 32;

function read(path) {
  return readFileSync(path, 'utf8').trim();
}

export function requireContainerIsolation() {
  const status = read('/proc/self/status');
  const mounts = read('/proc/self/mountinfo');
  const root = mounts.split('\n').find(line => line.split(' ')[4] === '/');
  const [quota, period] = read('/sys/fs/cgroup/cpu.max').split(' ').map(Number);
  const memory = Number(read('/sys/fs/cgroup/memory.max'));
  const pids = Number(read('/sys/fs/cgroup/pids.max'));

  // Fail closed when the local Docker engine cannot enforce a required control.
  if (process.platform !== 'linux' || process.getuid() === 0 || process.getgid() === 0 ||
      Object.keys(process.env).length !== 0 ||
      !/^CapEff:\s+0+$/m.test(status) || !/^CapBnd:\s+0+$/m.test(status) ||
      !/^NoNewPrivs:\s+1$/m.test(status) || !/^Seccomp:\s+2$/m.test(status) ||
      !root?.split(' ')[5].split(',').includes('ro') ||
      Object.values(networkInterfaces()).flat().some(address => !address.internal) ||
      !(memory > 0 && memory <= CONTAINER_MEMORY_BYTES) ||
      read('/sys/fs/cgroup/memory.swap.max') !== '0' ||
      !(quota > 0 && period > 0 && quota <= period) ||
      !(pids > 0 && pids <= CONTAINER_PIDS)) {
    throw new Error('Required Linux container isolation is unavailable.');
  }
}

export function containerUsage() {
  const usage = read('/sys/fs/cgroup/cpu.stat').split('\n').find(line => line.startsWith('usage_usec '));
  return {
    peakBytes: existsSync('/sys/fs/cgroup/memory.peak') ? Number(read('/sys/fs/cgroup/memory.peak')) : null,
    cpuMs: Number(usage?.split(' ')[1]) / 1_000,
  };
}
