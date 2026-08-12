"""Wave 4: Reflection facts and append-only canonical events."""

from alembic import op

from schema.migration import irreversible_downgrade, upgrade_wave


revision = "20260809_04"
down_revision = "20260809_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    upgrade_wave(op.get_bind(), 4)


def downgrade() -> None:
    irreversible_downgrade(4)
