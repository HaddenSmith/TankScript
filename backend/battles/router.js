import express from 'express';
import { BattleError } from './manager.js';
import { hasKeys } from '../tank-runner/protocol.js';

export function createBattleRouter(manager, verifyAuth) {
  const router = express.Router();
  let windowStartedAt = 0;
  let requests = 0;
  const accounts = new Map();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!manager) return res.status(503).json({ code: 'BATTLES_DISABLED', msg: 'Server-hosted battles are disabled.' });

    const now = Date.now();
    if (now - windowStartedAt >= 1_000) {
      windowStartedAt = now;
      requests = 0;
    }
    if (++requests > 150) return tooManyRequests(res);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const site = req.get('Sec-Fetch-Site');
      const origin = req.get('Origin');
      if ((site && site !== 'same-origin' && site !== 'none') || (origin && !sameHost(origin, req.get('Host')))) {
        return res.status(403).json({ code: 'INVALID_ORIGIN', msg: 'Battle controls require a same-origin request.' });
      }
    }
    next();
  });
  router.use(verifyAuth);
  router.use((req, res, next) => {
    const owner = req.user.username;
    const now = Date.now();
    let usage = accounts.get(owner);
    if (!usage || now - usage.startedAt >= 10_000) {
      if (accounts.size >= 512) accounts.delete(accounts.keys().next().value);
      usage = { startedAt: now, requests: 0, starts: 0 };
      accounts.delete(owner);
      accounts.set(owner, usage);
    }
    if (++usage.requests > 160 || (req.method === 'POST' && req.path === '/' && ++usage.starts > 4)) {
      return tooManyRequests(res);
    }
    next();
  });
  router.use(express.json({ limit: '4kb' }));

  router.post('/', async (req, res) => {
    if (res.destroyed) return;
    const controller = new AbortController();
    const cancel = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once('close', cancel);
    try {
      const battle = await manager.start(req.user.username, req.body, { signal: controller.signal });
      if (!res.destroyed) res.status(201).json(battle);
    } catch (error) {
      if (!res.destroyed) throw error;
    } finally {
      res.removeListener('close', cancel);
    }
  });
  router.get('/:battleId/updates', (req, res) => {
    const { since } = req.query;
    const cursor = typeof since === 'string' && /^\d{1,10}$/.test(since) ? Number(since) : NaN;
    res.json(manager.updates(req.user.username, req.params.battleId, cursor));
  });
  router.get('/:battleId', (req, res) => {
    res.json(manager.get(req.user.username, req.params.battleId));
  });
  router.post('/:battleId/pause', (req, res) => {
    res.json(manager.pause(req.user.username, req.params.battleId));
  });
  router.post('/:battleId/resume', (req, res) => {
    res.json(manager.resume(req.user.username, req.params.battleId));
  });
  router.patch('/:battleId', (req, res) => {
    if (!hasKeys(req.body, ['speed'])) throw new BattleError(400, 'INVALID_SPEED', 'Provide only the new battle speed.');
    res.json(manager.setSpeed(req.user.username, req.params.battleId, req.body.speed));
  });
  router.delete('/:battleId', async (req, res) => {
    await manager.stop(req.user.username, req.params.battleId);
    res.status(204).end();
  });
  router.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', msg: 'Battle endpoint not found.' }));
  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof BattleError) {
      return res.status(error.status).json({ code: error.code, msg: error.message });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ code: 'BODY_TOO_LARGE', msg: 'Battle requests are limited to 4 KiB.' });
    }
    if (error.status >= 400 && error.status < 500) {
      return res.status(400).json({ code: 'INVALID_BODY', msg: 'The battle request body is invalid.' });
    }
    return res.status(500).json({ code: 'BATTLE_ERROR', msg: 'An unexpected battle error occurred.' });
  });
  return router;
}

function tooManyRequests(res) {
  return res.set('Retry-After', '10').status(429).json({ code: 'RATE_LIMIT', msg: 'Too many battle requests. Try again shortly.' });
}

function sameHost(origin, host) {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.host === host;
  } catch {
    return false;
  }
}
