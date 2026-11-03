import { defineApp } from "@celsoft/platform";
import { assetEndpoints } from "./endpoints/assets";
import { dataEndpoints } from "./endpoints/data";
import { pageEndpoints } from "./endpoints/pages";
import { privacyEndpoints } from "./endpoints/privacy";
import { siteEndpoints } from "./endpoints/site";
import { transferEndpoints } from "./endpoints/transfer";
import { SITE_POINT } from "./pages-app";
import * as schema from "./schema";
import { servedPages } from "./serve";

export default defineApp(undefined, {
  schema,
  endpoints: { ...siteEndpoints, ...pageEndpoints, ...dataEndpoints, ...assetEndpoints, ...transferEndpoints, ...privacyEndpoints },
  pages: servedPages,
  // Templates read across the site, so no write can name every page it changed: each one empties them all.
  invalidates: "all",
  access: {
    points: {
      [SITE_POINT]: {
        grants: [
          { to: { owner: true }, level: "manage" },
          { to: { everyone: true }, level: "read" },
        ],
      },
    },
  },
});
