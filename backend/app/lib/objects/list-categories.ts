export const OBJECT_LIST_CATEGORIES = [
  "person",
  "event",
  "relationship",
  "promise",
  "conversation",
  "tag",
  "place",
  "organization",
  "product",
  "project",
  "animal",
  "concept",
  "media",
  "other",
] as const;

export type ObjectListCategory = typeof OBJECT_LIST_CATEGORIES[number];

export const OBJECT_LIST_TYPE_FLAGS: ReadonlyArray<
  readonly [flag: string, category: Exclude<ObjectListCategory, "other">]
> = [
  ["isPerson", "person"],
  ["isEvent", "event"],
  ["isRelationship", "relationship"],
  ["isPromise", "promise"],
  ["isConversation", "conversation"],
  ["isTag", "tag"],
  ["isPlace", "place"],
  ["isOrganization", "organization"],
  ["isProduct", "product"],
  ["isProject", "project"],
  ["isAnimal", "animal"],
  ["isConcept", "concept"],
  ["isMedia", "media"],
];

/**
 * Materialized browse-section membership. This intentionally differs from a
 * display type: multi-flag objects belong to every matching section.
 */
export function deriveObjectListCategories(
  doc: Record<string, unknown>,
): ObjectListCategory[] {
  const categories: ObjectListCategory[] = [];
  let hasAnyTypeFlag = false;

  for (const [flag, category] of OBJECT_LIST_TYPE_FLAGS) {
    if (doc[flag] !== true) continue;
    hasAnyTypeFlag = true;
    if (
      category === "relationship" &&
      (doc.isPromise === true || doc.isTag === true)
    ) {
      continue;
    }
    categories.push(category);
  }

  if (!hasAnyTypeFlag) categories.push("other");
  return categories;
}

export function withObjectListCategories<T extends Record<string, unknown>>(
  doc: T,
): T & { _listCategories: ObjectListCategory[] } {
  return {
    ...doc,
    _listCategories: deriveObjectListCategories(doc),
  };
}

export function legacyObjectListMatch(
  category: ObjectListCategory,
): Record<string, unknown> {
  if (category === "other") {
    return Object.fromEntries(
      OBJECT_LIST_TYPE_FLAGS.map(([flag]) => [flag, { $ne: true }]),
    );
  }

  if (category === "relationship") {
    return {
      isRelationship: true,
      isPromise: { $ne: true },
      isTag: { $ne: true },
    };
  }

  const flag = OBJECT_LIST_TYPE_FLAGS.find(([, value]) => value === category)
    ?.[0];
  if (!flag) throw new Error(`Unknown object list category: ${category}`);
  return { [flag]: true };
}
