export interface DnsRecord {
  type: "CNAME" | "TXT";
  name: string;
  value: string;
  purpose: string;
}

export interface Provider {
  id: string;
  label: string;
  steps: string[];
  apexSupported: boolean;
}

export const PROVIDERS: Provider[] = [
  {
    id: "generic",
    label: "Other / not listed",
    steps: [
      "Open the DNS settings for your domain at whoever manages it.",
      "Add each record below exactly as shown.",
      "Save, then come back here. Verification usually finishes in a few minutes.",
    ],
    apexSupported: false,
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    steps: [
      "Open your domain in the Cloudflare dashboard and go to DNS > Records.",
      "Add each record below. Leave the CNAME record set to Proxied.",
      "Cloudflare flattens CNAMEs at the apex, so a bare domain works here.",
    ],
    apexSupported: true,
  },
  {
    id: "route53",
    label: "AWS Route 53",
    steps: [
      "Open the hosted zone for your domain in Route 53.",
      "Create the CNAME record below, or an A record with Alias enabled if this is the bare domain.",
      "Create the TXT record below as a separate record.",
    ],
    apexSupported: true,
  },
  {
    id: "namecheap",
    label: "Namecheap",
    steps: [
      "Open Domain List > Manage > Advanced DNS.",
      "Add a CNAME Record and a TXT Record using the values below.",
      "Namecheap uses @ for the bare domain and the label alone for subdomains, so enter only the part before your domain name in Host.",
    ],
    apexSupported: false,
  },
  {
    id: "godaddy",
    label: "GoDaddy",
    steps: [
      "Open My Products > DNS for your domain.",
      "Add a CNAME record and a TXT record using the values below.",
      "GoDaddy does not support CNAME at the bare domain, so use a subdomain such as www.",
    ],
    apexSupported: false,
  },
  {
    id: "squarespace",
    label: "Squarespace / Google Domains",
    steps: [
      "Open Domains > your domain > DNS settings.",
      "Add a custom record of type CNAME and one of type TXT using the values below.",
    ],
    apexSupported: false,
  },
];

export function isApex(hostname: string): boolean {
  const labels = hostname.split(".").filter(Boolean);
  return labels.length <= 2;
}

export function providerById(id: string): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
