#!/usr/bin/env python3
"""Convert portfolio mongo export JSON to MySQL SQL dump format."""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

INPUT = Path(r"c:\Users\amolp\Downloads\portfolio_export_2026-07-08_with_excel_history.mongo.json")
OUTPUT = Path(r"c:\Users\amolp\Downloads\portfolio_export_2026-07-09_with_excel_history.sql")

TABLES = [
    "sub_type_names",
    "sub_type_categories",
    "investments",
    "investment_history",
    "investment_transactions",
]


def parse_date(value):
    if value is None:
        return None
    if isinstance(value, dict) and "$date" in value:
        return datetime.fromisoformat(value["$date"].replace("Z", "+00:00"))
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value


def escape_sql(value):
    if value is None:
        return "NULL"
    if isinstance(value, datetime):
        return f"'{value.strftime('%Y-%m-%d %H:%M:%S')}'"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = str(value)
    text = text.replace("\\", "\\\\").replace("'", "''")
    return f"'{text}'"


def build_insert(table, rows, batch_size=100):
    if not rows:
        return f"-- No data for table `{table}`\n"

    columns = list(rows[0].keys())
    column_list = ", ".join(f"`{c}`" for c in columns)
    chunks = []

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        values = []
        for row in batch:
            vals = ", ".join(escape_sql(row.get(col)) for col in columns)
            values.append(f"({vals})")
        chunks.append(
            f"INSERT INTO `{table}` ({column_list}) VALUES\n" + ",\n".join(values) + ";"
        )

    return "\n\n".join(chunks) + "\n"


def normalize_row(row):
    out = {}
    for key, value in row.items():
        if key == "_id":
            continue
        if isinstance(value, dict) and "$date" in value:
            out[key] = parse_date(value)
        else:
            out[key] = value
    return out


def main():
    with INPUT.open(encoding="utf-8") as f:
        data = json.load(f)

    exported_at = datetime.now(timezone.utc).isoformat()
    meta = data.get("meta", {})
    lines = [
        "-- Portfolio Management SQL Export",
        f"-- Generated: {exported_at}",
        "-- Source: mongo-json-with-excel-history",
        f"-- Excel snapshots migrated: {meta.get('excelHistorySnapshots', 'n/a')}",
        f"-- Excel legacy investments: {meta.get('excelLegacyInvestments', 'n/a')}",
        "SET NAMES utf8mb4;",
        "SET FOREIGN_KEY_CHECKS=0;",
        "",
    ]

    collections = data["collections"]
    counts = {}

    for table in TABLES:
        rows = [normalize_row(r) for r in collections.get(table, [])]
        counts[table] = len(rows)
        lines.append(f"-- Table: {table} ({len(rows)} rows)")
        lines.append(f"LOCK TABLES `{table}` WRITE;")
        lines.append(build_insert(table, rows).rstrip())
        lines.append("UNLOCK TABLES;")
        lines.append("")

    lines.append("SET FOREIGN_KEY_CHECKS=1;")
    lines.append("")

    sql = "\n".join(lines)
    OUTPUT.write_text(sql, encoding="utf-8")

    print(f"Output written to: {OUTPUT}")
    for table in TABLES:
        print(f"  {table}: {counts[table]} rows")


if __name__ == "__main__":
    main()
