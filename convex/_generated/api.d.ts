/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as extract from "../extract.js";
import type * as extractPdf from "../extractPdf.js";
import type * as extractSlides from "../extractSlides.js";
import type * as library from "../library.js";
import type * as links from "../links.js";
import type * as migrations from "../migrations.js";
import type * as model from "../model.js";
import type * as nodes from "../nodes.js";
import type * as projectMigration from "../projectMigration.js";
import type * as seedData from "../seedData.js";
import type * as sources from "../sources.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  extract: typeof extract;
  extractPdf: typeof extractPdf;
  extractSlides: typeof extractSlides;
  library: typeof library;
  links: typeof links;
  migrations: typeof migrations;
  model: typeof model;
  nodes: typeof nodes;
  projectMigration: typeof projectMigration;
  seedData: typeof seedData;
  sources: typeof sources;
  workspace: typeof workspace;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
