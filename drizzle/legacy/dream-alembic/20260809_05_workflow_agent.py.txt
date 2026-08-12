"""Wave 5: Deck/chat, Plugin, Workflow, runtime, and Agent closure."""

from alembic import op

from schema.migration import irreversible_downgrade, upgrade_wave


revision = "20260809_05"
down_revision = "20260809_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    upgrade_wave(op.get_bind(), 5)


def downgrade() -> None:
    irreversible_downgrade(5)
