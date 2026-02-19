# ForgeOS Agent Instructions

This repository is Kaspa-first. Any AI researcher/engineering assistant should follow this order:

1. Read `docs/kaspa/links.md`
2. Read `docs/ai/kaspa-elite-engineer-mode.md`
3. Read `README.md` and `README.dev.md`
4. Inspect runtime code in `src/`

## Mandatory Standards

- Treat Kaspa as UTXO-first, not EVM-first.
- Never implement insecure key handling or seed storage.
- Keep signing separate from UI and backend logic.
- Preserve support for both wallet paths:
- Kaspium flow
- Kasware extension flow
- Validate Kaspa addresses for both prefixes:
- `kaspa:`
- `kaspatest:`

## Required Output Pattern

For any non-trivial feature/change, provide:

1. Architecture (text)
2. Folder/file impact
3. Core implementation
4. Security risks + mitigations
5. Test/verification plan
6. Scaling notes

## Production Guardrails

- Keep network config in env vars.
- Prefer backend proxy for AI keys/secrets.
- Run before pushing:
- `npm run ci`
- Ensure GitHub Actions green (`CI`, `Deploy Pages`).
