"""Wave 1: exact canonical baseline adopt plus auth tables."""

from alembic import op

from schema.migration import irreversible_downgrade, upgrade_wave


revision = "20260809_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    upgrade_wave(op.get_bind(), 1)


def downgrade() -> None:
    irreversible_downgrade(1)
