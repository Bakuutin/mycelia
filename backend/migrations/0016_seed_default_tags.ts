import { Db } from "mongodb";
import type { MongoClient } from "mongodb";

/**
 * Migration: Seed default tags for conversation tagging
 *
 * This migration upserts a set of default tags that can be used by the tagger worker
 * to categorize conversations. Tags are matched by name for idempotency.
 *
 * Data Safety:
 * - Uses upsert to avoid duplicates
 * - Matches on name field for idempotency
 * - Safe to run multiple times
 * - down() removes only the tags created by this migration
 */

interface TagDefinition {
  name: string;
  emoji: string;
  details?: string;
}

const DEFAULT_TAGS: TagDefinition[] = [
  { name: "personal", emoji: "👤" },
  { name: "education", emoji: "📚" },
  { name: "health", emoji: "🏥" },
  { name: "finance", emoji: "💰" },
  { name: "legal", emoji: "⚖️" },
  { name: "philosophy", emoji: "🤔" },
  { name: "spiritual", emoji: "🙏" },
  { name: "science", emoji: "🔬" },
  { name: "entrepreneurship", emoji: "🚀" },
  { name: "parenting", emoji: "👶" },
  { name: "romance", emoji: "💕" },
  { name: "travel", emoji: "✈️" },
  { name: "inspiration", emoji: "💡" },
  { name: "technology", emoji: "💻" },
  { name: "business", emoji: "💼" },
  { name: "social", emoji: "👥" },
  { name: "work", emoji: "🔧" },
  { name: "sports", emoji: "⚽" },
  { name: "politics", emoji: "🏛️" },
  { name: "literature", emoji: "📖" },
  { name: "history", emoji: "🏺" },
  { name: "architecture", emoji: "🏗️" },
  { name: "music", emoji: "🎵" },
  { name: "weather", emoji: "🌤️" },
  { name: "news", emoji: "📰" },
  { name: "entertainment", emoji: "🎬" },
  { name: "psychology", emoji: "🧠" },
  { name: "real", emoji: "🏠" },
  { name: "design", emoji: "🎨" },
  { name: "family", emoji: "👨‍👩‍👧‍👦" },
  { name: "economics", emoji: "📈" },
  { name: "environment", emoji: "🌍" },
  { name: "other", emoji: "📌", details: "Conversations that don't fit into any other category" },
];

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Seeding default tags...");

  const objects = db.collection("objects");
  const now = new Date();

  let created = 0;
  let updated = 0;

  for (const tag of DEFAULT_TAGS) {
    const result = await objects.updateOne(
      { name: tag.name, isTag: true },
      {
        $set: {
          isTag: true,
          name: tag.name,
          icon: { text: tag.emoji },
          ...(tag.details && { details: tag.details }),
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      created++;
      console.log(`  + Created tag: ${tag.emoji} ${tag.name}`);
    } else if (result.modifiedCount > 0) {
      updated++;
      console.log(`  ~ Updated tag: ${tag.emoji} ${tag.name}`);
    } else {
      console.log(`  - Tag unchanged: ${tag.emoji} ${tag.name}`);
    }
  }

  console.log(`✓ Seeded ${DEFAULT_TAGS.length} tags (${created} created, ${updated} updated)`);
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  // No down migration needed
}
