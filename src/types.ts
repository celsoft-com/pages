export type ContentType = "markdown" | "html";

// What a credential may do. It rides on the credential rather than on the surface, so the same
// token is read-only at both doors.
export type Access = "read" | "write";

export interface Owner {
  id: string;
  passwordHash: string;
  passwordSalt: string;
  recoveryHash: string;
  recoverySalt: string;
  sessionKey: string;
  createdAt: number;
}

export interface Page {
  path: string;
  contentType: ContentType;
  title: string;
  body: string;
  meta: PageMeta;
  // The working copy, when one is being written. Readers, listings and templates only ever see the
  // live fields; ?preview shows this in their place to the owner, and publishing copies it over.
  draft: PageDraft | null;
  createdAt: number;
  updatedAt: number;
}

export interface PageDraft {
  contentType: ContentType;
  title: string;
  body: string;
  meta: PageMeta;
  updatedAt: number;
}

// Values are strings only: a type that changed when the admin form round-tripped it would be a
// fact changing without anyone asking. An ISO date and a zero-padded number both sort as text.
export type PageMeta = Record<string, string>;

export interface PageSummary {
  path: string;
  contentType: ContentType;
  title: string;
  meta: PageMeta;
  hasDraft: boolean;
  updatedAt: number;
}

export interface Asset {
  key: string;
  // Set only on rooted assets. Hash-keyed assets predate paths and are in no bundle.
  path?: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: number;
}

export type Item = { id: string } & Record<string, unknown>;

export interface Collection {
  path: string;
  items: Item[];
  refs: Record<string, string>;
  rev: number;
  revs: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionSummary {
  path: string;
  count: number;
  refs: Record<string, string>;
  rev: number;
  updatedAt: number;
}

// A share link is stored as a hash, never as the token itself: the blob is a list of what may be
// revoked, not a list of live credentials.
export interface Share {
  id: string;
  hash: string;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface PrivateScope {
  path: string;
  createdAt: number;
  shares: Share[];
}

export interface Privacy {
  scopes: PrivateScope[];
}

export type Theme = "default" | "none";

// head is the owner's own HTML for every themed page's head. header and footer are paths of stored
// templates, pages whose bodies wrap the content; empty means the built-in one. theme none drops the
// built-in styles and chrome altogether.
export interface SiteSettings {
  title: string;
  description: string;
  head: string;
  header: string;
  footer: string;
  theme: Theme;
}
