import { BUILD_INFO } from "./build-info";

export interface BuildStamp {
  builtAt: string;
  commit: string;
  branch: string;
  context: string;
}

function env(name: string): string {
  return typeof process === "undefined" ? "" : (process.env?.[name] ?? "");
}

export function buildStamp(): BuildStamp {
  return {
    builtAt: BUILD_INFO.builtAt,
    commit: BUILD_INFO.commit || env("COMMIT_REF").slice(0, 7),
    branch: BUILD_INFO.branch || env("BRANCH"),
    context: BUILD_INFO.context || env("CONTEXT"),
  };
}

function formatTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const [date, time] = at.toISOString().split("T");
  return `${date} ${time.slice(0, 5)} UTC`;
}

export function describeBuild(stamp: BuildStamp = buildStamp()): string {
  const when = formatTime(stamp.builtAt);
  const ref = [stamp.branch, stamp.commit].filter(Boolean).join("@");

  if (!when && !ref) return "Running locally, not from a deploy build.";

  const parts = [when ? `Built ${when}` : "Built from"];
  if (ref) parts.push(ref);
  if (stamp.context && stamp.context !== "production") parts.push(stamp.context);
  return parts.join(" · ");
}
