import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

// UI-only fixture, not a substitute for Express validation or MongoDB tests.
export async function startTankWorkflowFixture() {
  const tanks = new Map();
  let account;
  let nextId = 1;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://fixture.invalid').pathname;
    response.setHeader('Content-Type', 'application/json');
    function reply(status, body) {
      response.writeHead(status);
      response.end(body === undefined ? undefined : JSON.stringify(body));
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : {};
    if (path === '/api/auth/me') return reply(account ? 200 : 401, account ?? {});
    if (path === '/api/auth/create') {
      account = { username: body.username, email: body.email };
      return reply(201, account);
    }
    if (request.method === 'GET' && ['/api/tanks', '/api/tanks/all'].includes(path)) {
      // Include dormant Java to also exercise the frontend's independent filter.
      return reply(200, [...tanks.values()]);
    }
    if (request.method === 'POST' && path === '/api/tanks') {
      const tank = { ...body.tank, id: 'fixture-' + nextId++, ownerUsername: account.username };
      tanks.set(tank.id, tank);
      return reply(201, tank);
    }
    const id = path.startsWith('/api/tanks/') ? path.slice('/api/tanks/'.length) : null;
    if (tanks.has(id) && request.method === 'PUT') {
      const tank = { ...tanks.get(id), ...body.tank };
      tanks.set(id, tank);
      return reply(200, tank);
    }
    if (tanks.has(id) && request.method === 'DELETE') {
      tanks.delete(id);
      return reply(204);
    }
    reply(404, {});
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', socket => socket.send(JSON.stringify({ type: 'online-count', count: 1 })));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    tanks,
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise(resolve => sockets.close(resolve));
      await new Promise(resolve => server.close(resolve));
    },
  };
}
