# Frozen pre-Winter Story engine

Pinned source: published commit b0e18cc85604891e0fdedc44dab7d8447287174c. `pre-winter-b0e18cc8.js` exposes only the Story replay/engine/reward entry points. It is never selected using a client version, and never runs PvP, Ranked, skirmishes or new encounters. Frozen public content flags contain no payment configuration or credentials.

## Authoritative admission

Migration0035 seals the existing server Story encounters in `tactics_story_legacy_cohort`; timestamps never confer membership. `tactics_story_admissions` records the server-selected engine for the current encounter. Transaction-only write tickets fence both historical campaign tables, so an old in-flight Worker cannot commit a late run, overwrite the version or reopen a closed cohort. The migration leaves existing run/progress/economic rows intact. Requests are paused by the separate preparation artifact before the schema is installed; the database barrier, not that pause, provides safety against old in-flight requests.

The first valid server-owned old-format40-card loadout is pinned privately. Retries and offline proofs use exactly that snapshot. Invalid pre-existing decks are not silently fixed or accepted; their owners select a legal owned deck before retrying. There is no eligibility expiration. A first verified victory closes the cohort and records the canonical proof digest in the same transaction as progression/rewards. Both the existing run revision and a cohort-closure CAS protect concurrency, including accounts with only the historical Mage table. Closed cohort records remain closed across new runs, retries and migration reruns.

New encounters use Winter exclusively. Current browser state exposes only its authenticated owner's frozen loadout, needed to replay the same old rules. Neither profile import nor command payloads can create cohort rows or select an engine.

## Reproduction and isolation

`node tools/build-winter-campaign-legacy.mjs` rebuilds the campaign archive from pinned Git source without changing references. `--handler-test` also rebuilds the full old-handler fixture for the permanent delayed-body regression; this test fixture is never imported by runtime code. `--preparation` builds a separate pinned-old Worker wrapper that pauses Story requests and retains the baseline Durable Objects and scheduled reconciliation. It does not activate Winter rules.

No sessions or credentials are inputs. Temporary source extraction is confined to a newly created directory and removed afterward. The campaign archive contains no payment endpoint or database adapter. The separate test/preparation artifacts intentionally contain the pinned old server implementation; they must not be mistaken for the runtime campaign-only archive.

## Next content transition

Reuse the writer fence and authoritative admission records. Do not simply change the current engine string for active encounters. Review a new bounded transition explicitly: capture the then-current version, seal its eligible cohort, retain only the necessary verifier and close eligibility on verified completion. Migration0035 CHECK constraints deliberately name only the two versions required here; this is not a generic historical-engine registry.

## Recovery

After0035, retain the fence, cohort and current Winter server. Use the compatible recovery candidate or a reviewed compatible roll-forward. Never restore the pre-Winter Worker or destructively rewind D1 over new inventory, boxes, admissions or verified victories. See the release procedure for preparation/seal/activation order.
