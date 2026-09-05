import { getStore } from "@netlify/blobs";

export const stores = {
  site: () => getStore({ name: "site", consistency: "strong" }),
  pages: () => getStore({ name: "pages", consistency: "strong" }),
  assets: () => getStore("assets"),
  data: () => getStore({ name: "data", consistency: "strong" }),
  oauth: () => getStore({ name: "oauth", consistency: "strong" }),
};

export function encodeKey(path: string): string {
  if (path === "/") return "_root";
  return path.replace(/^\//, "").replace(/\//g, "~");
}

export function decodeKey(key: string): string {
  if (key === "_root") return "/";
  return `/${key.replace(/~/g, "/")}`;
}
