import { assetEndpoints } from "./assets";
import { dataEndpoints } from "./data";
import { geoEndpoints } from "./geo";
import { pageEndpoints } from "./pages";
import { privacyEndpoints } from "./privacy";
import { redirectEndpoints } from "./redirects";
import { siteEndpoints } from "./site";
import { transferEndpoints } from "./transfer";

// Every endpoint, by the subsystem that defines it. The groups are the files, so the reference at
// /docs/tools is navigated the way the code is laid out and no list of tools is kept anywhere.
export const ENDPOINT_GROUPS = {
  Pages: pageEndpoints,
  Data: dataEndpoints,
  Assets: assetEndpoints,
  Transfers: transferEndpoints,
  Privacy: privacyEndpoints,
  Maps: geoEndpoints,
  Redirects: redirectEndpoints,
  Site: siteEndpoints,
};

export const endpoints = {
  ...siteEndpoints,
  ...pageEndpoints,
  ...dataEndpoints,
  ...assetEndpoints,
  ...transferEndpoints,
  ...privacyEndpoints,
  ...geoEndpoints,
  ...redirectEndpoints,
};
