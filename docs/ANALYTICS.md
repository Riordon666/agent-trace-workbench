# Analytics and Cost Semantics

Session Analytics is a local, on-demand view over normalized `events.jsonl`. It sends no telemetry and does not call a model or pricing service.

## Evidence selection

Sessions may contain the same logical request from Agent History, the Legacy proxy, and gateway capture. Each analytics category selects one source using the same priority and fallback rules as Session Comparison. It never sums copies from two sources.

- Token totals group per-request usage by Provider and model. Cumulative snapshots use their maximum observed total instead of being summed.
- Tool statistics match explicit call/result IDs where available. A duration is shown only when both timestamps exist.
- Request duration uses explicit request boundaries when present, otherwise the observed event span is labeled as such.
- Reasoning counts represent visible reasoning events only. Missing or encrypted thinking remains unavailable.

## Cost states

Cost is never presented as a single unqualified number:

| State | Meaning |
|---|---|
| `observed` | A selected upstream `request_end` event contained a finite, non-negative `cost` value. |
| `estimated` | All attributable usage had an exact Provider/model match in the local standard-rate catalog. |
| `unavailable` | Usage, Provider, model, or a supported exact rate was missing. Partial matches do not produce a Session total. |

When both an observed cost and a complete local estimate exist, the observed value remains primary and the estimate is shown separately.

The bundled catalog is `workbench/data/model-pricing.json`. It records a verification date and official source URLs. Rates are standard USD text-token API rates and exclude batch/flex/priority tiers, high-context rules not represented by the catalog, regional premiums, cache storage, grounding/search, tool calls, media pricing, taxes, discounts, and contract pricing.

The bundled catalog was verified on 2026-08-12 against:

- <https://developers.openai.com/api/docs/models/gpt-5.6-sol>
- <https://developers.openai.com/api/docs/models/gpt-5.6-terra>
- <https://developers.openai.com/api/docs/models/gpt-5.6-luna>
- <https://developers.openai.com/api/docs/models/gpt-5>
- <https://platform.claude.com/docs/en/about-claude/pricing>
- <https://ai.google.dev/gemini-api/docs/pricing>

Pricing changes over time. Review the catalog before relying on an estimate. Set `WORKBENCH_PRICING_FILE` to an absolute path for a reviewed local USD catalog with the same shape. An invalid override fails the Analytics request instead of silently falling back.

## Large Sessions

`GET /api/sessions/:id/events` accepts `offset`, `limit` (1–500), and optional `type`. The server streams the JSONL file, returns only the requested page, and reports `total`, `filteredTotal`, `types`, `nextOffset`, and `hasMore`. The browser uses 100-event previous/next pages and replaces the current DOM page.

The Analytics endpoint currently reads the complete normalized event file on demand. This keeps interactive event browsing bounded but means an explicit full summary can still require memory proportional to Session size.
