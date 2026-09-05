import type { Config } from "@netlify/functions";
import { handle } from "../../src/app";

export default async function server(request: Request): Promise<Response> {
  return handle(request);
}

export const config: Config = {
  path: "/*",
  preferStatic: false,
};
