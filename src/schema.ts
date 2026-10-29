import { timestamps } from "@celsoft/platform/schema";
import { jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

// The app's tables. After changing them, run `npx @celsoft/platform db generate` and commit drizzle/.

// What a stored object says about itself: a page or collection summary, or an asset's facts. The
// object in R2 is the truth; see store.ts for the order the two are written in.
export const resourceMeta = pgTable(
  "resource_meta",
  {
    store: text("store").notNull(),
    key: text("key").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.store, t.key] })],
);

// One row per site-wide value: settings and the owner's instructions.
export const siteValues = pgTable("site_values", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  ...timestamps(),
});
