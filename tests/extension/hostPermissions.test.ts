import { describe, expect, it } from "vitest";
import { normalizeHostPermissionOrigins } from "../../extension/shared/hostPermissions";

describe("normalizeHostPermissionOrigins", () => {
  it("maps endpoint URLs to origin permission patterns", () => {
    const patterns = normalizeHostPermissionOrigins([
      "https://api.kaspa.org",
      "https://api.kaspa.org/info/blockdag",
      "http://127.0.0.1:17110/rpc",
    ]);

    expect(patterns).toEqual([
      "https://api.kaspa.org/*",
      "http://127.0.0.1:17110/*",
    ]);
  });

  it("skips invalid and unsupported endpoint strings", () => {
    const patterns = normalizeHostPermissionOrigins([
      "",
      "not-a-url",
      "wss://api.kaspa.org",
      "ftp://api.kaspa.org",
      "https://api-tn12.kaspa.org",
    ]);

    expect(patterns).toEqual(["https://api-tn12.kaspa.org/*"]);
  });
});

