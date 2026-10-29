import { memoryBackend, setDefaultBackend } from "../store";

export function resetBlobs(): void {
  setDefaultBackend(memoryBackend());
}

resetBlobs();
