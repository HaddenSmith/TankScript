import { describe, expect, test } from '@jest/globals';
import { startLiveService } from '../helpers/liveService.cjs';

describe('MongoDB integration safeguards', () => {
  test.each([undefined, '', 'tankscript'])(
    'refuses to start the backend without a test-only database name (%s)',
    async (databaseName) => {
      const previousName = process.env.TANKSCRIPT_DB_NAME;
      if (databaseName === undefined) delete process.env.TANKSCRIPT_DB_NAME;
      else process.env.TANKSCRIPT_DB_NAME = databaseName;

      try {
        await expect(startLiveService()).rejects.toThrow('refusing to start the backend');
      } finally {
        if (previousName === undefined) delete process.env.TANKSCRIPT_DB_NAME;
        else process.env.TANKSCRIPT_DB_NAME = previousName;
      }
    },
  );
});
