import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const info = {
  builtAt: new Date().toISOString(),
  commit: (process.env.COMMIT_REF || git("rev-parse", "HEAD")).slice(0, 7),
  branch: process.env.BRANCH || git("rev-parse", "--abbrev-ref", "HEAD"),
  context: process.env.CONTEXT || "local",
};

writeFileSync(
  new URL("../src/build-info.ts", import.meta.url),
  `// Written by scripts/build-info.mjs during the deploy build. Committed values are placeholders.
export const BUILD_INFO = ${JSON.stringify(info, null, 2)};
`,
);

console.log(`build-info: ${info.builtAt} ${info.branch}@${info.commit} (${info.context})`);
