import { id, timestamps } from "@celsoft/platform/schema";
import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import type { Asset, CollectionSummary, PageSummary } from "./types";

// The app's tables. After changing them, run `npx @celsoft/platform db generate` and commit drizzle/.

// A page, collection or asset is one file in app.files, and that file is the truth. These rows are
// what a listing reads instead of opening every file, written after the file by the one function
// that writes each kind; see store.ts.
export const pageSummaries = pgTable("page_summaries", {
  id: id(),
  path: text("path").notNull().unique(),
  summary: jsonb("summary").$type<PageSummary>().notNull(),
  ...timestamps(),
});

export const collectionSummaries = pgTable("collection_summaries", {
  id: id(),
  path: text("path").notNull().unique(),
  summary: jsonb("summary").$type<CollectionSummary>().notNull(),
  ...timestamps(),
});

export const assets = pgTable("assets", {
  id: id(),
  key: text("key").notNull().unique(),
  path: text("path").unique(),
  asset: jsonb("asset").$type<Asset>().notNull(),
  ...timestamps(),
});

// One row per site-wide value: settings and the owner's instructions.
export const siteValues = pgTable("site_values", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  ...timestamps(),
});
