import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const app = express();

const authCookieName = 'token';

// The users and tanks are saved in memory and disappear whenever the service is restarted.
let users = [];
let tanks = [];

// The service port. In production the front-end code is statically hosted by the service on the same port.
const port = process.argv.length > 2 ? process.argv[2] : 4000;

// JSON body parsing using built-in middleware
app.use(express.json());

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
  if (await findUser('email', req.body.email)) {
    res.status(409).send({ msg: 'Email associated with an existing account' });
  } else if (await findUser('username', req.body.username)) {
    res.status(409).send({ msg: 'Username associated with an existing account' });
  } else {
    const user = await createUser(req.body.email, req.body.username, req.body.password);

    setAuthCookie(res, user.token);
    res.send({ email: user.email, username: user.username });
  }
});

// GetAuth login an existing user
apiRouter.post('/auth/login', async (req, res) => {
  const user = await findUser('username', req.body.username);
  if (user) {
    if (await bcrypt.compare(req.body.password, user.password)) {
      user.token = uuidv4();
      setAuthCookie(res, user.token);
      res.send({ email: user.email, username: user.username });
      return;
    }
  }
  res.status(401).send({ msg: 'Unauthorized' });
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
    res.status(401).send({ msg: 'Unauthorized' });
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
  // Later: return only tanks owned by the logged-in user.
  res.send(tanks);
});

// Create Tank
apiRouter.post('/tanks', verifyAuth, async (req, res) => {
  // Later:
  // 1. Read the tank data from req.body
  // 2. Give the tank a unique ID
  // 3. Associate it with the logged-in user
  // 4. Save it
  // 5. Return the saved tank
});

// Update Tank
apiRouter.put('/tanks/:id', verifyAuth, async (req, res) => {
  // Later:
  // 1. Find the tank by req.params.id
  // 2. Verify the logged-in user owns it
  // 3. Update the allowed fields
  // 4. Return the updated tank
});

// Delete Tank
apiRouter.delete('/tanks/:id', verifyAuth, async (req, res) => {
  // Later:
  // 1. Find the tank by req.params.id
  // 2. Verify the logged-in user owns it
  // 3. Delete it
  // 4. Send a success response
});

// Default error handler
app.use((err, req, res, next) => {
  res.status(500).send({
    type: err.name,
    message: err.message,
  });
});

// Return the application's default page if the path is unknown
app.use((_req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// Create a new user
async function createUser(email, username, password) {
  // Hash the password before storing it
  const passwordHash = await bcrypt.hash(password, 10);

  // Create the user object
  const user = {
    email: email,
    username: username,
    password: passwordHash,
    token: uuidv4(),
  };

  // Save the user in memory
  users.push(user);

  return user;
}

// Find a user by a field such as username or token
async function findUser(field, value) {
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