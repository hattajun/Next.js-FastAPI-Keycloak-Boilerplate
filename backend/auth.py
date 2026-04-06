"""
Keycloak JWT verification.

The backend fetches the public keys (JWKS) from Keycloak's well-known endpoint
and uses them to verify the Bearer token on every protected request.
This follows the book's recommendation of keeping auth logic server-side
(Chapter 4 - Security and Cross-Origin Concerns).
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import httpx
from jose import jwt, JWTError
from database import settings

security = HTTPBearer()

# Simple in-process cache to avoid fetching JWKS on every request.
# In production, consider a TTL-based cache (e.g. cachetools).
_jwks_cache: dict | None = None


async def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        url = (
            f"{settings.keycloak_url}/realms/{settings.keycloak_realm}"
            "/protocol/openid-connect/certs"
        )
        async with httpx.AsyncClient() as client:
            resp = await client.get(url)
            resp.raise_for_status()
            _jwks_cache = resp.json()
    return _jwks_cache


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """
    Dependency that validates the Bearer token and returns the decoded payload.
    Usage: current_user: dict = Depends(get_current_user)
    """
    token = credentials.credentials
    try:
        jwks = await _get_jwks()
        # options: audience check is disabled because the token's aud field
        # varies by Keycloak client configuration.
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
        return payload
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token validation failed: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        )
