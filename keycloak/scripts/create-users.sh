#!/usr/bin/env bash
# =============================================================================
# create-users.sh
#
# Keycloak Admin REST API を使って開発用ユーザーを動的に作成するスクリプト。
# realm-export.json のユーザー定義では足りない場合（大量ユーザー・CI/CD など）
# に使用する。
#
# 使い方:
#   docker compose exec keycloak bash /opt/keycloak/data/import/scripts/create-users.sh
#   または
#   bash keycloak/scripts/create-users.sh
#
# 前提:
#   - Keycloak が起動済みであること (localhost:8080 でアクセス可能)
#   - curl がインストールされていること
# =============================================================================

set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-myrealm}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"

# ── 1. アクセストークン取得 ─────────────────────────────────────────────────
echo ">>> Keycloak からアクセストークンを取得中..."

TOKEN=$(curl -s -X POST \
  "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=${ADMIN_USER}" \
  -d "password=${ADMIN_PASSWORD}" \
  | grep -o '"access_token":"[^"]*"' \
  | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: トークン取得に失敗しました。Keycloak が起動しているか確認してください。"
  exit 1
fi

echo "    OK"

# ── 2. ユーザー作成関数 ─────────────────────────────────────────────────────
create_user() {
  local USERNAME="$1"
  local EMAIL="$2"
  local FIRST_NAME="$3"
  local LAST_NAME="$4"
  local PASSWORD="$5"
  local ROLES="$6"   # カンマ区切り例: "user,admin"

  echo ">>> ユーザー作成: ${USERNAME} ..."

  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${KEYCLOAK_URL}/admin/realms/${REALM}/users" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"username\": \"${USERNAME}\",
      \"email\": \"${EMAIL}\",
      \"firstName\": \"${FIRST_NAME}\",
      \"lastName\": \"${LAST_NAME}\",
      \"enabled\": true,
      \"emailVerified\": true,
      \"credentials\": [{
        \"type\": \"password\",
        \"value\": \"${PASSWORD}\",
        \"temporary\": false
      }]
    }")

  if [ "$HTTP_STATUS" = "201" ]; then
    echo "    作成完了"
  elif [ "$HTTP_STATUS" = "409" ]; then
    echo "    スキップ (既に存在します)"
    return
  else
    echo "    WARNING: HTTP ${HTTP_STATUS}"
    return
  fi

  # ── ユーザー ID 取得 ─────────────────────────────────────────────────────
  USER_ID=$(curl -s \
    "${KEYCLOAK_URL}/admin/realms/${REALM}/users?username=${USERNAME}&exact=true" \
    -H "Authorization: Bearer ${TOKEN}" \
    | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # ── ロール付与 ──────────────────────────────────────────────────────────
  IFS=',' read -ra ROLE_LIST <<< "$ROLES"
  for ROLE in "${ROLE_LIST[@]}"; do
    ROLE=$(echo "$ROLE" | tr -d ' ')
    ROLE_ID=$(curl -s \
      "${KEYCLOAK_URL}/admin/realms/${REALM}/roles/${ROLE}" \
      -H "Authorization: Bearer ${TOKEN}" \
      | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -n "$ROLE_ID" ]; then
      curl -s -o /dev/null \
        -X POST "${KEYCLOAK_URL}/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "[{\"id\": \"${ROLE_ID}\", \"name\": \"${ROLE}\"}]"
      echo "    ロール付与: ${ROLE}"
    fi
  done
}

# ── 3. ユーザー定義 ─────────────────────────────────────────────────────────
# create_user <username> <email> <firstName> <lastName> <password> <roles>
create_user "batch-user-1"  "batch1@example.com"  "Batch"   "User1"  "password"  "user"
create_user "batch-user-2"  "batch2@example.com"  "Batch"   "User2"  "password"  "user"
create_user "batch-admin"   "batchadmin@example.com" "Batch" "Admin"  "password"  "user,admin"

echo ""
echo "=== 完了 ==="
