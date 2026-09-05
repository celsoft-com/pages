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
  filename: string;
  contentType: string;
  size: number;
  createdAt: number;
}

export interface SiteSettings {
  title: string;
  description: string;
}
