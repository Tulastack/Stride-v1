// Storage driver selection.
//
// STORAGE_DRIVER=s3    (default) — S3 / LocalStack multipart + presigned URLs.
// STORAGE_DRIVER=local          — Docker-free local dev: video bytes are PUT
//   straight to the API (LAN-reachable from a phone) and written to a shared
//   directory the ML worker reads directly. No S3, no SQS, no LocalStack — so
//   the upload path can't fail on a flaky container.
//
// The worker uses the SAME dir (LOCAL_STORAGE_DIR) and a DB-polling queue.

import fs from 'node:fs';
import path from 'node:path';

export const isLocalStorage = process.env.STORAGE_DRIVER === 'local';

export const LOCAL_STORAGE_DIR =
  process.env.LOCAL_STORAGE_DIR ?? '/tmp/stride-local-storage';

/** Public base URL the phone uses to reach this API (set to the Mac LAN IP). */
export const PUBLIC_API_URL =
  process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

export function localKeyPath(key: string): string {
  return path.join(LOCAL_STORAGE_DIR, key);
}

export async function writeLocalBlob(key: string, body: Buffer): Promise<void> {
  const p = localKeyPath(key);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, body);
}

export async function writeLocalJson(key: string, obj: unknown): Promise<void> {
  const p = localKeyPath(key);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, JSON.stringify(obj));
}
