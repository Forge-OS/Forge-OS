#!/usr/bin/env node
import dns from "node:dns/promises";

const domain = (process.argv[2] || "forge-os.xyz").toLowerCase();
const alt = (process.argv[3] || `www.${domain}`).toLowerCase();

const GITHUB_PAGES_A = new Set([
  "185.199.108.153",
  "185.199.109.153",
  "185.199.110.153",
  "185.199.111.153",
]);

const GITHUB_PAGES_AAAA = new Set([
  "2606:50c0:8000::153",
  "2606:50c0:8001::153",
  "2606:50c0:8002::153",
  "2606:50c0:8003::153",
]);

async function resolveSafe(type, host) {
  try {
    const values = await dns.resolve(host, type);
    return { ok: true, values };
  } catch (error) {
    return { ok: false, error: error?.code || error?.message || "UNKNOWN" };
  }
}

async function fetchSafe(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    return { ok: true, status: res.status, location: res.headers.get("location") || "" };
  } catch (error) {
    return { ok: false, error: error?.message || "HTTP_ERROR" };
  }
}

function hasAll(actualValues, expectedSet) {
  const actual = new Set(actualValues);
  for (const value of expectedSet) {
    if (!actual.has(value)) return false;
  }
  return true;
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  console.log(`Domain health check for ${domain} (alt: ${alt})`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const [ns, a, aaaa, altCname, httpRoot, httpsRoot, httpsWww] = await Promise.all([
    resolveSafe("NS", domain),
    resolveSafe("A", domain),
    resolveSafe("AAAA", domain),
    resolveSafe("CNAME", alt),
    fetchSafe(`http://${domain}`),
    fetchSafe(`https://${domain}`),
    fetchSafe(`https://${alt}`),
  ]);

  printSection("DNS");
  if (ns.ok) console.log(`NS: ${ns.values.join(", ")}`);
  else console.log(`NS: unresolved (${ns.error})`);

  if (a.ok) console.log(`A: ${a.values.join(", ")}`);
  else console.log(`A: unresolved (${a.error})`);

  if (aaaa.ok) console.log(`AAAA: ${aaaa.values.join(", ")}`);
  else console.log(`AAAA: unresolved (${aaaa.error})`);

  if (altCname.ok) console.log(`${alt} CNAME: ${altCname.values.join(", ")}`);
  else console.log(`${alt} CNAME: unresolved (${altCname.error})`);

  printSection("HTTP/HTTPS");
  if (httpRoot.ok) console.log(`http://${domain} -> ${httpRoot.status}${httpRoot.location ? ` (${httpRoot.location})` : ""}`);
  else console.log(`http://${domain} -> error (${httpRoot.error})`);

  if (httpsRoot.ok) console.log(`https://${domain} -> ${httpsRoot.status}${httpsRoot.location ? ` (${httpsRoot.location})` : ""}`);
  else console.log(`https://${domain} -> error (${httpsRoot.error})`);

  if (httpsWww.ok) console.log(`https://${alt} -> ${httpsWww.status}${httpsWww.location ? ` (${httpsWww.location})` : ""}`);
  else console.log(`https://${alt} -> error (${httpsWww.error})`);

  printSection("Readiness");
  const aReady = a.ok && hasAll(a.values, GITHUB_PAGES_A);
  const aaaaReady = aaaa.ok && hasAll(aaaa.values, GITHUB_PAGES_AAAA);
  const cnameReady = altCname.ok && altCname.values.some((v) => v.toLowerCase() === "gryszzz.github.io.");
  const httpsReady = httpsRoot.ok && httpsRoot.status >= 200 && httpsRoot.status < 500;

  console.log(`A records match GitHub Pages: ${aReady ? "YES" : "NO"}`);
  console.log(`AAAA records match GitHub Pages: ${aaaaReady ? "YES" : "NO (optional for launch)"}`);
  console.log(`www CNAME -> gryszzz.github.io: ${cnameReady ? "YES" : "NO"}`);
  console.log(`HTTPS root reachable: ${httpsReady ? "YES" : "NO"}`);

  if (!ns.ok && (a.error === "ENOTFOUND" || a.error === "ENODATA" || a.error === "ENOTIMP")) {
    console.log("Status: Domain delegation appears pending. This is common right after registration.");
    process.exitCode = 2;
    return;
  }

  if (!aReady || !cnameReady || !httpsReady) {
    console.log("Status: Partial configuration. See docs/ops/custom-domain.md.");
    process.exitCode = 1;
    return;
  }

  console.log("Status: Domain configuration looks healthy.");
}

main().catch((error) => {
  console.error("Domain health check failed:", error?.message || error);
  process.exitCode = 1;
});

