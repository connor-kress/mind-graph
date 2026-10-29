import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { linkValidator, mapKind, nodeFields, sourceKind } from "./model";

export default defineSchema({
  // Remember initialization even after the user deletes their whole library.
  libraries: defineTable({ ownerId: v.string() }).index("by_owner", ["ownerId"]),
  projects: defineTable({
    name: v.string(),
    createdBy: v.string(),
    order: v.number(),
    // Migration metadata; never used to grant access.
    legacyFolderId: v.optional(v.id("folders")),
    legacyOwnerId: v.optional(v.string()),
  }).index("by_legacy_owner", ["legacyOwnerId"]),

  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),
    role: v.union(v.literal("owner"), v.literal("member")),
  })
    .index("by_user", ["userId"])
    .index("by_project_user", ["projectId", "userId"]),

  // Legacy table retained for a non-destructive, repeatable migration.
  folders: defineTable({
    // Optional so pre-account documents remain intact, but inaccessible.
    ownerId: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    name: v.string(),
    order: v.number(),
  }).index("by_owner", ["ownerId"]),

  // A study topic (shown as a map in the library): its source notes, one
  // reference map, and recall attempts.
  topics: defineTable({
    // Optional during migration. Only project-linked topics are accessible.
    projectId: v.optional(v.id("projects")),
    // Legacy fields below never grant access after migration.
    ownerId: v.optional(v.string()),
    folderId: v.optional(v.id("folders")),
    /** @deprecated Replaced by the project's name; kept for older documents. */
    course: v.optional(v.string()),
    title: v.string(),
    /**
     * Legacy inline notes, now kept as sources. Remove once
     * `migrations:notesToSources` has run on every deployment.
     */
    notes: v.optional(
      v.object({
        heading: v.string(),
        paragraphs: v.array(v.string()),
      }),
    ),
  })
    .index("by_project", ["projectId"])
    .index("by_folder", ["folderId"])
    .index("by_owner", ["ownerId"]),

  // A file in a topic's source notes. The bytes live in file storage.
  sources: defineTable({
    topicId: v.id("topics"),
    storageId: v.id("_storage"),
    name: v.string(),
    kind: sourceKind,
    size: v.number(),
    /** Whether its text has been extracted (`ready` even if the kind has no extractor yet). */
    status: v.union(v.literal("processing"), v.literal("ready"), v.literal("failed")),
    /** Extracted blocks as JSON (see `Block`), if the kind has an extractor. */
    contentId: v.optional(v.id("_storage")),
    extractorVersion: v.optional(v.number()),
  }).index("by_topic", ["topicId"]),

  maps: defineTable({
    topicId: v.id("topics"),
    kind: mapKind,
    // Reference maps are shared; recall attempts belong to one project member.
    userId: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
    /** Manual links made in Compare (finished recall attempts only). */
    links: v.optional(v.array(linkValidator)),
  })
    .index("by_topic_kind", ["topicId", "kind"])
    .index("by_topic_kind_finished", ["topicId", "kind", "finishedAt"])
    .index("by_topic_user_kind_finished", ["topicId", "userId", "kind", "finishedAt"]),

  nodes: defineTable({
    mapId: v.id("maps"),
    ...nodeFields,
  }).index("by_map_key", ["mapId", "key"]),
});
