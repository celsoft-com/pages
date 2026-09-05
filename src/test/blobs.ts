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
    async setJSON(key: string, value: unknown) {
      bucket(name).set(key, { value: JSON.stringify(value), metadata: {} });
    },
    async set(key: string, value: string, options?: { metadata?: Record<string, unknown> }) {
      bucket(name).set(key, { value, metadata: options?.metadata ?? {} });
    },
    async getMetadata(key: string) {
      const entry = bucket(name).get(key);
      return entry ? { metadata: entry.metadata } : null;
    },
    async delete(key: string) {
      bucket(name).delete(key);
    },
    async list() {
      return { blobs: [...bucket(name).keys()].map((key) => ({ key })) };
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
