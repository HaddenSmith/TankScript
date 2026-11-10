import { createQuickJSTankRuntime } from './quickjsTankRuntime.js';
import { TankScriptRunnerError } from './tankScriptRunnerProtocol.js';

let runner;

self.onmessage = async ({ data }) => {
  const { id, type, source, snapshotJSON } = data;
  try {
    let result;
    if (type === 'initialize' && !runner) {
      runner = await createQuickJSTankRuntime(source);
      result = runner.timings;
    } else if (type === 'runTick' && runner) {
      result = runner.runTick(snapshotJSON);
    } else if (type === 'heapUsage' && runner) {
      result = runner.getHeapUsageBytes();
    } else if (type === 'dispose' && runner) {
      runner.dispose();
      runner = undefined;
    } else {
      throw new TankScriptRunnerError('WORKER_ERROR');
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    const code = error instanceof TankScriptRunnerError ? error.code : 'WORKER_ERROR';
    self.postMessage({ id, ok: false, code });
  }
};
