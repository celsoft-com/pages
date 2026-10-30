import type { App } from "@celsoft/platform";
import type * as schema from "./schema";

export type PagesApp = App<typeof schema>;

// Everything on the site hangs off this point, so the owner manages all of it and everyone reads.
export const SITE_POINT = "site";
