import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readMongoUri } from '../backend/mongoConfig.js';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const databaseName = `tankscript_test_${randomBytes(10).toString('hex')}`;
const databaseNamePattern = /^tankscript_test_[a-f0-9]{20}$/;

if (!databaseNamePattern.test(databaseName) || databaseName === 'tankscript') {
  throw new Error('Refusing to run integration tests with an unsafe database name.');
}

async function run() {
  let exitCode = 1;
  let cleanupError;
  let client;
  let shouldCleanupDatabase = false;
  try {
    const requireFromService = createRequire(path.join(rootDirectory, '..', 'backend', 'package.json'));
    const { MongoClient } = requireFromService('mongodb');
    const connectionString = await readMongoUri(process.env.TANKSCRIPT_DB_CONFIG);
    client = new MongoClient(connectionString);
    await client.connect();
    await client.db(databaseName).command({ ping: 1 });
    shouldCleanupDatabase = true;
    console.log(`Using isolated MongoDB test database "${databaseName}".`);

    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      TANKSCRIPT_DB_NAME: databaseName,
    };
    const jestCli = path.join(rootDirectory, '..', 'node_modules', 'jest', 'bin', 'jest.js');
    const result = spawnSync(
      process.execPath,
      [jestCli, 'tests/integration', '--runInBand', ...process.argv.slice(2)],
      { cwd: path.join(rootDirectory, '..'), env: environment, stdio: 'inherit' },
    );
    exitCode = result.status ?? 1;
  } catch {
    console.error('MongoDB integration setup failed; connection details were suppressed.');
    exitCode = 1;
  } finally {
    if (client && shouldCleanupDatabase) {
      try {
        if (!databaseNamePattern.test(databaseName) || databaseName === 'tankscript') {
          throw new Error('Temporary database name failed cleanup verification.');
        }
        await client.db(databaseName).dropDatabase();
      } catch {
        cleanupError = true;
      }
    }
    if (client) {
      await client.close().catch(() => {
        cleanupError = true;
      });
    }
    if (cleanupError) {
      console.error(`Cleanup failed for temporary database "${databaseName}". Verify and remove it manually if appropriate.`);
      exitCode = 1;
    } else if (shouldCleanupDatabase) {
      console.log(`Temporary MongoDB test database "${databaseName}" was cleaned up.`);
    }
  }

  process.exitCode = exitCode;
}

await run();
