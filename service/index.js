import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const app = express();

const authCookieName = 'token';

// The users and tanks are saved in memory and disappear whenever the service is restarted.
let users = [];
let tanks = [];
const pendingUserEmails = new Set();
const pendingUsernames = new Set();

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
  if (!req.body.email || !req.body.username || !req.body.password) {
    return res.status(400).send({ msg: 'Email, username, and password are required.' });
  }

  if (findUser('email', req.body.email) || pendingUserEmails.has(req.body.email)) {
    return res.status(409).send({ msg: 'An account already exists with this email.' });
  }

  if (findUser('username', req.body.username) || pendingUsernames.has(req.body.username)) {
    return res.status(409).send({ msg: 'This username is already taken.' });
  }

  pendingUserEmails.add(req.body.email);
  pendingUsernames.add(req.body.username);
  try {
    const user = await createUser(req.body.email, req.body.username, req.body.password);

    setAuthCookie(res, user.token);

    res.status(201).send({
      email: user.email,
      username: user.username,
    });
  } finally {
    pendingUserEmails.delete(req.body.email);
    pendingUsernames.delete(req.body.username);
  }
});

// GetAuth login an existing user
apiRouter.post('/auth/login', async (req, res) => {
  if (!req.body.loginIdentifier || !req.body.password) {
    return res.status(400).send({ msg: 'Username or email and password are required.' });
  }

  const user =
    await findUser('username', req.body.loginIdentifier) ||
    await findUser('email', req.body.loginIdentifier);

  if (user && await bcrypt.compare(req.body.password, user.password)) {
    user.token = uuidv4();

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
  const user = await findUser('token', req.cookies[authCookieName]);

  if (user) delete user.token;

  res.clearCookie(authCookieName);
  res.status(204).end();
});

// Middleware to verify that the user is authorized to call an endpoint
const verifyAuth = async (req, res, next) => {
  const user = await findUser('token', req.cookies[authCookieName]);

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

// Get Tanks
apiRouter.get('/tanks', verifyAuth, async (req, res) => {
  const userTanks = tanks.filter((tank) => tank.ownerUsername === req.user.username);

  res.send(userTanks);
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

  tanks.push(tank);

  res.status(201).send(tank);
});

// Middleware to verify that the authenticated user owns the requested tank
const verifyTankOwnership = async (req, res, next) => {
  const targetTank = tanks.find((tank) => tank.id === req.params.id);

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

  req.tank.name = req.body.tank.name;
  req.tank.code = req.body.tank.code;
  req.tank.color = req.body.tank.color;

  res.status(200).send(req.tank);
});

// Delete Tank
apiRouter.delete('/tanks/:id', verifyAuth, verifyTankOwnership, async (req, res) => {
  const tankIndex = tanks.findIndex((tank) => tank.id === req.params.id);

  tanks.splice(tankIndex, 1);

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

  users.push(user);

  return user;
}

// Find a user by a field such as username or token
function findUser(field, value) {
  if (!value) return null;

  return users.find((user) => user[field] === value);
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