import crypto from "node:crypto";

function parseServiceTokenRegistry(rawJson) {
  const source = String(rawJson || "").trim();
  if (!source) return new Map();
  try {
    const parsed = JSON.parse(source);
    const entries = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed || {}).map(([token, value]) => ({ token, ...value }));
    const map = new Map();
    for (const entry of entries) {
      const token = String(entry?.token || "").trim();
      if (!token) continue;
      map.set(token, {
        sub: String(entry?.sub || entry?.userId || "service").slice(0, 120),
        scopes: Array.isArray(entry?.scopes)
          ? entry.scopes.map((s) => String(s).trim()).filter(Boolean)
          : String(entry?.scopes || "agent:read agent:write scheduler:tick")
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean),
        type: "service_token",
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

function base64UrlDecode(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
  return Buffer.from(normalized + pad, "base64");
}

export function createSchedulerAuth(deps) {
  const {
    ALLOWED_ORIGINS,
    AUTH_TOKENS,
    REQUIRE_AUTH_FOR_READS,
    JWT_HS256_SECRET,
    JWT_ISSUER,
    JWT_AUDIENCE,
    JWKS_URL,
    JWKS_CACHE_TTL_MS,
    OIDC_ISSUER,
    OIDC_DISCOVERY_TTL_MS,
    AUTH_HTTP_TIMEOUT_MS,
    JWKS_ALLOWED_KIDS,
    JWKS_REQUIRE_PINNED_KID,
    SERVICE_TOKENS_JSON,
    QUOTA_WINDOW_MS,
    QUOTA_READ_MAX,
    QUOTA_WRITE_MAX,
    QUOTA_TICK_MAX,
    metrics,
    nowMs,
    json,
    redisOp,
    getRedisClient,
    REDIS_KEYS,
    quotaFallbackMemory,
    jwksCache,
    oidcDiscoveryCache,
  } = deps;

  const SERVICE_TOKEN_REGISTRY = parseServiceTokenRegistry(SERVICE_TOKENS_JSON);

  function resolveOrigin(req) {
    const origin = req.headers.origin || "*";
    if (ALLOWED_ORIGINS.includes("*")) return typeof origin === "string" ? origin : "*";
    return ALLOWED_ORIGINS.includes(String(origin)) ? String(origin) : "null";
  }

  function schedulerAuthEnabled() {
    return AUTH_TOKENS.length > 0 || SERVICE_TOKEN_REGISTRY.size > 0 || Boolean(JWT_HS256_SECRET) || Boolean(JWKS_URL) || Boolean(OIDC_ISSUER);
  }

  function getAuthToken(req) {
    const authHeader = String(req.headers.authorization || "").trim();
    if (/^bearer\s+/i.test(authHeader)) return authHeader.replace(/^bearer\s+/i, "").trim();
    return String(req.headers["x-scheduler-token"] || "").trim();
  }

  async function fetchJsonWithTimeout(url, timeoutMs, label) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs || 0))) : null;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        ...(controller ? { signal: controller.signal } : {}),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${label}_${res.status}:${text.slice(0, 180)}`);
      return text ? JSON.parse(text) : {};
    } catch (e) {
      if (/AbortError/i.test(String(e?.name || "")) || /aborted/i.test(String(e?.message || ""))) {
        throw new Error(`${label}_timeout_${Math.max(250, Number(timeoutMs || 0))}ms`);
      }
      throw e;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function loadOidcDiscovery(forceRefresh = false) {
    if (!OIDC_ISSUER) return null;
    const now = nowMs();
    if (!forceRefresh && oidcDiscoveryCache.ts > 0 && now - oidcDiscoveryCache.ts < OIDC_DISCOVERY_TTL_MS && oidcDiscoveryCache.value) {
      metrics.oidcDiscoveryCacheHitsTotal += 1;
      return oidcDiscoveryCache.value;
    }
    if (!forceRefresh && oidcDiscoveryCache.inFlight) return oidcDiscoveryCache.inFlight;
    metrics.oidcDiscoveryFetchTotal += 1;
    oidcDiscoveryCache.inFlight = (async () => {
      try {
        const issuerBase = OIDC_ISSUER.replace(/\/+$/, "");
        const discoveryUrl = `${issuerBase}/.well-known/openid-configuration`;
        const parsed = await fetchJsonWithTimeout(discoveryUrl, AUTH_HTTP_TIMEOUT_MS, "oidc_discovery");
        if (String(parsed?.issuer || "").replace(/\/+$/, "") !== issuerBase) {
          throw new Error("oidc_discovery_issuer_mismatch");
        }
        const jwksUri = String(parsed?.jwks_uri || "").trim();
        if (!jwksUri) {
          throw new Error("oidc_discovery_missing_jwks_uri");
        }
        const value = { issuer: issuerBase, jwksUri };
        oidcDiscoveryCache.ts = nowMs();
        oidcDiscoveryCache.value = value;
        return value;
      } catch (e) {
        metrics.oidcDiscoveryFetchErrorsTotal += 1;
        throw e;
      } finally {
        oidcDiscoveryCache.inFlight = null;
      }
    })();
    return oidcDiscoveryCache.inFlight;
  }

  async function resolveJwksUrl(forceRefreshDiscovery = false) {
    if (JWKS_URL) return JWKS_URL;
    const discovery = await loadOidcDiscovery(forceRefreshDiscovery).catch(() => null);
    return String(discovery?.jwksUri || "").trim();
  }

  function decodeJwtParts(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    try {
      return {
        header: JSON.parse(base64UrlDecode(h).toString("utf8")),
        payload: JSON.parse(base64UrlDecode(p).toString("utf8")),
        signature: s,
        signingInput: `${h}.${p}`,
      };
    } catch {
      return null;
    }
  }

  function verifyJwtClaims(payload) {
    const nowSec = Math.floor(Date.now() / 1000);
    const expectedIssuer = JWT_ISSUER || OIDC_ISSUER;
    if (payload?.exp && Number(payload.exp) < nowSec) return null;
    if (payload?.nbf && Number(payload.nbf) > nowSec) return null;
    if (expectedIssuer && String(payload?.iss || "").replace(/\/+$/, "") !== expectedIssuer.replace(/\/+$/, "")) return null;
    if (JWT_AUDIENCE) {
      const aud = payload?.aud;
      const audOk = Array.isArray(aud) ? aud.includes(JWT_AUDIENCE) : String(aud || "") === JWT_AUDIENCE;
      if (!audOk) return null;
    }
    return payload;
  }

  function verifyHs256Jwt(token) {
    if (!JWT_HS256_SECRET) return null;
    const parsed = decodeJwtParts(token);
    if (!parsed) return null;
    const { header, payload, signature, signingInput } = parsed;
    if (String(header?.alg || "") !== "HS256") return null;
    const expected = crypto.createHmac("sha256", JWT_HS256_SECRET).update(signingInput).digest("base64url");
    if (expected !== signature) return null;
    return verifyJwtClaims(payload);
  }

  async function loadJwks(forceRefresh = false) {
    const jwksUrl = await resolveJwksUrl(forceRefresh && !JWKS_URL);
    if (!jwksUrl) return new Map();
    const now = nowMs();
    if (!forceRefresh && jwksCache.ts > 0 && now - jwksCache.ts < JWKS_CACHE_TTL_MS && jwksCache.byKid.size > 0) {
      metrics.jwksCacheHitsTotal += 1;
      return jwksCache.byKid;
    }
    if (!forceRefresh && jwksCache.inFlight) return jwksCache.inFlight;
    metrics.jwksFetchTotal += 1;
    jwksCache.inFlight = (async () => {
      try {
        const parsed = await fetchJsonWithTimeout(jwksUrl, AUTH_HTTP_TIMEOUT_MS, "jwks");
        const keys = Array.isArray(parsed?.keys) ? parsed.keys : [];
        const byKid = new Map();
        for (const jwk of keys) {
          const kid = String(jwk?.kid || "").trim();
          if (!kid) continue;
          if (JWKS_ALLOWED_KIDS.length && !JWKS_ALLOWED_KIDS.includes(kid)) continue;
          byKid.set(kid, jwk);
        }
        if (JWKS_REQUIRE_PINNED_KID && JWKS_ALLOWED_KIDS.length && byKid.size === 0) {
          throw new Error("jwks_no_pinned_keys_loaded");
        }
        jwksCache.ts = nowMs();
        jwksCache.byKid = byKid;
        return byKid;
      } catch (e) {
        metrics.jwksFetchErrorsTotal += 1;
        throw e;
      } finally {
        jwksCache.inFlight = null;
      }
    })();
    return jwksCache.inFlight;
  }

  async function verifyJwksJwt(token) {
    if (!JWKS_URL && !OIDC_ISSUER) return null;
    const parsed = decodeJwtParts(token);
    if (!parsed) return null;
    const { header, payload, signature, signingInput } = parsed;
    const alg = String(header?.alg || "");
    const kid = String(header?.kid || "").trim();
    if (alg !== "RS256" || !kid) return null;
    if (JWKS_ALLOWED_KIDS.length && !JWKS_ALLOWED_KIDS.includes(kid)) {
      if (JWKS_REQUIRE_PINNED_KID) return null;
    }

    const tryVerifyWithMap = (map) => {
      const jwk = map?.get?.(kid);
      if (!jwk) return null;
      try {
        const pub = crypto.createPublicKey({ key: jwk, format: "jwk" });
        const ok = crypto.verify("RSA-SHA256", Buffer.from(signingInput), pub, base64UrlDecode(signature));
        if (!ok) return null;
        return verifyJwtClaims(payload);
      } catch {
        return null;
      }
    };

    let keyMap = await loadJwks(false).catch(() => new Map());
    let verifiedPayload = tryVerifyWithMap(keyMap);
    if (verifiedPayload) return verifiedPayload;

    keyMap = await loadJwks(true).catch(() => new Map());
    verifiedPayload = tryVerifyWithMap(keyMap);
    if (!verifiedPayload) return null;
    return verifiedPayload;
  }

  function authFromSharedTokens(token) {
    if (!token || !AUTH_TOKENS.includes(token)) return null;
    return {
      type: "shared_token",
      sub: "scheduler-admin",
      scopes: ["admin", "agent:read", "agent:write", "scheduler:tick", "metrics:read"],
      rawToken: token,
    };
  }

  function authFromServiceRegistry(token) {
    if (!token) return null;
    const record = SERVICE_TOKEN_REGISTRY.get(token);
    if (!record) return null;
    return { ...record, rawToken: token };
  }

  async function authFromJwt(token) {
    let jwtSource = "";
    let payload = verifyHs256Jwt(token);
    if (payload) jwtSource = "hs256";
    if (!payload) {
      payload = await verifyJwksJwt(token);
      if (payload) jwtSource = "jwks";
    }
    if (!payload) return null;
    const scopes = Array.isArray(payload?.scopes)
      ? payload.scopes
      : String(payload?.scope || payload?.scopes || "")
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
    return {
      type: "jwt",
      jwtSource,
      sub: String(payload?.sub || payload?.userId || "jwt-user").slice(0, 120),
      scopes,
      claims: payload,
      rawToken: token,
    };
  }

  async function authenticateRequest(req, pathname) {
    const token = getAuthToken(req);
    if (!token) return { principal: null, token: "" };
    const shared = authFromSharedTokens(token) || authFromServiceRegistry(token);
    if (shared) {
      metrics.authSuccessTotal += 1;
      if (shared.type === "service_token") metrics.authServiceTokenSuccessTotal += 1;
      return { principal: shared, token };
    }
    const jwtPrincipal = await authFromJwt(token);
    if (jwtPrincipal) {
      metrics.authSuccessTotal += 1;
      metrics.authJwtSuccessTotal += 1;
      if (String(jwtPrincipal?.jwtSource || "") === "jwks") {
        metrics.authJwksSuccessTotal += 1;
      }
      return { principal: jwtPrincipal, token };
    }
    // If auth is required for this route, invalid token will be handled by requireAuth.
    return { principal: null, token };
  }

  function routeAccessPolicy(req, pathname) {
    if (req.method === "GET" && pathname === "/health") return { scope: "public", quotaBucket: "public" };
    if (req.method === "GET" && pathname === "/metrics") return { scope: "metrics:read", quotaBucket: "read" };
    if (req.method === "GET" && pathname.startsWith("/v1/")) return { scope: "agent:read", quotaBucket: "read" };
    if (req.method === "POST" && pathname === "/v1/scheduler/tick") return { scope: "scheduler:tick", quotaBucket: "tick" };
    if (req.method === "POST" && pathname.startsWith("/v1/")) return { scope: "agent:write", quotaBucket: "write" };
    return { scope: "public", quotaBucket: "public" };
  }

  function principalHasScope(principal, scope) {
    if (scope === "public") return true;
    if (!principal) return false;
    const scopes = Array.isArray(principal.scopes) ? principal.scopes : [];
    return scopes.includes("admin") || scopes.includes(scope);
  }

  function quotaLimitForBucket(bucket) {
    if (bucket === "tick") return QUOTA_TICK_MAX;
    if (bucket === "write") return QUOTA_WRITE_MAX;
    if (bucket === "read") return QUOTA_READ_MAX;
    return Infinity;
  }

  async function checkQuota(principal, bucket) {
    const limit = quotaLimitForBucket(bucket);
    if (!Number.isFinite(limit)) return { ok: true, remaining: null };
    const subject = String(principal?.sub || "anon").slice(0, 120);
    const windowId = Math.floor(Date.now() / QUOTA_WINDOW_MS);
    const key = `${subject}:${bucket}:${windowId}`;
    metrics.quotaChecksTotal += 1;

    if (getRedisClient()) {
      const count = await redisOp("quota_incr", async (r) => {
        const redisKey = `${REDIS_KEYS.quotaPrefix}:${key}`;
        const value = await r.incr(redisKey);
        if (value === 1) await r.pExpire(redisKey, QUOTA_WINDOW_MS + 1000);
        return value;
      });
      const n = Number(count || 0);
      if (!(n > 0)) return { ok: true, remaining: null };
      if (n > limit) {
        metrics.quotaExceededTotal += 1;
        return { ok: false, remaining: 0, limit, count: n };
      }
      return { ok: true, remaining: Math.max(0, limit - n), limit, count: n };
    }

    const rec = quotaFallbackMemory.get(key);
    const now = Date.now();
    const next = !rec || now > rec.expAt ? { count: 0, expAt: now + QUOTA_WINDOW_MS } : rec;
    next.count += 1;
    quotaFallbackMemory.set(key, next);
    if (quotaFallbackMemory.size > 5000) {
      for (const [k, v] of quotaFallbackMemory.entries()) {
        if (!v || now > v.expAt) quotaFallbackMemory.delete(k);
        if (quotaFallbackMemory.size <= 5000) break;
      }
    }
    if (next.count > limit) {
      metrics.quotaExceededTotal += 1;
      return { ok: false, remaining: 0, limit, count: next.count };
    }
    return { ok: true, remaining: Math.max(0, limit - next.count), limit, count: next.count };
  }

  function routeRequiresAuth(req, pathname) {
    if (!schedulerAuthEnabled()) return false;
    if (req.method === "OPTIONS") return false;
    if (req.method === "GET" && pathname === "/health") return false;
    if (req.method === "GET" && pathname === "/metrics") return false;
    if (req.method === "GET" && !REQUIRE_AUTH_FOR_READS) return false;
    return true;
  }

  async function requireAuth(req, res, origin, pathname) {
    if (!routeRequiresAuth(req, pathname)) {
      return { ok: true, principal: null, status: 200 };
    }
    const { principal, token } = await authenticateRequest(req, pathname);
    if (!token || !principal) {
      metrics.authFailuresTotal += 1;
      json(res, 401, { error: { message: "unauthorized" } }, origin);
      return { ok: false, principal: null, status: 401 };
    }
    const policy = routeAccessPolicy(req, pathname);
    if (!principalHasScope(principal, policy.scope)) {
      metrics.authScopeDeniedTotal += 1;
      json(res, 403, { error: { message: "forbidden", required_scope: policy.scope } }, origin);
      return { ok: false, principal, status: 403 };
    }
    const quota = await checkQuota(principal, policy.quotaBucket);
    if (!quota.ok) {
      json(res, 429, { error: { message: "quota_exceeded", bucket: policy.quotaBucket, limit: quota.limit } }, origin);
      return { ok: false, principal, status: 429 };
    }
    return { ok: true, principal, status: 200 };
  }

  return {
    resolveOrigin,
    requireAuth,
    principalHasScope,
    schedulerAuthEnabled,
    serviceTokenRegistrySize: () => SERVICE_TOKEN_REGISTRY.size,
  };
}
