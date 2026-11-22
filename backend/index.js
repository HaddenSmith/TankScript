import cookieParser from 'cookie-parser';
import { extname, resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import * as database from './database.js';

const app = express();
app.disable('x-powered-by');

const authCookieName = 'token';

// The service port. In production the front-end code is statically hosted by the service on the same port.
const port = process.argv.length > 2 ? process.argv[2] : 4000;

const production = process.env.NODE_ENV === 'production';
// A client payload or frontend build flag cannot enable Java persistence in production.
const experimentalJava = process.env.NODE_ENV === 'development' && process.env.VITE_EXPERIMENTAL_JAVA === 'true';
app.use(cookieParser());

// JSON body parsing using built-in middleware
app.use(express.json());
app.use((req, _res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
  
  next();
});

// Serve up the front-end static content hosting
const publicDirectory = resolve('public');
app.use(express.static(publicDirectory));
app.use('/assets', (_req, res) => res.sendStatus(404));

// Router for service endpoints
const apiRouter = express.Router();
app.use('/api', apiRouter);

// Test endpoint
apiRouter.get('/test', (_req, res) => {
  res.send({ message: 'TankScript service is running' });
});

let databaseReady = true; // Startup already verified connectivity.
let nextDatabaseCheck = 0;
let databaseCheck;
apiRouter.get('/health', async (_req, res) => {
  if (Date.now() >= nextDatabaseCheck) {
    databaseCheck ??= database.pingDatabase().then(
      () => { databaseReady = true; },
      () => { databaseReady = false; },
    ).finally(() => {
      nextDatabaseCheck = Date.now() + 10_000;
      databaseCheck = null;
    });
    await databaseCheck;
  }
  res.set('Cache-Control', 'no-store').status(databaseReady ? 200 : 503).json({
    express: 'ready',
    database: databaseReady ? 'ready' : 'unavailable',
  });
});

// CreateAuth a new user
apiRouter.post('/auth/create', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !username || !password) {
    return res.status(400).send({ msg: 'Email, username, and password are required.' });
  }

  if (username.length < 3 || username.length > 24) {
    return res.status(400).send({ msg: 'Username must be between 3 and 24 characters.' });
  }

  if (!/^[A-Za-z0-9_-]+$/.test(username)) {
    return res.status(400).send({ msg: 'Username may only contain letters, numbers, underscores, and hyphens.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).send({ msg: 'Please enter a valid email address.' });
  }

  if (password.length < 7) {
    return res.status(400).send({ msg: 'Password must be at least 7 characters.' });
  }

  if (password.length > 128) {
    return res.status(400).send({ msg: 'Password must be no more than 128 characters.' });
  }

  if (body.confirmPassword !== undefined && body.confirmPassword !== password) {
    return res.status(400).send({ msg: 'Passwords do not match.' });
  }

  if (await database.getUserByEmail(email)) {
    return res.status(409).send({ msg: 'An account already exists with this email.' });
  }

  if (await database.getUserByUsername(username)) {
    return res.status(409).send({ msg: 'This username is already taken.' });
  }

  let user;
  try {
    user = await createUser(email, username, password);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).send({ msg: 'An account already exists with this email or username.' });
    }
    throw error;
  }

  setAuthCookie(res, user.token);

  res.status(201).send({
    email: user.email,
    username: user.username,
  });
});

// GetAuth login an existing user
apiRouter.post('/auth/login', async (req, res) => {
  const { loginIdentifier, password } = req.body;
  if (typeof loginIdentifier !== 'string' || !loginIdentifier.trim() ||
      typeof password !== 'string' || !password) {
    return res.status(400).send({ msg: 'Username or email and password are required.' });
  }

  const user =
    await database.getUserByUsername(loginIdentifier.trim()) ||
    await database.getUserByEmail(loginIdentifier.trim());

  if (user && await bcrypt.compare(password, user.password)) {
    user.token = uuidv4();
    await database.updateUser(user);

    setAuthCookie(res, user.token);

    return res.send({
      email: user.email,
      username: user.username,
    });
  }

  res.status(401).send({ msg: 'Incorrect username/email or password.' });
});

// DeleteAuth logout a user
apiRouter.delete('/auth/logout', async (req, res) => {
  const user = await database.getUserByToken(req.cookies[authCookieName]);

  if (user) await database.removeUserAuth(user);

  res.clearCookie(authCookieName);
  res.status(204).end();
});

// Middleware to verify that the user is authorized to call an endpoint
async function verifyAuth(req, res, next) {
  const user = await database.getUserByToken(req.cookies[authCookieName]);

  if (user) {
    req.user = user;
    next();
  } else {
    res.status(401).send({ msg: 'You must be logged in to access this resource.' });
  }
}

// Get the currently authenticated user
apiRouter.get('/auth/me', verifyAuth, async (req, res) => {
  res.status(200).send({
    email: req.user.email,
    username: req.user.username,
  });
});

// Get User Tanks
apiRouter.get('/tanks', verifyAuth, async (req, res) => {
  const userTanks = await database.getTanksByOwner(req.user.username);

  res.send(userTanks.filter(tank => experimentalJava || tank.language !== 'java'));
});

// Get all public tank fields for Battle
apiRouter.get('/tanks/all', verifyAuth, async (_req, res) => {
  const tanks = await database.getAllTanks();
  res.send(tanks.filter(tank => experimentalJava || tank.language !== 'java'));
});

// Create Tank
apiRouter.post('/tanks', verifyAuth, async (req, res) => {
  const tankData = validateTankData(req.body.tank);
  if (tankData.error) return res.status(400).send({ msg: tankData.error });

  const tank = {
    id: uuidv4(),
    ...tankData.tank,
    ownerUsername: req.user.username,
  };

  const createdTank = await database.addTank(tank);

  res.status(201).send(createdTank);
});

