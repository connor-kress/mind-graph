import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { linkValidator, mapKind, nodeFields } from "./model";

export default defineSchema({
  // A folder in the library, e.g. a course.
  folders: defineTable({
    name: v.string(),
    order: v.number(),
  }),

  // A study topic (shown as a map in the library): its source notes, one
  // reference map, and recall attempts.
  topics: defineTable({
    folderId: v.optional(v.id("folders")),
    /** @deprecated Replaced by the folder's name; kept for older documents. */
    course: v.optional(v.string()),
    title: v.string(),
    notes: v.optional(
      v.object({
        heading: v.string(),
        paragraphs: v.array(v.string()),
      }),
    ),
  }).index("by_folder", ["folderId"]),

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
