import type{ Auth } from "../auth/core.server.ts";
import { permissionDenied } from "@/lib/auth/utils.ts";

import sift from "sift";

import {
  Db,
  BulkWriteOptions,
  Collection,
  DeleteOptions,
  DeleteResult,
  Document,
  Filter,
  FindOptions,
  InsertManyResult,
  InsertOneOptions,
  InsertOneResult,
  OptionalUnlessRequiredId,
  UpdateFilter,
  UpdateOptions,
  UpdateResult,
  WithId,
} from "mongodb";



export class ScopedDB {
  auth: Auth;
  db: Db;
  constructor(auth: Auth, db: Db) {
    this.auth = auth;
    this.db = db;
  }

  collection<TSchema extends Document = Document>(
    collectionName: string,
  ): ScopedCollection<TSchema> {
    const originalCollection = this.db.collection<TSchema>(collectionName);
    return new ScopedCollection<TSchema>(
      originalCollection,
      this.auth,
    );
  }
}

export class ScopedCollection<TSchema extends Document = Document> {
  collection: Collection<TSchema>;
  auth: Auth;

  constructor(collection: Collection<TSchema>, auth: Auth) {
    this.collection = collection;
    this.auth = auth;
  }

  
  getFilter(action: string, query: Filter<TSchema> = {}): Filter<TSchema> {
    return {
      $and: [
        query,
        ...this.auth.getFilters(`db:${this.collection.collectionName}`, action),
      ],
    } as Filter<TSchema>;
  }

  async find(
    query: Filter<TSchema> = {},
    options?: FindOptions<TSchema>,
  ): Promise<WithId<TSchema>[]> {
    return this.collection.find(this.getFilter("read", query), options).toArray();
  }

  async findOne(
    query: Filter<TSchema> = {},
    options?: FindOptions<TSchema>,
  ): Promise<TSchema | null> {
    return this.collection.findOne(this.getFilter("read", query), options);
  }

  async insertOne(
    doc: OptionalUnlessRequiredId<TSchema>,
    options?: InsertOneOptions,
  ): Promise<InsertOneResult<TSchema>> {
    const matcher = sift(this.getFilter("create"));
    if (!matcher(doc)) {
      permissionDenied();
    }

    return this.collection.insertOne(doc, options);
  }

  async insertMany(
    docs: OptionalUnlessRequiredId<TSchema>[],
    options?: BulkWriteOptions,
  ): Promise<InsertManyResult<TSchema>> {
    const matcher = sift(this.getFilter("create"));
    for (const doc of docs) {
      if (!matcher(doc)) {
        permissionDenied();
      }
    }

    return this.collection.insertMany(docs, options);
  }

  async updateMany(
    query: Filter<TSchema>,
    update: UpdateFilter<TSchema> | Partial<TSchema>,
    options?: UpdateOptions,
  ): Promise<UpdateResult<TSchema>> {
    // TODO: the update might modify the scope fields, but we don't check for that yet
    return this.collection.updateMany(this.getFilter("update", query), update, options);
  }

  async updateOne(
    query: Filter<TSchema>,
    update: UpdateFilter<TSchema> | Partial<TSchema>,
    options?: UpdateOptions,
  ): Promise<UpdateResult<TSchema>> {

    // TODO: the update might modify the scope fields, but we don't check for that yet
    return this.collection.updateOne(this.getFilter("update", query), update, options);
  }

  async deleteMany(
    query: Filter<TSchema>,
    options?: DeleteOptions,
  ): Promise<DeleteResult> {
    return this.collection.deleteMany(this.getFilter("delete", query), options);
  }

  async deleteOne(
    query: Filter<TSchema>,
    options?: DeleteOptions,
  ): Promise<DeleteResult> {
    return this.collection.deleteOne(this.getFilter("delete", query), options);
  }

  async countDocuments(query: Filter<TSchema> = {}): Promise<number> {
    return this.collection.countDocuments(this.getFilter("read", query));
  }
}
