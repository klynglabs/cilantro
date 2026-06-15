import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { convertRelativePath } from "@/utils/path";

export class TokenService {
  private readonly dir: string;

  constructor(tokensPath: string) {
    this.dir = convertRelativePath(tokensPath);
    mkdirSync(this.dir, { recursive: true });
  }

  async get(username: string): Promise<string | undefined> {
    try {
      const text = await Bun.file(this.path(username)).text();
      return text.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async set(username: string, token: string): Promise<void> {
    await Bun.write(this.path(username), token);
  }

  async del(username: string): Promise<void> {
    await Bun.file(this.path(username)).delete();
  }

  private path(username: string): string {
    return join(this.dir, encodeURIComponent(username));
  }
}
