import { defineApp } from "@celsoft/platform";
import { endpoints } from "./endpoints";
import * as schema from "./schema";

export default defineApp(undefined, {
  schema,
  endpoints,
});
