#!/usr/bin/env python3
"""Parse MariaDB mysqldump, add Excel snapshot history, emit app-compatible SQL."""

import importlib.util
import re
from datetime import datetime, timezone
from pathlib import Path

INPUT = Path(r"c:\Users\amolp\Documents\portfolio backup - Copy.sql")
OUTPUT = Path(r"c:\Users\amolp\Documents\portfolio backup - Copy_with_excel_history.sql")

SCRIPT_DIR = Path(__file__).resolve().parent
MIGRATE_MODULE = SCRIPT_DIR / "migrate_excel_history.py"

TABLES = [
    "sub_type_names",
    "sub_type_categories",
    "investments",
    "investment_history",
    "investment_transactions",
]

TABLE_COLUMNS = {
    "sub_type_names": ["id", "name", "investment_type", "created_at"],
    "sub_type_categories": ["id", "category", "sub_type_name_id", "investment_type", "created_at"],
    "investments": [
        "id", "website_app_name", "investment_type", "sub_type_name", "sub_type_category",
        "amount", "investment_date", "notes", "created_at", "updated_at",
    ],
    "investment_history": [
        "id", "investment_id", "amount", "change_date", "change_type", "notes", "created_at",
    ],
    "investment_transactions": [
        "id", "investment_id", "txn_date", "txn_type", "units", "price", "cashflow_amount", "notes", "created_at",
    ],
}


