# Gold DB Migration Documents

This folder is the canonical home for market-terminal Gold DB migration audits,
handoffs, and gap analysis.

| Document | Purpose |
| --- | --- |
| [MODULE_DATA_AUDIT.md](./MODULE_DATA_AUDIT.md) | Terminal-side module audit, migration status, remaining Phase 6 work, and test matrix. |
| [market_terminal_gold_views.md](./market_terminal_gold_views.md) | Pipeline-side Gold analytical views plan for recreating terminal macro surfaces. |
| [market_terminal_series_gap.md](./market_terminal_series_gap.md) | Pipeline-side raw series gap audit for terminal identifiers missing from ingestion. |

Related terminal handoff:

- [../features/GOLD_DB_MIGRATION_HANDOFF.md](../features/GOLD_DB_MIGRATION_HANDOFF.md)

The two `market_terminal_*` documents were imported from the sibling
`fred-bronze-to-gold-pipeline` repo so the terminal repo has a self-contained
copy of the migration context.
