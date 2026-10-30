import { defineApp } from "@celsoft/platform";
import { pageEndpoints } from "./endpoints/pages";
import { siteEndpoints } from "./endpoints/site";
import { SITE_POINT } from "./pages-app";
import * as schema from "./schema";

export default defineApp(undefined, {
  schema,
  endpoints: { ...siteEndpoints, ...pageEndpoints },
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
