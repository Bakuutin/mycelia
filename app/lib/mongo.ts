import { Auth, ScopeAction, Scope, permissionDenied } from "./auth/core";

import sift from "sift";

import { 
    Collection, Db, MongoClient, Document, Filter,
    FindOptions, InsertOneOptions, OptionalUnlessRequiredId,
    UpdateFilter, UpdateOptions, WithId,
    DeleteOptions, DeleteResult,
    UpdateResult,
    InsertOneResult,
    InsertManyResult,
} from "mongodb";

export const DATABASE_NAME = "a5t-2024-11-19";

const client = new MongoClient(process.env.MONGO_URL as string);

export const getDB = async (auth: Auth): Promise<ScopedDB> => {
    await client.connect();
    return new ScopedDB(client.db(DATABASE_NAME), auth);
}

export class ScopedDB {
    private db: Db;
    private auth: Auth;

    constructor(db: Db, auth: Auth) {
        this.db = db;
        this.auth = auth;
    }

    collection<TSchema extends Document = Document>(collectionName: string): ScopedCollection<TSchema> {
        if (!this.hasAccess(collectionName)) {
            permissionDenied();
        }

        const originalCollection = this.db.collection<TSchema>(collectionName);
        return new ScopedCollection<TSchema>(originalCollection, this.auth.scopes[collectionName]);
    }

    hasAccess(collectionName: string): boolean {
        return !!this.auth.scopes[collectionName];
    }
}

export class ScopedCollection<TSchema extends Document = Document> {
    private collection: Collection<TSchema>;
    private scope: Scope;

    constructor(collection: Collection<TSchema>, scope: Scope) {
        this.collection = collection;
        this.scope = scope;
    }

    private applyFilter(query: Filter<TSchema> = {}): Filter<TSchema> {
        return {
            $and: [
                query,
                this.scope.filter,
            ]
        } as Filter<TSchema>;
    }

    private checkAction(action: ScopeAction): void {
        if (!this.scope.actions.includes(action)) {
            permissionDenied();
        }
    }

    async find(query: Filter<TSchema> = {}, options?: FindOptions<TSchema>): Promise<WithId<TSchema>[]> {
        this.checkAction("read");
        const filteredQuery = this.applyFilter(query);
        return this.collection.find(filteredQuery, options).toArray();
    }

    async findOne(query: Filter<TSchema> = {}, options?: FindOptions<TSchema>): Promise<TSchema | null> {
        this.checkAction("read");
        const filteredQuery = this.applyFilter(query);
        return this.collection.findOne(filteredQuery, options);
    }

    async insertOne(doc: OptionalUnlessRequiredId<TSchema>, options?: InsertOneOptions): Promise<InsertOneResult<TSchema>> {
        this.checkAction("write");
        const matcher = sift(this.scope.filter);
        if (!matcher(doc)) {
            permissionDenied();
        }
        
        return this.collection.insertOne(doc, options);
    }

    async insertMany(docs: OptionalUnlessRequiredId<TSchema>[], options?: InsertManyOptions): Promise<InsertManyResult<TSchema>> {
        this.checkAction("write");
        const matcher = sift(this.scope.filter);
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
        options?: UpdateOptions
    ): Promise<UpdateResult<TSchema>> {
        this.checkAction("modify");
        // TODO: the update might modify the scope fields, but we don't check for that yet
        return this.collection.updateMany(this.applyFilter(query), update, options);
    }

    async updateOne(
        query: Filter<TSchema>, 
        update: UpdateFilter<TSchema> | Partial<TSchema>,
        options?: UpdateOptions
    ): Promise<UpdateResult<TSchema>> {
        this.checkAction("modify");
        return this.collection.updateOne(this.applyFilter(query), update, options);
    }

    async deleteMany(query: Filter<TSchema>, options?: DeleteOptions): Promise<DeleteResult> {
        this.checkAction("delete");
        return this.collection.deleteMany(this.applyFilter(query), options);
    }

    async deleteOne(query: Filter<TSchema>, options?: DeleteOptions): Promise<DeleteResult> {
        this.checkAction("delete");
        return this.collection.deleteOne(this.applyFilter(query), options);
    }

    async countDocuments(query: Filter<TSchema> = {}): Promise<number> {
        this.checkAction("read");
        const filteredQuery = this.applyFilter(query);
        return this.collection.countDocuments(filteredQuery);
    }
}
