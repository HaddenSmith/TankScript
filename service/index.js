import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as database from './database.js';

const app = express();

const authCookieName = 'token';

// The service port. In production the front-end code is statically hosted by the service on the same port.
const port = process.argv.length > 2 ? process.argv[2] : 4000;

// JSON body parsing using built-in middleware
app.use(express.json());
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

// Use the cookie parser middleware for tracking authentication tokens
app.use(cookieParser());

// Serve up the front-end static content hosting
app.use(express.static('public'));

// Router for service endpoints
const apiRouter = express.Router();
app.use('/api', apiRouter);

// Test endpoint
apiRouter.get('/test', (_req, res) => {
  res.send({ message: 'TankScript service is running' });
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

  if (password.length < 8) {
    return res.status(400).send({ msg: 'Password must be at least 8 characters.' });
  }

  if (password.length > 128) {
    return res.status(400).send({ msg: 'Password must be no more than 128 characters.' });
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).send({ msg: 'Password must contain at least one letter and one number.' });
  }

  if (await database.getUserByEmail(email)) {
    return res.status(409).send({ msg: 'An account already exists with this email.' });
  }

  if (await database.getUserByUsername(username)) {
    return res.status(409).send({ msg: 'This username is already taken.' });
  }

  const user = await createUser(email, username, password);

  setAuthCookie(res, user.token);

  res.status(201).send({
    email: user.email,
    username: user.username,
  });
});

// GetAuth login an existing user
apiRouter.post('/auth/login', async (req, res) => {
  if (!req.body.loginIdentifier || !req.body.password) {
    return res.status(400).send({ msg: 'Username or email and password are required.' });
  }

  const user =
    await database.getUserByUsername(req.body.loginIdentifier) ||
    await database.getUserByEmail(req.body.loginIdentifier);

  if (user && await bcrypt.compare(req.body.password, user.password)) {
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
const verifyAuth = async (req, res, next) => {
  const user = await database.getUserByToken(req.cookies[authCookieName]);

  if (user) {
    req.user = user;
    next();
  } else {
    res.status(401).send({ msg: 'You must be logged in to access this resource.' });
  }
};

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

  res.send(userTanks);
});

// Get all public tank fields for Battle
apiRouter.get('/tanks/all', verifyAuth, async (_req, res) => {
  res.send(await database.getAllTanks());
});

// Create Tank
apiRouter.post('/tanks', verifyAuth, async (req, res) => {
  if (!req.body.tank) return res.status(400).send({ msg: 'Tank data is required.' });
  if (!req.body.tank.name) return res.status(400).send({ msg: 'Tank name is required.' });
  if (!req.body.tank.code) return res.status(400).send({ msg: 'Tank code is required.' });
  if (!req.body.tank.color) return res.status(400).send({ msg: 'Tank color is required.' });

  const tank = {
    id: uuidv4(),
    name: req.body.tank.name,
    code: req.body.tank.code,
    color: req.body.tank.color,
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

  req.tank = targetTank;
  next();
};

// Update Tank
apiRouter.put('/tanks/:id', verifyAuth, verifyTankOwnership, async (req, res) => {
  if (!req.body.tank) return res.status(400).send({ msg: 'Tank data is required.' });
  if (!req.body.tank.name) return res.status(400).send({ msg: 'Tank name is required.' });
  if (!req.body.tank.code) return res.status(400).send({ msg: 'Tank code is required.' });
  if (!req.body.tank.color) return res.status(400).send({ msg: 'Tank color is required.' });

  const updates = {
    name: req.body.tank.name,
    code: req.body.tank.code,
    color: req.body.tank.color,
  };

  await database.updateTank(req.params.id, updates);

  res.status(200).send({
    id: req.tank.id,
    ...updates,
    ownerUsername: req.tank.ownerUsername,
  });
});

// Delete Tank
apiRouter.delete('/tanks/:id', verifyAuth, verifyTankOwnership, async (req, res) => {
  await database.deleteTank(req.params.id);

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

// Return the application's default page if the path is unknown
app.use((_req, res) => {
  res.sendFile('index.html', { root: 'public' });
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

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});