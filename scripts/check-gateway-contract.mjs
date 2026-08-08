#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const manifestPath = path.join(root, "gateway.manifest.json");
const apiRoots = ["api", "web/api", "src/app/api"];
const apiExtensions = new Set([".js", ".mjs", ".cjs", ".ts"]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (apiExtensions.has(path.extname(entry.name)) && !entry.name.startsWith("_")) files.push(fullPath);
  }
  return files;
}

function apiPathFor(relativeFile) {
  let normalized = relativeFile.split(path.sep).join("/");
  if (normalized.startsWith("web/api/")) normalized = normalized.slice("web/".length);
  if (normalized.startsWith("src/app/api/")) {
    let route = normalized.slice("src/app".length);
    route = route.replace(/\/route\.(js|mjs|cjs|ts)$/, "");
    return route.replace(/\[([^\]]+)\]/g, ":$1");
  }
  if (normalized.startsWith("api/")) {
    return `/${normalized.replace(/\.(js|mjs|cjs|ts)$/, "")}`.replace(/\/index$/, "");
  }
  return null;
}

function fail(messages) {
  console.error("[gateway-contract] failed");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail([`missing ${manifestPath}`]);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const errors = [];
if (!manifest.project_code) errors.push("manifest.project_code is required");
if (manifest.default_high_cost_action !== "deny") errors.push("default_high_cost_action must be deny");
if (!Array.isArray(manifest.features)) errors.push("features must be an array");
if (!Array.isArray(manifest.endpoints)) errors.push("endpoints must be an array");

const featureKeys = new Set((manifest.features || []).map((item) => item.feature_key));
const endpointPaths = new Set((manifest.endpoints || []).map((item) => item.path));

for (const endpoint of manifest.endpoints || []) {
  for (const key of ["endpoint_key", "method", "path", "source_file", "feature_key", "cost_class", "description"]) {
    if (!endpoint[key]) errors.push(`endpoint missing ${key}: ${endpoint.endpoint_key || JSON.stringify(endpoint)}`);
  }
  if (endpoint.feature_key && !featureKeys.has(endpoint.feature_key)) {
    errors.push(`endpoint references unknown feature_key ${endpoint.feature_key}`);
  }
  if (endpoint.high_cost && endpoint.cost_class === "unknown") {
    errors.push(`high_cost endpoint cannot use unknown cost_class: ${endpoint.endpoint_key}`);
  }
}

for (const apiRoot of apiRoots) {
  for (const file of walk(path.join(root, apiRoot))) {
    const relative = path.relative(root, file);
    const apiPath = apiPathFor(relative);
    if (apiPath && !endpointPaths.has(apiPath)) {
      errors.push(`unregistered API file: ${relative} -> ${apiPath}`);
    }
  }
}

if (errors.length) fail(errors);
console.log(`[gateway-contract] ok: ${manifest.project_code}, ${manifest.endpoints.length} endpoints`);

