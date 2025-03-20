import {
  Db,
  MongoClient,
} from "mongodb";
import mongoose from "mongoose";
import process from "node:process";

const client = new MongoClient(process.env.MONGO_URL as string);

export const getRootDB = async (): Promise<Db> => {
    await client.connect();
    return client.db(process.env.DATABASE_NAME);
};

export const ensureDbConnected = async () => {
  await getRootDB()
  await mongoose.connect(process.env.MONGO_URL as string, {
    dbName: process.env.DATABASE_NAME,
  });
}
