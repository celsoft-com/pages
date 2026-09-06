export type ContentType = "markdown" | "html";

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
  createdAt: number;
  updatedAt: number;
}

export interface PageSummary {
  path: string;
  contentType: ContentType;
  title: string;
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

export interface SiteSettings {
  title: string;
  description: string;
}
