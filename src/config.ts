import { ConfigSchema } from "@/schema/config.schema";
import { convertRelativePath } from "@/utils/path";

const path = convertRelativePath("config.json");
const file = Bun.file(path);

if (!(await file.exists())) {
  throw new Error(`Config file not found: ${path}. Copy config.example.json to config.json.`);
}

export const config = ConfigSchema.parse(await file.json());