// Middleware to verify that the authenticated user owns the requested tank
const verifyTankOwnership = async (req, res, next) => {
  const targetTank = await database.getTankById(req.params.id);

  if (!targetTank) {
    return res.status(404).send({ msg: 'Tank not found.' });
  }

  if (req.user.username !== targetTank.ownerUsername) {
    return res.status(403).send({ msg: 'You do not have permission to modify this tank.' });
  }

  if (targetTank.language === 'java' && !experimentalJava) {
    return res.status(403).send({ msg: 'The experimental Java language is disabled on this server.' });
  }

  req.tank = targetTank;
  next();
};

// Update Tank
apiRouter.put('/tanks/:id', verifyAuth, verifyTankOwnership, async (req, res) => {
  const savedLanguage = req.tank.language ?? 'javascript';
  const tankData = validateTankData(req.body.tank, savedLanguage);
  if (tankData.error) return res.status(400).send({ msg: tankData.error });
  if (tankData.tank.language !== savedLanguage) {
    return res.status(400).send({ msg: 'A saved tank’s language cannot be changed. Create a new tank to use another language.' });
  }
  // Language is fixed at creation; only editable fields are written back.
  const { language, ...updates } = tankData.tank;

  if (!await database.updateTank(req.params.id, updates)) {
    return res.status(404).send({ msg: 'Tank not found.' });
  }

  res.status(200).send({
    id: req.tank.id,
    ...updates,
    language,
    ownerUsername: req.tank.ownerUsername,
  });
});

// Delete Tank
apiRouter.delete('/tanks/:id', verifyAuth, verifyTankOwnership, async (req, res) => {
  if (!await database.deleteTank(req.params.id)) {
    return res.status(404).send({ msg: 'Tank not found.' });
  }

  res.status(204).end();
});

// Default error handler
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).send({ msg: 'Request body must be valid JSON.' });
  }

  res.status(500).send({
    type: err.name,
    message: 'An unexpected server error occurred.',
  });
});

app.use('/api', (_req, res) => res.status(404).json({ msg: 'API endpoint not found.' }));

// Serve React Router's entry point for page navigation.
app.get('/{*path}', (req, res) => {
  if (extname(req.path)) return res.sendStatus(404);
  res.sendFile('index.html', { root: publicDirectory });
});

// Create a new user
async function createUser(email, username, password) {
  const passwordHash = await bcrypt.hash(password, 10);

  const user = {
    email: email,
    username: username,
    password: passwordHash,
    token: uuidv4(),
  };

  return database.addUser(user);
}

// Set the authentication cookie in the HTTP response
function setAuthCookie(res, authToken) {
  res.cookie(authCookieName, authToken, {
    maxAge: 1000 * 60 * 60 * 24 * 365,
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
  });
}

function validateTankData(tank, defaultLanguage = 'javascript') {
  if (!tank || typeof tank !== 'object' || Array.isArray(tank)) {
    return { error: 'Tank data is required.' };
  }
  if (typeof tank.name !== 'string' || !tank.name.trim()) {
    return { error: 'Tank name is required.' };
  }
  if (typeof tank.code !== 'string' || !tank.code.trim()) {
    return { error: 'Tank code is required.' };
  }
  if (typeof tank.color !== 'string' || !/^#[\da-f]{6}$/i.test(tank.color)) {
    return { error: 'Tank color must be a six-digit hexadecimal color.' };
  }
  const language = tank.language === undefined ? defaultLanguage : tank.language;
  if (language === 'java' && !experimentalJava) {
    return { error: 'The experimental Java language is disabled on this server.' };
  }
  if (language !== 'javascript' && language !== 'typescript' && language !== 'python' && language !== 'java') {
    return { error: 'Tank language must be JavaScript, TypeScript, or Python.' };
  }

  return {
    tank: {
      name: tank.name.trim(),
      code: tank.code,
      language,
      color: tank.color.toLowerCase(),
    },
  };
}

const listenAddress = production ? ['127.0.0.1'] : [];
const server = app.listen(port, ...listenAddress, (error) => {
  if (error) {
    console.error(`Unable to listen on port ${port}: ${error.code ?? error.message}`);
    process.exit(1);
  }
  console.log(`Listening on port ${port}`);
  process.send?.('ready');
});

// WebSocket server for online player counts
const wss = new WebSocketServer({ server, path: '/ws' });

// Send the number of connected browsers to everyone.
function broadcastOnlineCount() {
  const count = [...wss.clients].filter(
    client => client.readyState === WebSocket.OPEN
  ).length;

  const message = JSON.stringify({
    type: 'online-count',
    count,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// A browser connects to TankScript.
wss.on('connection', (socket) => {
  console.log('WebSocket connected');

  socket.isAlive = true;

  broadcastOnlineCount();

  // A browser disconnects.
  socket.on('close', () => {
    console.log('WebSocket disconnected');
    broadcastOnlineCount();
  });

  // The browser responds to a heartbeat.
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
});

// Check every 10 seconds that clients are still connected.
const heartbeat = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (socket.isAlive === false) {
      socket.terminate();
      return;
    }

    socket.isAlive = false;
    socket.ping();
  });
}, 10000);

let shutdownStarted = false;
async function shutdown() {
  if (shutdownStarted) return;
  shutdownStarted = true;

  clearInterval(heartbeat);

  // Close WebSocket connections before stopping the server.
  for (const client of wss.clients) {
    client.terminate();
  }

  await new Promise(resolve => wss.close(resolve));
  await new Promise(resolve => server.close(resolve));
  await database.closeDatabase();
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void shutdown().catch(() => {
    console.error('TankScript shutdown could not complete.');
    process.exitCode = 1;
  }));
}
