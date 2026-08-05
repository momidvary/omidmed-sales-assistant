# Supabase migration baseline

## Scope and safety

This document records the evidence used to restore the missing migration
baseline and to prepare a later, separately approved migration-history repair.
The production review was read-only:

- no production migration was applied;
- no migration-history row was created or changed;
- no production data or schema was changed;
- no customer identity, phone number, message, file, or row-level financial
  value was extracted;
- only schema metadata and aggregate counts/ranges were inspected.

The linked production project reference used for the review was
`jfysbhassurzastncnal`.

## Canonical migration 001

The repository already contained the reviewed base schema at
`supabase/001_initial_schema.sql`, but Supabase CLI does not discover
migrations outside `supabase/migrations`. The file has therefore been moved,
without a semantic SQL change, to:

`supabase/migrations/001_initial_schema.sql`

Moving the file instead of copying it keeps one canonical source and preserves
Git history. Migration 001 creates the four base tables (`customers`,
`sales`, `followups`, and `tasks`), their constraints and indexes,
`set_updated_at()`, the base update triggers, the
`customer_sales_summary` view, RLS policies, and grants required by migration
002 and later migrations.

Without this file in the official migration directory, a new database cannot
apply migration 002 from an empty project because its base-table dependencies
do not exist.

## Remote migration history

The production schema contains the cumulative project objects from migrations
001 through 022, but the migration-history relation
`supabase_migrations.schema_migrations` is absent. A read-only count query
returned PostgreSQL `42P01` (undefined table), which explains why Supabase CLI
reported every local migration as local-only.

The repository does not contain authoritative evidence of the original
deployment mechanism, so this document does not guess why the schema was
provisioned without CLI migration history. The schema and final-state evidence
below is the basis for a future explicit history repair.

## Fresh-database reproduction

Using Supabase CLI 2.111.0 and a disposable local Supabase/PostgreSQL 17
database:

1. `supabase start` applied migrations 001 through 023 in order.
2. `supabase db reset --local` recreated the database and applied the same
   chain from an empty database.
3. No temporary bootstrap SQL was required.
4. Rollback-only SQL tests 014 and 017 completed with
   `BEGIN / DO / ROLLBACK`.
5. The WhatsApp pgTAP test passed.
6. A controlled second execution of migration 023 completed successfully, and
   the WhatsApp pgTAP test passed again.

The PostgreSQL 17 rollback test for migration 017 used `min(uuid)`, which is
not available on this server version. It now casts UUIDs to text for the
aggregate and back to UUID; the assertion and rollback behavior are unchanged.

## Disposable schema compared with production

The disposable `public` schema differed from the read-only production
snapshot only by the expected migration 023 objects:

- `whatsapp_messages` and `whatsapp_webhook_events`;
- WhatsApp processing and timestamp functions;
- WhatsApp indexes, trigger, and owner-read policies;
- `content_items.channel_payload`;
- the three WhatsApp consent columns on `customers`.

There were no production-only project objects. The local managed `storage`
schema additionally contained Supabase-managed Iceberg tables and indexes;
these are platform-version differences, not project migration differences.
Project-defined storage policies matched.

## Final-state review of data migrations

All production queries used `SELECT` only and returned aggregate,
non-identifying results.

| Migration | Status | Read-only final-state evidence |
| --- | --- | --- |
| 002 | `final_state_verified` | `customer-files` exists, is private, has a 10 MiB limit, and permits PNG, JPEG, and PDF. |
| 005 | `final_state_verified` | 2 currently eligible latest follow-ups; 2 have an opportunity; 0 missing; 0 duplicate open/on-hold groups. |
| 006 | `final_state_verified` | `accounting-files` exists, is private, has a 10 MiB limit, and permits PNG, JPEG, and PDF. |
| 009 | `final_state_verified` | 0 current manual expense rows; 0 pending/unknown rows; 0 system-auto rule mismatches. The invariant is satisfied for the current empty relevant set. |
| 010 | `final_state_verified` | 0 processing batches with zero inserts; current status aggregate contains 1 completed batch. |
| 015 | `final_state_verified` | `content-studio` exists and is public, with no migration-defined size or MIME restriction. |
| 017 | `final_state_verified` | 0 invalid aliases, 0 orphan aliases, 0 remaining duplicate pairs under the migration predicate, and 0 broken customer FKs across the checked dependent tables. |
| 019 | `final_state_verified` | 0 customer Toman-marker mismatches and 0 negative balances. Aggregate balance range: 0 to 66,000,000. |
| 020 | `final_state_verified` | 0 invoice/item amount-marker mismatches. The preserved receiver chain is present; the current outer RPC does not divide or multiply by 10. |
| 022 | `final_state_verified` | 2,272 Holoo invoices and 9,989 items have consistent final markers. All 2,272 matchable invoice/sales pairs are equal; 0 are 10x, 0 are 0.1x, and 0 have another mismatch. Aggregate invoice range: 35,000 to 557,100,000; item-line range: 25 to 300,000,000. |

The current outer Holoo RPC, invoice-to-sales trigger function, and customer
summary view contain no additional invoice amount division or multiplication
by 10. Migration 019's customer-balance normalization remains in the preserved
receiver chain as intended. Replaying migrations 019, 020, or 022 against
production would risk changing valid financial values and must not be used to
reconstruct history.

## Safe future history workflow

The next production-changing phase must be separately reviewed and approved:

1. record versions 001 through 022 as applied without replaying their SQL;
2. rerun the linked migration list;
3. run a linked database push dry run and confirm that only migration 023 is
   pending;
4. review and apply migration 023 separately.

Step 1 is a migration-history write and was intentionally not performed by
this PR. A real `db push --linked`, linked reset, linked pull, or migration
repair was not executed while preparing this baseline.
