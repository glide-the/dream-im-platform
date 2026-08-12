# Frozen Dream Alembic history

This directory is a non-executable audit archive of the Dream-owned revision
chain that preceded the Admin/Drizzle authority cutover. It is not a second
migration source and no runner may import or execute these files.

The authoritative forward history is `drizzle/0000` through
`drizzle/0032_dream_schema_authority_cutover.sql` and subsequent Drizzle
migrations. Revision `20260811_07` added
`idx_workflow_runs_source_voice_thread`; Admin `0032` now owns that index and
publishes the `dream.workflow.thread-lookup.v1` capability.

The historical `dream_alembic_version` relation can remain in adopted
databases as a frozen audit receipt. Dream runtime does not read it and only a
future reviewed Drizzle migration may archive or remove it.

Archived files use the `.py.txt` suffix deliberately so they cannot be loaded
as an Alembic revision package.
