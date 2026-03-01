function getChromePermissionsApi(): chrome.permissions.Permissions | null {
  if (typeof chrome === "undefined") return null;
  if (!chrome.permissions) return null;
  return chrome.permissions;
}

export function normalizeHostPermissionOrigins(endpoints: string[]): string[] {
  const deduped = new Set<string>();
  for (const raw of endpoints) {
    const candidate = String(raw || "").trim();
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      deduped.add(`${parsed.origin}/*`);
    } catch {
      // Ignore invalid URLs; endpoint validation happens before this.
    }
  }
  return [...deduped];
}

async function containsOriginPermission(originPattern: string): Promise<boolean> {
  const api = getChromePermissionsApi();
  if (!api) return true;
  return new Promise((resolve) => {
    api.contains({ origins: [originPattern] }, (granted) => {
      resolve(granted === true);
    });
  });
}

async function requestOriginPermission(originPattern: string): Promise<boolean> {
  const api = getChromePermissionsApi();
  if (!api) return true;
  return new Promise((resolve) => {
    api.request({ origins: [originPattern] }, (granted) => {
      resolve(granted === true);
    });
  });
}

export async function ensureHostPermissionsForEndpoints(endpoints: string[]): Promise<void> {
  const origins = normalizeHostPermissionOrigins(endpoints);
  for (const origin of origins) {
    const alreadyGranted = await containsOriginPermission(origin);
    if (alreadyGranted) continue;
    const granted = await requestOriginPermission(origin);
    if (!granted) {
      throw new Error(`HOST_PERMISSION_DENIED:${origin}`);
    }
  }
}

