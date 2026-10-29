import { vi } from "vitest";

interface Entry {
  value: string;
  metadata: Record<string, unknown>;
}

const memory = new Map<string, Map<string, Entry>>();

function bucket(name: string): Map<string, Entry> {
  const found = memory.get(name) ?? new Map<string, Entry>();
  memory.set(name, found);
  return found;
}

function fakeStore(name: string) {
  return {
    async get(key: string, options?: { type?: string }) {
      const entry = bucket(name).get(key);
      if (!entry) return null;
      return options?.type === "json" ? JSON.parse(entry.value) : entry.value;
    },
    async setJSON(key: string, value: unknown, options?: { metadata?: Record<string, unknown> }) {
      bucket(name).set(key, { value: JSON.stringify(value), metadata: options?.metadata ?? {} });
    },
    async set(key: string, value: unknown, options?: { metadata?: Record<string, unknown> }) {
      bucket(name).set(key, { value: value as string, metadata: options?.metadata ?? {} });
    },
    async getWithMetadata(key: string, options?: { type?: string }) {
      const entry = bucket(name).get(key);
      if (!entry) return null;
      const data = options?.type === "json" ? JSON.parse(entry.value) : entry.value;
      return { data, metadata: entry.metadata };
    },
    async getMetadata(key: string) {
      const entry = bucket(name).get(key);
      return entry ? { metadata: entry.metadata } : null;
    },
    async delete(key: string) {
      bucket(name).delete(key);
    },
    // Honours the prefix, as the real store does. Ignoring it let one caller's keys come back to
    // another, which reads as a record with every field undefined rather than as a wrong query.
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? "";
      return {
        blobs: [...bucket(name).keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      };
    },
  };
}

export function resetBlobs(): void {
  memory.clear();
}

vi.mock("@netlify/blobs", () => ({
  getStore: (options: string | { name: string }) =>
    fakeStore(typeof options === "string" ? options : options.name),
}));
