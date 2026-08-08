#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const manifestPath = path.join(root, "gateway.manifest.json");
const allowMissing = process.env.GATEWAY_ALLOW_UNREGISTERED === "1";

const apiRoots = [
  "api",
  "web/api",
  "src/app/api",
  "apps/admin-web/api",
  "apps/admin-web/src/app/api"
];

const apiExtensions = new Set([".js", ".mjs", ".cjs", ".ts"]);
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (apiExtensions.has(path.extname(entry.name)) && !entry.name.startsWith("_")) files.push(fullPath);
  }
  return files;
}

function apiPathFor(relativeFile) {
  let normalized = relativeFile.split(path.sep).join("/");
  if (normalized.startsWith("web/api/")) normalized = normalized.slice("web/".length);
  if (normalized.startsWith("apps/admin-web/api/")) normalized = normalized.slice("apps/admin-web/".length);

  if (normalized.startsWith("src/app/api/")) {
    let route = normalized.slice("src/app".length);
    route = route.replace(/\/route\.(js|mjs|cjs|ts)$/, "");
    return route.replace(/\[([^\]]+)\]/g, ":$1");
  }

  if (normalized.startsWith("apps/admin-web/src/app/api/")) {
    let route = normalized.slice("apps/admin-web/src/app".length);
    route = route.replace(/\/route\.(js|mjs|cjs|ts)$/, "");
    return route.replace(/\[([^\]]+)\]/g, ":$1");
  }

  if (normalized.startsWith("api/")) {
    return `/${normalized.replace(/\.(js|mjs|cjs|ts)$/, "")}`.replace(/\/index$/, "");
  }

  return null;
}

function methodsFor(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const found = methods.filter((method) => {
    const exportPattern = new RegExp(`export\\s+async\\s+function\\s+${method}\\b`);
    const methodPattern = new RegExp(`req\\.method\\s*={2,3}\\s*["']${method}["']|request\\.method\\s*!={1,2}\\s*["']${method}["']`);
    return exportPattern.test(text) || methodPattern.test(text);
  });
  return found.length ? found : ["ANY"];
}

function collectApiFiles() {
  const files = [];
  for (const apiRoot of apiRoots) {
    const fullRoot = path.join(root, apiRoot);
    files.push(...walk(fullRoot));
  }
  return Array.from(new Set(files));
}

function validateManifest(manifest) {
  const errors = [];
  if (!manifest.project_code) errors.push("manifest.project_code is required");
  if (!Array.isArray(manifest.features)) errors.push("manifest.features must be an array");
  if (!Array.isArray(manifest.endpoints)) errors.push("manifest.endpoints must be an array");
  if (manifest.default_high_cost_action !== "deny") {
    errors.push("manifest.default_high_cost_action must be deny for production posture");
  }

  const featureKeys = new Set((manifest.features || []).map((item) => item.feature_key));
  const policyGroups = new Map();
  for (const endpoint of manifest.endpoints || []) {
    for (const key of ["endpoint_key", "method", "path", "feature_key", "cost_class", "description"]) {
      if (!endpoint[key]) errors.push(`endpoint missing ${key}: ${JSON.stringify(endpoint)}`);
    }
    if (endpoint.feature_key && !featureKeys.has(endpoint.feature_key)) {
      errors.push(`endpoint references unknown feature_key ${endpoint.feature_key}`);
    }
    if (endpoint.high_cost && endpoint.cost_class === "unknown") {
      errors.push(`high_cost endpoint cannot use unknown cost_class: ${endpoint.endpoint_key}`);
    }
    if (endpoint.high_cost && !endpoint.default_policy_key) {
      errors.push(`high_cost endpoint must declare default_policy_key: ${endpoint.endpoint_key}`);
    }
    const policyKey = endpoint.default_policy_key || `${manifest.project_code}:${endpoint.endpoint_key}`;
    if (!policyGroups.has(policyKey)) policyGroups.set(policyKey, []);
    policyGroups.get(policyKey).push(endpoint);
  }

  for (const [policyKey, endpoints] of policyGroups) {
    if (endpoints.length <= 1) continue;
    const featureKeysForPolicy = new Set(endpoints.map((endpoint) => endpoint.feature_key));
    const costClassesForPolicy = new Set(endpoints.map((endpoint) => endpoint.cost_class));
    const highCostFlags = new Set(endpoints.map((endpoint) => Boolean(endpoint.high_cost)));
    if (featureKeysForPolicy.size > 1 || costClassesForPolicy.size > 1 || highCostFlags.size > 1) {
      errors.push(
        `shared default_policy_key must stay in one feature/cost/high_cost class: ${policyKey} -> ${endpoints
          .map((endpoint) => endpoint.endpoint_key)
          .join(", ")}`
      );
    }
  }
  return errors;
}

if (!fs.existsSync(manifestPath)) {
  if (allowMissing) {
    console.warn(`[gateway-contract] missing ${manifestPath}, allowed by GATEWAY_ALLOW_UNREGISTERED=1`);
    process.exit(0);
  }
  console.error(`[gateway-contract] missing ${manifestPath}`);
  process.exit(1);
}

const manifest = readJson(manifestPath);
const errors = validateManifest(manifest);
const registeredPaths = new Set((manifest.endpoints || []).map((endpoint) => endpoint.path));
const apiFiles = collectApiFiles();
const missing = [];

for (const file of apiFiles) {
  const relative = path.relative(root, file);
  const apiPath = apiPathFor(relative);
  if (!apiPath) continue;
  if (!registeredPaths.has(apiPath)) {
    missing.push({ file: relative, path: apiPath, methods: methodsFor(file) });
  }
}

if (missing.length) {
  errors.push(
    `unregistered API files:\n${missing
      .map((item) => `  - ${item.file} -> ${item.methods.join(",")} ${item.path}`)
      .join("\n")}`
  );
}

if (errors.length) {
  console.error(`[gateway-contract] failed for ${root}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`[gateway-contract] ok: ${manifest.project_code}, ${manifest.endpoints.length} endpoints`);
