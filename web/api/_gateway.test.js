import { createRequire } from "node:module";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const require = createRequire(import.meta.url);
const { _internal } = require("./_gateway");

const ENV_KEYS = [
  "GATEWAY_BASE_URL",
  "GATEWAY_SERVICE_TOKEN",
];

describe("central gateway configuration", () => {
  const originalEnv = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("requires the gateway base URL and service token in production", async () => {
    process.env.NODE_ENV = "production";
    await expect(_internal.requestGateway("/v1/proxy/duomi/images_generations", {})).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("returns local development skip status without gateway variables", async () => {
    delete process.env.NODE_ENV;
    await expect(_internal.requestGateway("/v1/proxy/duomi/images_generations", {})).resolves.toMatchObject({
      skipped: true,
      allowed: true,
    });
  });
});
