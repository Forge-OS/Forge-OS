# Local Node Mode (kaspad)

Local Node Mode allows the extension to run a managed `kaspad` process and prefer it as the RPC backend.

## Architecture

1. Extension settings are persisted in `chrome.storage.local`:
   - `localNodeEnabled`
   - `localNodeNetworkProfile`
   - `localNodeDataDir`
2. Extension RPC adapter (`extension/network/kaspaClient.ts`) evaluates backend selection:
   - local node first when enabled + healthy + synced + profile match
   - remote pool fallback otherwise
3. Local node control service (`server/local-node/index.mjs`) exposes:
   - `GET /node/status`
   - `GET /node/logs?lines=80`
   - `POST /node/start`
   - `POST /node/stop`
   - `POST /node/restart`
   - `GET /metrics` (JSON; `?format=prometheus` for text metrics)
   - `GET /events` (SSE status/lifecycle/heartbeat/error stream)
4. `NodeManager` (`server/local-node/modules/nodeManager.mjs`) handles:
   - binary locate/install
   - process lifecycle start/stop/restart
   - crash restart with backoff
   - sync/health probe via local RPC (`/info/blockdag`)

## Networks / Profiles

Profiles are isolated behind `server/local-node/modules/networkProfiles.mjs`.

- `mainnet`
- `testnet-10`
- `testnet-11`
- `testnet-12`

Each profile maps to profile-specific RPC/P2P ports and chain args.

## Data Directory Strategy (Optimized)

You do **not** need to set a custom directory in normal operation.

- Default mode is managed storage root (OS-native path)
- NodeManager creates per-profile subdirs automatically (`mainnet`, `testnet-10`, etc.)
- Custom directory is optional override only

Managed default roots:

- macOS: `~/Library/Application Support/ForgeOS/local-node`
- Windows: `%LOCALAPPDATA%/ForgeOS/local-node`
- Linux: `$XDG_DATA_HOME/forgeos/local-node` or `~/.local/share/forgeos/local-node`

## Run

Recommended setup:

```bash
cp .env.local-node.example .env.local-node
set -a; source .env.local-node; set +a
```

Then start control service:

```bash
npm run local-node:start
```

Default control endpoint:

- `http://127.0.0.1:19725`

## Environment

Core:

- `LOCAL_NODE_CONTROL_HOST` (default `127.0.0.1`)
- `LOCAL_NODE_CONTROL_PORT` (default `19725`)
- `LOCAL_NODE_DATA_DIR` (optional override; default is managed OS-native root)
- `LOCAL_NODE_AUTO_INSTALL` (`true`/`false`, default `true`)
- `LOCAL_NODE_KASPAD_BINARY` (optional explicit binary path)
- `LOCAL_NODE_RPC_HOST` (default `127.0.0.1`)
- `LOCAL_NODE_RPC_BASE_URL` (optional explicit override; otherwise profile-derived)
- `LOCAL_NODE_RPC_PROBE_TIMEOUT_MS` (default `1500`)
- `LOCAL_NODE_RPC_STARTUP_WAIT_MS` (default `8000`)
- `LOCAL_NODE_RPC_STARTUP_PROBE_INTERVAL_MS` (default `750`)
- `LOCAL_NODE_SYNC_CACHE_TTL_MS` (default `1500`)
- `LOCAL_NODE_REQUIRE_SYNC_FOR_SELECTION` (default `true`)
- `LOCAL_NODE_LOG_TAIL_MAX_BYTES` (default `262144`)

Backoff:

- `LOCAL_NODE_RESTART_BACKOFF_BASE_MS` (default `1000`)
- `LOCAL_NODE_RESTART_BACKOFF_MAX_MS` (default `30000`)

Download-on-demand (platform-specific):

- `LOCAL_NODE_KASPAD_URL_<PLATFORM_ARCH>`
- `LOCAL_NODE_KASPAD_SHA256_<PLATFORM_ARCH>`
- `LOCAL_NODE_REQUIRE_CHECKSUM` (default `true`)

Platform tag format example:

- `DARWIN_ARM64`
- `LINUX_X64`
- `WIN32_X64`

## Binary Resolution Order

1. explicit `LOCAL_NODE_KASPAD_BINARY`
2. existing `kaspad` in `PATH`
3. cached binary under local node data dir
4. download + checksum verify + cache (if auto-install enabled)

## Security Notes

- Non-custodial boundary is unchanged. This mode only changes RPC source.
- Signing/private key handling stays in existing extension vault signer flow.
- Checksum verification is enabled by default for downloaded binaries.

## Debugging

Health and sync:

```bash
curl -s http://127.0.0.1:19725/node/status | jq .
```

Metrics:

```bash
curl -s http://127.0.0.1:19725/metrics | jq .
curl -s "http://127.0.0.1:19725/metrics?format=prometheus"
```

Event stream:

```bash
curl -N http://127.0.0.1:19725/events
```

Logs:

```bash
curl -s "http://127.0.0.1:19725/node/logs?lines=120"
```

Start/restart manually:

```bash
curl -s -X POST http://127.0.0.1:19725/node/start -H "content-type: application/json" -d '{"networkProfile":"mainnet"}'
curl -s -X POST http://127.0.0.1:19725/node/restart -H "content-type: application/json" -d '{"networkProfile":"testnet-12"}'
```

Real runtime verification (no mocks):

```bash
npm run local-node:doctor
```

This checks:
- control service reachability
- start/status/stop flow
- RPC healthy transition
- clear failure reasons for missing binary/artifact env

## Troubleshooting

`kaspad binary not found`:
- set `LOCAL_NODE_KASPAD_BINARY` or ensure download env vars are configured.

`checksum mismatch`:
- update `LOCAL_NODE_KASPAD_SHA256_<TAG>` to the expected artifact digest.

`local profile mismatch` in backend selector:
- ensure extension network and local profile are aligned (e.g., both `testnet-12`).

RPC unhealthy with running process:
- verify profile RPC port is reachable locally and check `kaspad` startup logs.
