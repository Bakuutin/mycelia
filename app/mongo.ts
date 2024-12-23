import { MongoClient } from 'mongodb';
export const client = new MongoClient(process.env.MONGO_URL as string);
export const DATABASE_NAME = "a5t-2024-11-19";
