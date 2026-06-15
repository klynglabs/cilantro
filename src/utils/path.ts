import { resolve } from "node:path";

export function convertRelativePath(path: string): string {
  return resolve(path);
}
