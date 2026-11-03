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
    await usersCollection.insertOne(user);
}

export async function updateUser(user) {
    // Only update the authentication token, not MongoDB's _id.
    await usersCollection.updateOne(
        { email: user.email },
        { $set: { token: user.token } }
    );
}

export async function removeUserAuth(user) {
    await usersCollection.updateOne(
        { email: user.email },
        { $unset: { token: 1 } }
    );
}

// TANK OPERATIONS

export function getAllTanks() {
    return tanksCollection.find({}).toArray();
}

export function getTanksByOwner(ownerId) {
    return tanksCollection.find({ ownerId: ownerId }).toArray();
}

export function getTankById(tankId) {
    return tanksCollection.findOne({ id: tankId });
}

export async function addTank(tank) {
    await tanksCollection.insertOne(tank);
}

export async function updateTank(tankId, updates) {
    // Exclude MongoDB's immutable _id field from updates.
    const { _id, ...fields } = updates;

    await tanksCollection.updateOne(
        { id: tankId },
        { $set: fields }
    );
}

export async function deleteTank(tankId) {
    await tanksCollection.deleteOne({ id: tankId });
}