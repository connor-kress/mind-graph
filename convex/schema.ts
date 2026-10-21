import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { mapKind, nodeFields } from "./model";

export default defineSchema({
  // A study topic: its source notes, one reference map, and recall attempts.
  topics: defineTable({
    course: v.string(),
    title: v.string(),
    notes: v.object({
      heading: v.string(),
      paragraphs: v.array(v.string()),
    }),
  }),

  maps: defineTable({
    topicId: v.id("topics"),
    kind: mapKind,
    finishedAt: v.optional(v.number()),
  }).index("by_topic_kind", ["topicId", "kind"]),

  nodes: defineTable({
    mapId: v.id("maps"),
    ...nodeFields,
  }).index("by_map_key", ["mapId", "key"]),
});
