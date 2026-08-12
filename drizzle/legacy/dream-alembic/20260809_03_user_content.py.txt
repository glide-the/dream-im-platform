"""Wave 3: user content, editor sessions, and social data."""

from alembic import op

from schema.migration import irreversible_downgrade, upgrade_wave


revision = "20260809_03"
down_revision = "20260809_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    upgrade_wave(op.get_bind(), 3)


def downgrade() -> None:
    irreversible_downgrade(3)
