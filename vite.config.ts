import { platform } from "@celsoft/platform/vite";
import { defineConfig } from "vite";

// The admin is a browser app bundled into dist/, which platform.jsonc serves before the Worker,
// with public/'s files copied in beside it. `platform dev` runs Vite with the Worker's paths
// forwarded to the local Worker. The bundle goes under /admin/assets, because /assets is the site's
// own route for uploaded files and would shadow it.
export default defineConfig({
  plugins: [platform()],
  build: { outDir: "dist", emptyOutDir: true, assetsDir: "admin/assets", rollupOptions: { input: { admin: "admin/index.html" } } },
});
