"""Safely migrate Campus Copilot data from SQLite to PostgreSQL.

This script is intentionally separate from app.py and never runs on import.
It does not create, drop, or delete tables or rows.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv


SOURCE_DB = os.path.join(os.path.dirname(__file__), "campus_copilot.db")
TABLE_ORDER = [
    "students",
    "admins",
    "email_verification_tokens",
    "password_reset_tokens",
    "complaints",
    "lost_found",
    "events",
]
SEQUENCE_TABLES = TABLE_ORDER

SOURCE_COLUMNS = {
    "students": {"id", "name", "roll_number", "password_hash", "created_at", "college_email", "role", "is_verified", "is_active"},
    "admins": {"id", "name", "email", "password_hash", "role", "is_active", "last_login_at", "created_at"},
    "email_verification_tokens": {"id", "student_id", "token_hash", "expires_at", "used_at", "created_at"},
    "password_reset_tokens": {"id", "student_id", "token_hash", "expires_at", "used_at", "created_at"},
    "complaints": {"id", "student_id", "student_name", "roll_number", "description", "category", "priority", "status", "created_at"},
    "lost_found": {"id", "student_id", "student_name", "roll_number", "item_type", "item_name", "description", "location", "contact", "status", "created_at"},
    "events": {"id", "title", "description", "event_date", "created_at"},
}

TARGET_COLUMNS = {
    "students": {"id", "name", "roll_number", "college_email", "password_hash", "role", "is_verified", "is_active", "created_at"},
    "admins": {"id", "name", "email", "password_hash", "role", "is_active", "last_login_at", "created_at"},
    "email_verification_tokens": {"id", "student_id", "token_hash", "expires_at", "used_at", "created_at"},
    "password_reset_tokens": {"id", "student_id", "token_hash", "expires_at", "used_at", "created_at"},
    "complaints": {"id", "student_id", "name", "roll_number", "college_email", "description", "category", "priority", "status", "created_at"},
    "lost_found": {"id", "student_id", "item_type", "item_name", "description", "location", "contact", "status", "created_at"},
    "events": {"id", "title", "description", "event_date", "created_at"},
}


class MigrationError(Exception):
    """Raised for a data or schema problem that must stop migration."""


def as_timestamp(value: Any, field: str, *, unix: bool = False, required: bool = True) -> datetime | None:
    if value is None or value == "":
        if required:
            raise MigrationError(f"{field} is NULL or empty")
        return None

    try:
        if unix:
            return datetime.fromtimestamp(float(value), tz=timezone.utc).replace(tzinfo=None)
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        text = str(value).strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        return parsed.replace(tzinfo=None)
    except (TypeError, ValueError, OverflowError, OSError) as error:
        raise MigrationError(f"Invalid timestamp in {field}: {error}") from error


def as_boolean(value: Any, field: str) -> bool:
    if value in (0, 1):
        return bool(value)
    raise MigrationError(f"{field} must contain SQLite 0 or 1, got {value!r}")


def sqlite_table_columns(db: sqlite3.Connection, table: str) -> set[str]:
    rows = db.execute(f"PRAGMA table_info({table})").fetchall()
    return {row[1] for row in rows}


def validate_source_schema(db: sqlite3.Connection) -> None:
    actual_tables = {
        row[0]
        for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    missing_tables = set(TABLE_ORDER) - actual_tables
    if missing_tables:
        raise MigrationError("SQLite is missing tables: " + ", ".join(sorted(missing_tables)))

    for table, expected_columns in SOURCE_COLUMNS.items():
        actual_columns = sqlite_table_columns(db, table)
        missing_columns = expected_columns - actual_columns
        if missing_columns:
            raise MigrationError(
                f"SQLite table {table} is missing columns: {', '.join(sorted(missing_columns))}"
            )


def validate_target_schema(cur: psycopg2.extensions.cursor) -> None:
    cur.execute(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = ANY(%s)",
        (TABLE_ORDER,),
    )
    actual = {table: set() for table in TABLE_ORDER}
    for row in cur.fetchall():
        actual[row["table_name"]].add(row["column_name"])

    for table, expected_columns in TARGET_COLUMNS.items():
        missing_columns = expected_columns - actual[table]
        if missing_columns:
            raise MigrationError(
                f"PostgreSQL table {table} is missing columns: {', '.join(sorted(missing_columns))}"
            )


def fetch_rows(db: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    return db.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()


def row_values(table: str, row: sqlite3.Row, students: dict[int, sqlite3.Row]) -> tuple[list[str], tuple[Any, ...]]:
    if table == "students":
        if row["college_email"] is None:
            raise MigrationError(f"students id {row['id']} has NULL college_email")
        return (
            ["id", "name", "roll_number", "college_email", "password_hash", "role", "is_verified", "is_active", "created_at"],
            (row["id"], row["name"], row["roll_number"], row["college_email"], row["password_hash"], row["role"], as_boolean(row["is_verified"], f"students id {row['id']} is_verified"), as_boolean(row["is_active"], f"students id {row['id']} is_active"), as_timestamp(row["created_at"], f"students id {row['id']} created_at")),
        )

    if table == "admins":
        return (
            ["id", "name", "email", "password_hash", "role", "is_active", "last_login_at", "created_at"],
            (row["id"], row["name"], row["email"], row["password_hash"], row["role"], as_boolean(row["is_active"], f"admins id {row['id']} is_active"), as_timestamp(row["last_login_at"], f"admins id {row['id']} last_login_at", required=False), as_timestamp(row["created_at"], f"admins id {row['id']} created_at")),
        )

    if table in ("email_verification_tokens", "password_reset_tokens"):
        prefix = f"{table} id {row['id']}"
        return (
            ["id", "student_id", "token_hash", "expires_at", "used_at", "created_at"],
            (row["id"], row["student_id"], row["token_hash"], as_timestamp(row["expires_at"], f"{prefix} expires_at", unix=True), as_timestamp(row["used_at"], f"{prefix} used_at", unix=True, required=False), as_timestamp(row["created_at"], f"{prefix} created_at", unix=True)),
        )

    if table == "complaints":
        student_id = row["student_id"]
        if student_id is None:
            raise MigrationError(f"complaints id {row['id']} has NULL student_id")
        student = students.get(student_id)
        if student is None:
            raise MigrationError(f"complaints id {row['id']} references missing student_id {student_id}")
        return (
            ["id", "student_id", "name", "roll_number", "college_email", "description", "category", "priority", "status", "created_at"],
            (row["id"], student_id, row["student_name"], row["roll_number"], student["college_email"], row["description"], row["category"], row["priority"], row["status"], as_timestamp(row["created_at"], f"complaints id {row['id']} created_at")),
        )

    if table == "lost_found":
        student_id = row["student_id"]
        if student_id is None:
            raise MigrationError(f"lost_found id {row['id']} has NULL student_id")
        if student_id not in students:
            raise MigrationError(f"lost_found id {row['id']} references missing student_id {student_id}")
        return (
            ["id", "student_id", "item_type", "item_name", "description", "location", "contact", "status", "created_at"],
            (row["id"], student_id, row["item_type"], row["item_name"], row["description"], row["location"], row["contact"], row["status"], as_timestamp(row["created_at"], f"lost_found id {row['id']} created_at")),
        )

    if table == "events":
        return (
            ["id", "title", "description", "event_date", "created_at"],
            (row["id"], row["title"], row["description"], as_timestamp(row["event_date"], f"events id {row['id']} event_date"), as_timestamp(row["created_at"], f"events id {row['id']} created_at")),
        )

    raise MigrationError(f"Unsupported table: {table}")


def values_match(existing: dict[str, Any], columns: list[str], values: tuple[Any, ...]) -> bool:
    return all(existing[column] == value for column, value in zip(columns, values))


def insert_or_validate(cur: psycopg2.extensions.cursor, table: str, columns: list[str], values: tuple[Any, ...]) -> str:
    cur.execute(f'SELECT {", ".join(columns)} FROM "{table}" WHERE id = %s', (values[0],))
    existing = cur.fetchone()
    if existing:
        if not values_match(existing, columns, values):
            raise MigrationError(f"PostgreSQL {table} id {values[0]} already exists with different data")
        return "existing"

    column_sql = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))
    cur.execute(f'INSERT INTO "{table}" ({column_sql}) VALUES ({placeholders})', values)
    return "inserted"


def verify_foreign_keys(cur: psycopg2.extensions.cursor) -> None:
    checks = {
        "email_verification_tokens": "student_id",
        "password_reset_tokens": "student_id",
        "complaints": "student_id",
        "lost_found": "student_id",
    }
    for table, column in checks.items():
        cur.execute(f'SELECT COUNT(*) AS invalid FROM "{table}" child LEFT JOIN students parent ON parent.id = child.{column} WHERE parent.id IS NULL')
        invalid = cur.fetchone()["invalid"]
        if invalid:
            raise MigrationError(f"{table} contains {invalid} invalid student_id reference(s)")


def reset_sequences(cur: psycopg2.extensions.cursor) -> None:
    for table in SEQUENCE_TABLES:
        cur.execute(
            "SELECT setval(pg_get_serial_sequence(%s, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) "
            f'FROM "{table}"',
            (table,),
        )


def count_postgres(cur: psycopg2.extensions.cursor, table: str) -> int:
    cur.execute(f'SELECT COUNT(*) AS count FROM "{table}"')
    return cur.fetchone()["count"]


def main() -> None:
    print("This will copy data from campus_copilot.db into PostgreSQL. The SQLite database will not be modified.")
    if input("Type MIGRATE to continue: ").strip() != "MIGRATE":
        print("Migration cancelled. No databases were changed.")
        return

    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise MigrationError("DATABASE_URL environment variable is required")
    if not os.path.exists(SOURCE_DB):
        raise MigrationError(f"SQLite database not found: {SOURCE_DB}")

    sqlite_db = sqlite3.connect(SOURCE_DB)
    sqlite_db.row_factory = sqlite3.Row
    postgres = None
    try:
        validate_source_schema(sqlite_db)
        source_rows = {table: fetch_rows(sqlite_db, table) for table in TABLE_ORDER}
        students = {row["id"]: row for row in source_rows["students"]}

        postgres = psycopg2.connect(database_url, cursor_factory=psycopg2.extras.RealDictCursor)
        with postgres.cursor() as cur:
            validate_target_schema(cur)
            migrated = {table: 0 for table in TABLE_ORDER}
            for table in TABLE_ORDER:
                for row in source_rows[table]:
                    columns, values = row_values(table, row, students)
                    if insert_or_validate(cur, table, columns, values) == "inserted":
                        migrated[table] += 1

            reset_sequences(cur)
            verify_foreign_keys(cur)
            counts = {table: count_postgres(cur, table) for table in TABLE_ORDER}
            for table in TABLE_ORDER:
                if counts[table] < len(source_rows[table]):
                    raise MigrationError(f"PostgreSQL {table} has fewer rows than SQLite after migration")

        postgres.commit()

        print("\nSQLite -> PostgreSQL Migration\n")
        for table in TABLE_ORDER:
            print(f"{table}: {len(source_rows[table])} -> {counts[table]} rows ({migrated[table]} inserted)")
        print("\nMigration completed successfully.")
    except Exception:
        if postgres is not None:
            postgres.rollback()
        raise
    finally:
        sqlite_db.close()
        if postgres is not None:
            postgres.close()


if __name__ == "__main__":
    try:
        main()
    except (MigrationError, psycopg2.Error, sqlite3.Error) as error:
        print(f"Migration failed: {error}")
        raise SystemExit(1)
