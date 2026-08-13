#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());

const blocked = [
  /duomiapi\.com/i,
  /dataapi\.endata\.com\.cn/i,
  /api\.coze\.cn/i,
  /ark\.cn-beijing\.volces\.com/i,
  /api\.moonshot\.(cn|ai)/i,
  /api\.kimi\.com/i,
  /\bOPENAI_API_KEY\b/i,
  /\bANTHROPIC_API_KEY\b/i,
  /\bDOUBAO_API_KEY\b/i,
  /\bDOMI_API_KEY\b/i,
  /\bDUOMI_API_KEY\b/i,
  /\bIMAGE_GENERATION_API_KEY\b/i,
  /\bENDATA_TOKEN\b/i,
  /\bKIMI_API_KEY\b/i,
  /\bMOONSHOT_API_KEY\b/i,
  /\bARK_API_KEY\b/i,
  /\bVOLC_API_KEY\b/i,
  /\bARK_CHAT_API_KEY\b/i,
  /\bGEO_CONTENT_API_KEY\b/i,
  /\bCOZE_API_TOKEN\b/i,
];

const allowed = [
  /(^|\/)scripts\/check-no-provider-direct\.mjs$/,
  /(^|\/)scripts\/check-gateway-contract\.mjs$/,
  /(^|\/)gateway\.manifest\.json$/,
  /(^|\/)(README|ARCHITECTURE)\.md$/,
  /(^|\/)docs\//,
  /(^|\/)server\/migrations\//,
  /(^|\/)server\/secrets\/.*\.enc\.env$/,
  /(^|\/)server\/ops\/deploy\.sh$/,
  /(^|\/)server\/scripts\/GEO\/backfill_geo_ops_history\.py$/,
  /(^|\/)web\/src\/sampleData\.js$/,
  /(^|\/)\.env\.example$/,
  /(^|\/)web\/\.env\.example$/,
];

const skippedDirs = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".vercel"]);
const scannedExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".sh",
  ".json",
  ".yml",
  ".yaml",
  ".sql",
  ".env",
]);

function shouldScan(filePath) {
  const name = path.basename(filePath);
  return scannedExtensions.has(path.extname(name)) || name === ".env" || name.startsWith(".env.");
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirs.has(entry.name)) yield* walk(path.join(dir, entry.name));
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (shouldScan(fullPath)) yield fullPath;
  }
}

const hits = [];
for (const file of walk(root)) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (allowed.some((pattern) => pattern.test(relative))) continue;
  const text = fs.readFileSync(file, "utf8");
  text.split("\n").forEach((line, index) => {
    if (blocked.some((pattern) => pattern.test(line))) {
      hits.push(`${relative}:${index + 1}: ${line.trim().slice(0, 180)}`);
    }
  });
}

if (hits.length) {
  console.error("Direct provider domains or provider key references found:");
  hits.forEach((hit) => console.error(`- ${hit}`));
  process.exit(1);
}

console.log("provider direct scan ok");
