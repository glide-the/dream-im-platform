"""Wave 2: Story character, scene, and relation closure."""

from alembic import op

from schema.migration import irreversible_downgrade, upgrade_wave


revision = "20260809_02"
down_revision = "20260809_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    upgrade_wave(op.get_bind(), 2)


def downgrade() -> None:
    irreversible_downgrade(2)
