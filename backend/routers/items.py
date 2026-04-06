"""
Items REST API.

Follows the HTTP conventions from Chapter 4 of the book:
- Correct HTTP methods (GET / POST / DELETE)
- Semantically correct status codes (200, 201, 204, 404, 422)
- Owner-scoped data: each user only sees their own items
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from database import get_db
from models.item import Item
from auth import get_current_user

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ItemCreate(BaseModel):
    name: str
    description: Optional[str] = None


class ItemResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    owner_id: str
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class PaginatedItemsResponse(BaseModel):
    items: list[ItemResponse]
    total: int


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=PaginatedItemsResponse)
async def list_items(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return paginated items owned by the current user."""
    owner_filter = Item.owner_id == current_user["sub"]

    count_result = await db.execute(
        select(func.count(Item.id)).where(owner_filter)
    )
    total = count_result.scalar_one()

    result = await db.execute(
        select(Item).where(owner_filter).order_by(Item.created_at.desc()).offset(skip).limit(limit)
    )
    return {"items": result.scalars().all(), "total": total}


@router.post("/", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
async def create_item(
    body: ItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new item. Returns 201 Created with the created resource."""
    item = Item(
        name=body.name,
        description=body.description,
        owner_id=current_user["sub"],
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.get("/{item_id}", response_model=ItemResponse)
async def get_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return a single item. Returns 404 if not found or not owned by user."""
    result = await db.execute(
        select(Item).where(Item.id == item_id, Item.owner_id == current_user["sub"])
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Delete an item. Returns 204 No Content on success."""
    result = await db.execute(
        select(Item).where(Item.id == item_id, Item.owner_id == current_user["sub"])
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    await db.delete(item)
    await db.commit()
