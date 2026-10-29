import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { linkValidator, mapKind, nodeFields, sourceKind } from "./model";

export default defineSchema({
  // Remember initialization even after the user deletes their whole library.
  libraries: defineTable({ ownerId: v.string() }).index("by_owner", ["ownerId"]),
  // A folder in the library, e.g. a course.
  folders: defineTable({
    // Optional so pre-account documents remain intact, but inaccessible.
    ownerId: v.optional(v.string()),
    name: v.string(),
    order: v.number(),
  }).index("by_owner", ["ownerId"]),

  // A study topic (shown as a map in the library): its source notes, one
  // reference map, and recall attempts.
  topics: defineTable({
    ownerId: v.optional(v.string()),
    folderId: v.optional(v.id("folders")),
    /** @deprecated Replaced by the folder's name; kept for older documents. */
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
    .index("by_folder", ["folderId"])
    .index("by_owner", ["ownerId"]),

  // A file in a topic's source notes. The bytes live in file storage.
  sources: defineTable({
    topicId: v.id("topics"),
    storageId: v.id("_storage"),
    name: v.string(),
    kind: sourceKind,
    size: v.number(),
    /** Whether its text has been extracted. */
    status: v.union(v.literal("processing"), v.literal("ready"), v.literal("failed")),
    /** Extracted blocks as JSON (see `Block`). */
    contentId: v.optional(v.id("_storage")),
    /** Pages in a PDF, or slides in a presentation. */
    pageCount: v.optional(v.number()),
    extractorVersion: v.optional(v.number()),
  }).index("by_topic", ["topicId"]),

  maps: defineTable({
    topicId: v.id("topics"),
    kind: mapKind,
    finishedAt: v.optional(v.number()),
    /** Manual links made in Compare (finished recall attempts only). */
    links: v.optional(v.array(linkValidator)),
  })
    .index("by_topic_kind", ["topicId", "kind"])
    .index("by_topic_kind_finished", ["topicId", "kind", "finishedAt"]),

  nodes: defineTable({
    mapId: v.id("maps"),
    ...nodeFields,
  }).index("by_map_key", ["mapId", "key"]),
});
