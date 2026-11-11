const { spawn } = require('node:child_process');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const path = require('node:path');

const rootDirectory = path.resolve(__dirname, '../..');
const serviceDirectory = path.join(rootDirectory, 'backend');
const safeDatabaseName = /^tankscript_test_[a-z0-9_]{1,22}$/;
let serviceProcess;
let serviceUrl;

async function startLiveService() {
  const databaseName = process.env.TANKSCRIPT_DB_NAME;
  if (!safeDatabaseName.test(databaseName ?? '') || databaseName === 'tankscript') {
    throw new Error(
      'Integration tests require TANKSCRIPT_DB_NAME=tankscript_test_<unique-id>; refusing to start the backend.',
    );
  }
  if (serviceProcess) throw new Error('The integration test service is already running.');

  const port = await getAvailablePort();
  serviceUrl = `http://127.0.0.1:${port}`;
  serviceProcess = spawn(
    process.execPath,
    ['index.js', String(port)],
    {
      cwd: serviceDirectory,
      env: { ...process.env, NODE_ENV: 'test', TANKSCRIPT_DB_NAME: databaseName },
      stdio: 'ignore',
    },
  );

  try {
    await waitForService();
    return serviceUrl;
  } catch (error) {
    await stopLiveService();
    throw error;
  }
}

async function stopLiveService() {
  if (!serviceProcess) return;

  const child = serviceProcess;
  serviceProcess = undefined;
  serviceUrl = undefined;
  if (child.exitCode !== null) return;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The integration test backend did not stop in time.'));
    }, 5000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForService() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (serviceProcess.exitCode !== null) {
      throw new Error('The integration test backend exited before becoming ready.');
    }

    try {
      const response = await fetch(`${serviceUrl}/api/test`);
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }

  throw new Error('The integration test backend did not become ready in 15 seconds.');
}

module.exports = { startLiveService, stopLiveService };
