import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const sourcePath = resolve(projectRoot, "../LLM_feedback/llm_feedback.json");
const targetPath = resolve(projectRoot, "public/data/llm_feedback.json");

if (!existsSync(sourcePath)) {
  console.error(`Missing LLM feedback source file: ${sourcePath}`);
  process.exit(1);
}

mkdirSync(dirname(targetPath), { recursive: true });
copyFileSync(sourcePath, targetPath);

console.log(`Synced LLM feedback to ${targetPath}`);
