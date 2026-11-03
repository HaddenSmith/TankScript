
import { MongoClient } from 'mongodb';
import config from './dbConfig.json' with { type: 'json' };

const url = `mongodb+srv://${encodeURIComponent(config.userName)}:${encodeURIComponent(config.password)}@${config.hostname}`;

const client = new MongoClient(url);
const db = client.db('tankscript');

const usersCollection = db.collection('users');
const tanksCollection = db.collection('tanks');

// Test the database connection before the service starts.
try {
    await client.connect();
    await db.command({ ping: 1 });
    console.log('Connected to MongoDB');
} catch (error) {
    console.error(`Unable to connect to MongoDB: ${error.message}`);
    process.exit(1);
}

// USER OPERATIONS

export function getUserByEmail(email) {
    return usersCollection.findOne({ email: email });
}

export function getUserByUsername(username) {
    return usersCollection.findOne({ username: username });
}

export function getUserByToken(token) {
    return usersCollection.findOne({ token: token });
}

export async function addUser(user) {
    // TODO
}

export async function updateUser(user) {
    // TODO
}

export async function removeUserAuth(user) {
    // TODO
}

// TANK OPERATIONS

export function getAllTanks() {
    // TODO
}

export function getTanksByOwner(ownerId) {
    // TODO
}

export function getTankById(tankId) {
    // TODO
}

export async function addTank(tank) {
    // TODO
}

export async function updateTank(tankId, updates) {
    // TODO
}

export async function deleteTank(tankId) {
    // TODO
}