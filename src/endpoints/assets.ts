import { endpoint } from "@celsoft/platform";
import { z } from "zod";
import { assetUrlFor, listAssets } from "../assets/service";
import { BUNDLES, site } from "./shared";

export const assetEndpoints = {
  list_assets: endpoint(
    {
      serve: ["api", "mcp"],
      method: "GET",
      path: "/api/v1/list_assets",
      description:
        "List uploaded images and files with their URLs and, where they have one, their path. An asset " +
        "uploaded before paths existed is named by a hash of its bytes instead and sits in no bundle. " +
        "The url is also how a file is read back: no tool returns the contents of one, so fetch that address " +
        "over HTTP and save it where you are working. " +
        BUNDLES,
      access: { point: site, level: "read" },
      input: z.object({}),
      output: z.object({
        assets: z.array(
          z.object({
            filename: z.string(),
            path: z
              .string()
              .optional()
              .describe("Absent for an asset stored under a content hash, which sits in no bundle"),
            url: z.string().describe("Fetch this over HTTP to read the file"),
            bytes: z.number(),
          }),
        ),
      }),
    },
    async (_input, app) => ({
      assets: (await listAssets(app)).map((asset) => ({
        filename: asset.filename,
        ...(asset.path ? { path: asset.path } : {}),
        url: `${app.env.APP_URL}${assetUrlFor(asset)}`,
        bytes: asset.size,
      })),
    }),
  ),
};
