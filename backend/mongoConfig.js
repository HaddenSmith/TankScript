import { readFile } from 'node:fs/promises';

export async function readMongoUri(configFile = new URL('./dbConfig.json', import.meta.url)) {
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  if (typeof config.uri === 'string' && /^mongodb(?:\+srv)?:\/\//.test(config.uri)) return config.uri;
  if (config.userName && config.password && config.hostname) {
    return `mongodb+srv://${encodeURIComponent(config.userName)}:${encodeURIComponent(config.password)}@${config.hostname}`;
  }
  throw new Error('Incomplete MongoDB configuration.');
}
