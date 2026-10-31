import { endpoint, upload } from "@celsoft/platform";
import { z } from "zod";
import { assetUrlFor, listAssets, putAsset } from "../assets/service";
import { normalizeAssetPath } from "../pages/path";
import { pointsFor, SITE_POINT } from "../pages-app";
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

  upload_asset: endpoint(
    {
      serve: ["api", "mcp"],
      method: "POST",
      path: "/api/v1/upload_asset",
      description:
        "Store an image or file and return its URL for use on any page. Pass path to file it into a bundle; " +
        "without one it is stored under a hash of its bytes, which keeps working forever but sits in no bundle. " +
        "An image uploaded to /root/favicon.ico, .svg, .png, .webp or .jpg becomes the site icon, served at " +
        "/favicon.ico. Over the API the file goes as multipart form data; an AI client sends it as base64. " +
        "The size ceiling is the host's, so there is no larger door and no way to send a file in pieces: " +
        "something bigger has to be made smaller first. " +
        BUNDLES,
      access: {
        point: ({ path }: { path?: string }) => (path === undefined ? [SITE_POINT] : pointsFor(normalizeAssetPath(path))),
        level: "write",
      },
      input: z.object({
        file: upload().describe("The file; its name and type are kept"),
        path: z
          .string()
          .optional()
          .describe(
            "Where to file it, for example /gallery/images/photo.jpg. It is served at /assets plus that path, " +
              "and sits in the bundle that path names.",
          ),
      }),
      output: z.object({
        url: z.string().describe("The only way to read the bytes back. No tool returns them."),
        path: z.string().nullable().describe("Null when it was stored under a hash of its bytes instead"),
        filename: z.string(),
        content_type: z.string(),
        bytes: z.number(),
      }),
    },
    async ({ file, path }, app) => {
      const asset = await putAsset(app, {
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        bytes: await file.arrayBuffer(),
        path,
      });
      return {
        url: `${app.env.APP_URL}${assetUrlFor(asset)}`,
        path: asset.path ?? null,
        filename: asset.filename,
        content_type: asset.contentType,
        bytes: asset.size,
      };
    },
  ),
};
