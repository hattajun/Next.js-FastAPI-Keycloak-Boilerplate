"""create items table

Revision ID: 0001
Revises:
Create Date: 2025-01-01 00:00:00.000000 UTC

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'items',
        sa.Column('id',          sa.Integer(),                  nullable=False),
        sa.Column('name',        sa.String(length=255),         nullable=False),
        sa.Column('description', sa.String(length=1000),        nullable=True),
        sa.Column('owner_id',    sa.String(length=255),         nullable=False),
        sa.Column('created_at',  sa.DateTime(timezone=True),
                  server_default=sa.text('now()'),              nullable=True),
        sa.Column('updated_at',  sa.DateTime(timezone=True),    nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_items_id',       'items', ['id'],       unique=False)
    op.create_index('ix_items_owner_id', 'items', ['owner_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_items_owner_id', table_name='items')
    op.drop_index('ix_items_id',       table_name='items')
    op.drop_table('items')
