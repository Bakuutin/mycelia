import { MongoClient, Db } from 'mongodb';
export const client = new MongoClient(process.env.MONGO_URL as string);
export const DATABASE_NAME = "a5t-2024-11-19";

export const getDB = async (): Promise<Db> => {
    // const client = new MongoClient(process.env.MONGO_URL as string);
    await client.connect();
    return client.db(DATABASE_NAME);
}