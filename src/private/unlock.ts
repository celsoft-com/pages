import { privateHeaders } from "../cache";
import { ROOT_BUNDLE } from "../pages/path";
import { grantCookie } from "./gate";
import { findShare, markShareUsed } from "./service";

// The share link is https://site/trip#<token>. A fragment is never put in the request line
// (RFC 3986 section 3.5, RFC 9110 section 7.1), so the token reaches no access log, no proxy and
// no Referer, and a link unfurler that fetches the URL gets the gate with no token at all. The
// cost is that the token arrives only in the browser, so something the server hands to anyone has
// to carry the script that reads it: the 404 document, which is what a stranger gets anyway.
export const UNLOCK_HEAD = `<style>[data-unlocking] .wrap{display:none}[data-unlocking] body::after{content:"Opening\\2026";display:block;padding:3rem 1.25rem;color:#667085;font:400 1rem/1.5 system-ui,sans-serif}</style>
<script>(function(){var t=location.hash.slice(1);if(!t)return;var d=document.documentElement;d.setAttribute("data-unlocking","");
function give(){d.removeAttribute("data-unlocking")}
fetch("/_unlock",{method:"POST",body:t,credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(j){
if(!j){give();return}
history.replaceState(null,"",location.pathname+location.search);
location.replace(j.path)}).catch(give)})();</script>`;

export async function handleUnlock(request: Request): Promise<Response> {
  const headers = privateHeaders();
  if (request.method !== "POST") return new Response(null, { status: 405, headers });

  const token = (await request.text()).trim();
  const found = token ? await findShare(token) : null;
  // One answer for an unknown token, a revoked one and an empty body. Nothing here says whether a
  // token was ever real, and nothing logs or echoes what was sent.
  if (!found) return new Response(null, { status: 404, headers });

  const cookie = await grantCookie(found.scope.path, found.share.id);
  if (!cookie) return new Response(null, { status: 404, headers });
  await markShareUsed(found.scope.path, found.share.id);

  const path = found.scope.path === ROOT_BUNDLE ? "/" : found.scope.path;
  return new Response(JSON.stringify({ path }), {
    headers: { ...headers, "content-type": "application/json; charset=utf-8", "set-cookie": cookie },
  });
}