def load_snapshot_config():
    spec = importlib.util.spec_from_file_location("migrate_excel_history", MIGRATE_MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def split_sql_values(values_blob: str):
    tuples = []
    current = []
    token = ""
    in_string = False
    escape = False
    depth = 0

    def flush_token():
        nonlocal token
        if token == "":
            return
        value = token.strip()
        if value.upper() == "NULL":
            current.append(None)
        else:
            current.append(value)
        token = ""

    i = 0
    while i < len(values_blob):
        ch = values_blob[i]

        if in_string:
            if escape:
                token += ch
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == "'":
                if i + 1 < len(values_blob) and values_blob[i + 1] == "'":
                    token += "'"
                    i += 1
                else:
                    in_string = False
                    current.append(token)
                    token = ""
            else:
                token += ch
            i += 1
            continue

        if ch == "'":
            in_string = True
            i += 1
            continue

        if ch == "(":
            if depth == 0:
                current = []
                token = ""
            else:
                token += ch
            depth += 1
            i += 1
            continue

        if ch == ")":
            depth -= 1
            if depth == 0:
                flush_token()
                tuples.append(current)
                current = []
                token = ""
            else:
                token += ch
            i += 1
            continue

        if ch == "," and depth == 1:
            flush_token()
            i += 1
            continue

        if depth >= 1:
            token += ch
        i += 1

    return tuples


def parse_insert_rows(sql_text: str, table_name: str):
    pattern = re.compile(
        rf"INSERT\s+INTO\s+`{re.escape(table_name)}`\s+VALUES\s*(.+?);",
        re.IGNORECASE | re.DOTALL,
    )
    rows = []
    for match in pattern.finditer(sql_text):
        for values in split_sql_values(match.group(1)):
            row = {}
            for idx, col in enumerate(TABLE_COLUMNS[table_name]):
                row[col] = values[idx] if idx < len(values) else None
            rows.append(row)
    return rows


def escape_sql(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = str(value).replace("\\", "\\\\").replace("'", "''")
    return f"'{text}'"


def build_insert(table: str, rows: list, batch_size: int = 100):
    if not rows:
        return f"-- No data for table `{table}`\n"

    columns = TABLE_COLUMNS[table]
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


def apply_excel_history(investments, history, migrate_module):
    max_inv_id = max(int(i["id"]) for i in investments)
    max_hist_id = max(int(h["id"]) for h in history) if history else 0

    legacy_keys = migrate_module.collect_legacy_keys()
    legacy_inv_by_key = {}
    next_inv_id = max_inv_id + 1
    created_at = "2026-07-09 00:00:00"

    for platform, inv_type in legacy_keys:
        inv = {
            "id": next_inv_id,
            "website_app_name": platform,
            "investment_type": inv_type,
            "sub_type_name": "Excel Legacy",
            "sub_type_category": "Historical Snapshot",
            "amount": "0.00",
            "investment_date": f"{migrate_module.SNAPSHOTS[0]['date']} 00:00:00",
            "notes": (
                "Migrated from Google Sheets (Share Asset.xlsx) — aggregated platform totals "
                "for historical snapshots. Current amount is zero; see investment_history for past values."
            ),
            "created_at": created_at,
            "updated_at": created_at,
        }
        investments.append(inv)
        legacy_inv_by_key[(platform, inv_type)] = next_inv_id
        next_inv_id += 1

    next_hist_id = max_hist_id + 1
    new_history = []

    for inv in investments:
        if int(inv["id"]) <= max_inv_id:
            new_history.append({
                "id": next_hist_id,
                "investment_id": int(inv["id"]),
                "amount": "0.00",
                "change_date": f"{migrate_module.BASELINE_DATE} 00:00:00",
                "change_type": "added",
                "notes": "Historical baseline — investment did not exist during Excel tracking period",
                "created_at": created_at,
            })
            next_hist_id += 1

    for snap in migrate_module.SNAPSHOTS:
        cells = migrate_module.normalize_cells(snap["cells"])
        change_type = "added" if snap == migrate_module.SNAPSHOTS[0] else "updated"
        snap_date = f"{snap['date']} 00:00:00"
        for (platform, inv_type), inv_id in legacy_inv_by_key.items():
            amount = cells.get((platform, inv_type), 0)
            new_history.append({
                "id": next_hist_id,
                "investment_id": inv_id,
                "amount": migrate_module.fmt_amount(amount),
                "change_date": snap_date,
                "change_type": change_type,
                "notes": f"Migrated from Google Sheets snapshot — {snap['label']}",
                "created_at": created_at,
            })
            next_hist_id += 1

    cutoff = f"{migrate_module.LEGACY_CUTOFF} 00:00:00"
    for inv_id in legacy_inv_by_key.values():
        new_history.append({
            "id": next_hist_id,
            "investment_id": inv_id,
            "amount": "0.00",
            "change_date": cutoff,
            "change_type": "updated",
            "notes": "Excel legacy tracking ended — detailed per-folio tracking started in portfolio app",
            "created_at": created_at,
        })
        next_hist_id += 1

    history.extend(new_history)
    return {
        "legacy_investments": len(legacy_keys),
        "history_added": len(new_history),
    }


def main():
    migrate_module = load_snapshot_config()
    sql_text = INPUT.read_text(encoding="utf-8")

    data = {table: parse_insert_rows(sql_text, table) for table in TABLES}
    stats = apply_excel_history(data["investments"], data["investment_history"], migrate_module)

    exported_at = datetime.now(timezone.utc).isoformat()
    lines = [
        "-- Portfolio Management SQL Export",
        f"-- Generated: {exported_at}",
        f"-- Source: {INPUT.name} + Excel snapshot history",
        f"-- Excel snapshots migrated: {len(migrate_module.SNAPSHOTS)}",
        f"-- Excel legacy investments added: {stats['legacy_investments']}",
        f"-- Excel history records added: {stats['history_added']}",
        "SET NAMES utf8mb4;",
        "SET FOREIGN_KEY_CHECKS=0;",
        "",
    ]

    for table in TABLES:
        rows = data[table]
        lines.append(f"-- Table: {table} ({len(rows)} rows)")
        lines.append(f"LOCK TABLES `{table}` WRITE;")
        lines.append(build_insert(table, rows).rstrip())
        lines.append("UNLOCK TABLES;")
        lines.append("")

    lines.append("SET FOREIGN_KEY_CHECKS=1;")
    lines.append("")

    OUTPUT.write_text("\n".join(lines), encoding="utf-8")

    print(f"Output written to: {OUTPUT}")
    print(f"  investments: {len(data['investments'])}")
    print(f"  investment_history: {len(data['investment_history'])}")
    print(f"  legacy investments added: {stats['legacy_investments']}")
    print(f"  history records added: {stats['history_added']}")


if __name__ == "__main__":
    main()
