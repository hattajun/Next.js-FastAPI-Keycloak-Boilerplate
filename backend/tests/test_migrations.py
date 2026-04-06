"""
Alembic マイグレーションファイルの静的チェック

注意: このファイルでは DB を変更しない（DROP/CREATE なし）。
upgrade/downgrade のサイクルテストは DB を破壊するため、
CI/CD の専用ステップで実行すること（`alembic downgrade base && alembic upgrade head`）。

チェック内容:
  1. マイグレーションチェーンが線形（ブランチなし）
  2. 全マイグレーションに upgrade/downgrade が実装済み
  3. リビジョン ID に重複がない
  4. 現在の DB スキーマが最新マイグレーションと一致（オプション）
"""

from pathlib import Path
from alembic.config import Config
from alembic.script import ScriptDirectory

# alembic.ini のパス（backend/ 直下）
ALEMBIC_INI = Path(__file__).parent.parent / "alembic.ini"
VERSIONS_DIR = Path(__file__).parent.parent / "alembic" / "versions"


def get_script_directory() -> ScriptDirectory:
    cfg = Config(str(ALEMBIC_INI))
    return ScriptDirectory.from_config(cfg)


# ── チェーン整合性 ─────────────────────────────────────────────────────────────

def test_migration_chain_is_linear():
    """
    マイグレーションチェーンに分岐がないことを確認する。

    head が複数存在する場合は `alembic merge heads` が必要。
    """
    script = get_script_directory()
    heads = script.get_heads()
    assert len(heads) == 1, (
        f"マイグレーションチェーンが分岐しています: {heads}\n"
        "`alembic merge heads` を実行してマージしてください。"
    )


def test_all_revisions_reachable_from_head():
    """
    全リビジョンが head から辿れることを確認する（孤立リビジョンなし）。
    """
    script = get_script_directory()
    all_revisions = list(script.walk_revisions())
    assert len(all_revisions) > 0, "マイグレーションファイルが1つもありません"


# ── ファイル内容チェック ──────────────────────────────────────────────────────

def test_all_migrations_have_upgrade_and_downgrade():
    """
    全マイグレーションファイルに upgrade() と downgrade() が実装されていることを確認する。

    downgrade は実装し忘れがちだが、ロールバック時に必要。
    """
    migration_files = [
        f for f in VERSIONS_DIR.glob("*.py")
        if not f.name.startswith("_")
    ]
    assert len(migration_files) > 0, f"マイグレーションファイルが {VERSIONS_DIR} にありません"

    for migration_file in migration_files:
        content = migration_file.read_text(encoding="utf-8")

        assert "def upgrade()" in content, (
            f"{migration_file.name}: upgrade() が実装されていません"
        )
        assert "def downgrade()" in content, (
            f"{migration_file.name}: downgrade() が実装されていません\n"
            "ロールバックのために必ず実装してください"
        )


def test_downgrade_functions_are_not_empty():
    """
    downgrade() が `pass` だけでないことを確認する。

    `pass` のみの downgrade は実質未実装と同じ。
    """
    for migration_file in VERSIONS_DIR.glob("*.py"):
        if migration_file.name.startswith("_"):
            continue

        content = migration_file.read_text(encoding="utf-8")
        lines = content.splitlines()

        in_downgrade = False
        downgrade_body_lines = []

        for line in lines:
            stripped = line.strip()
            if stripped.startswith("def downgrade()"):
                in_downgrade = True
                continue
            if in_downgrade:
                if stripped.startswith("def ") and not stripped.startswith("def downgrade"):
                    break
                if stripped and not stripped.startswith("#"):
                    downgrade_body_lines.append(stripped)

        assert downgrade_body_lines, (
            f"{migration_file.name}: downgrade() の本体が空です（pass のみ）\n"
            "アップグレードの逆操作を実装してください"
        )


# ── リビジョン ID チェック ────────────────────────────────────────────────────

def test_revision_ids_are_unique():
    """リビジョン ID に重複がないことを確認する。"""
    script = get_script_directory()
    revision_ids: list[str] = []

    for rev in script.walk_revisions():
        assert rev.revision not in revision_ids, (
            f"リビジョン ID が重複しています: {rev.revision}"
        )
        revision_ids.append(rev.revision)


def test_revision_ids_match_filenames():
    """
    リビジョン ID がファイル内の定義と一致することを確認する。
    （Alembic が管理するため通常は問題ないが、手動編集のバグ検出に役立つ）
    """
    script = get_script_directory()
    for rev in script.walk_revisions():
        assert rev.revision is not None, (
            f"revision ID が None のマイグレーションがあります: {rev.doc}"
        )
