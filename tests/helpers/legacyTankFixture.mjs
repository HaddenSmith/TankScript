import { MongoClient } from 'mongodb';
import { readMongoUri } from '../../backend/mongoConfig.js';

const databaseName = process.env.TANKSCRIPT_DB_NAME;
const tankId = process.argv[2];
if (!/^tankscript_test_[a-z0-9_]{1,22}$/.test(databaseName ?? '') || !tankId) {
  throw new Error('Legacy fixtures require an isolated test database and tank ID.');
}

let client;
try {
  client = new MongoClient(await readMongoUri(process.env.TANKSCRIPT_DB_CONFIG));
  await client.connect();
  const result = await client.db(databaseName).collection('tanks').updateOne(
    { id: tankId }, { $unset: { language: 1 } },
  );
  if (result.matchedCount !== 1) throw new Error('Missing fixture');
} catch {
  console.error('Could not prepare the legacy tank in the isolated test database.');
  process.exitCode = 1;
} finally {
  await client?.close();
}
