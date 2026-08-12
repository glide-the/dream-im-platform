"""Wave 6: Notion Connector tables in the unified PostgreSQL."""

from alembic import op

from schema.migration import irreversible_downgrade, upgrade_wave


revision = "20260809_06"
down_revision = "20260809_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    upgrade_wave(op.get_bind(), 6)


def downgrade() -> None:
    irreversible_downgrade(6)
