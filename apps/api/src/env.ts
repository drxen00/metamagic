import path from "node:path";
import fs from "node:fs";

export const CONFIG_DIR =
  process.env.CONFIG_DIR ?? path.resolve(process.cwd(), "../../config");

export const PORT = Number(process.env.API_PORT ?? 3801);
export const HOST = process.env.API_HOST ?? "0.0.0.0";

fs.mkdirSync(CONFIG_DIR, { recursive: true });
