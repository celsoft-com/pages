// Which deploy is serving a page, from what the platform tells the Worker. Nothing is written at
// build time, so the stamp cannot go stale or describe a build other than the one running.
export interface DeployEnv {
  DEPLOY_TARGET?: string;
  DEPLOY_AT?: string;
  DEPLOY_COMMIT?: string;
  DEPLOY_BRANCH?: string;
}

export interface BuildStamp {
  builtAt: string;
  commit: string;
  branch: string;
  target: string;
}

export function buildStamp(env: DeployEnv): BuildStamp {
  return {
    builtAt: env.DEPLOY_AT ?? "",
    commit: (env.DEPLOY_COMMIT ?? "").slice(0, 7),
    branch: env.DEPLOY_BRANCH ?? "",
    target: env.DEPLOY_TARGET ?? "",
  };
}

function formatTime(iso: string): string {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return "";
  const [date, time] = at.toISOString().split("T");
  return `${date} ${time.slice(0, 5)} UTC`;
}

export function describeBuild(stamp: BuildStamp): string {
  const when = formatTime(stamp.builtAt);
  const ref = [stamp.branch, stamp.commit].filter(Boolean).join("@");

  if (!when && !ref) return stamp.target ? `Running as ${stamp.target}, not from a deploy.` : "Not from a deploy.";

  const parts = [when ? `Deployed ${when}` : "Deployed from"];
  if (ref) parts.push(ref);
  if (stamp.target && stamp.target !== "production") parts.push(stamp.target);
  return parts.join(" · ");
}
