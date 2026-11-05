import { MongoClient } from 'mongodb';
import config from './dbConfig.json' with { type: 'json' };

const url = `mongodb+srv://${encodeURIComponent(config.userName)}:${encodeURIComponent(config.password)}@${config.hostname}`;

const client = new MongoClient(url);
const db = client.db(process.env.TANKSCRIPT_DB_NAME || 'tankscript');

const usersCollection = db.collection('users');
const tanksCollection = db.collection('tanks');

// Test the database connection before the service starts.
try {
    await client.connect();
    await db.command({ ping: 1 });

    await Promise.all([
        usersCollection.createIndexes([
            { key: { email: 1 }, unique: true },
            { key: { username: 1 }, unique: true },
        ]),
        tanksCollection.createIndexes([
            { key: { id: 1 }, unique: true },
        ]),
    ]);

    console.log('Connected to MongoDB');
} catch (error) {
    console.error(`Unable to connect to MongoDB: ${error.message}`);
    process.exit(1);
}

// Remove MongoDB's internal _id field from returned documents.
function removeMongoId(document) {
    if (!document) return null;

    const { _id, ...data } = document;
    return data;
}

// USER OPERATIONS

export async function getUserByEmail(email) {
    const user = await usersCollection.findOne({ email: email });
    return removeMongoId(user);
}

export async function getUserByUsername(username) {
    const user = await usersCollection.findOne({ username: username });
    return removeMongoId(user);
}

export async function getUserByToken(token) {
    if (!token) return null;

    const user = await usersCollection.findOne({ token: token });
    return removeMongoId(user);
}

export async function addUser(user) {
    await usersCollection.insertOne({ ...user });
    return user;
}

export async function updateUser(user) {
    // Only update the authentication token.
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

export async function getAllTanks() {
    const tanks = await tanksCollection.find({}).toArray();
    return tanks.map(removeMongoId);
}

export async function getTanksByOwner(ownerUsername) {
    const tanks = await tanksCollection.find({ ownerUsername }).toArray();
    return tanks.map(removeMongoId);
}

export async function getTankById(tankId) {
    const tank = await tanksCollection.findOne({ id: tankId });
    return removeMongoId(tank);
}

export async function addTank(tank) {
    await tanksCollection.insertOne({ ...tank });
    return tank;
}

export async function updateTank(tankId, updates) {
    const result = await tanksCollection.updateOne(
        { id: tankId },
        { $set: removeMongoId(updates) }
    );
    return result.matchedCount > 0;
}

export async function deleteTank(tankId) {
    const result = await tanksCollection.deleteOne({ id: tankId });
    return result.deletedCount > 0;
}
