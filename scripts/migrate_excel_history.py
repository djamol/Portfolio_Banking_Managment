#!/usr/bin/env python3
"""
Migrate historical portfolio snapshots from Google Sheets Excel tracking
into portfolio MongoDB export format.
"""

import json
import copy
from datetime import datetime, timezone
from pathlib import Path

INPUT = Path(r"c:\Users\amolp\Downloads\portfolio_export_2026-07-06.mongo.json")
OUTPUT = Path(r"c:\Users\amolp\Downloads\portfolio_export_2026-07-08_with_excel_history.mongo.json")

# Excel company -> app platform name
PLATFORM_MAP = {
    "DCB": "DCB",
    "Dhan App": "Dhan App",
    "HDFC": "HDFC",
    "ICICI": "ICICI",
    "ICICID": "ICICI Direct",
    "Kotak Neo": "Kotak Neo",
    "CoinDCX": "CoinDCX",
}

# Excel type -> app investment type
TYPE_MAP = {
    "FD": "FD",
    "MF": "Mutual Fund",
    "Mutual Fund": "Mutual Fund",
    "NCDBond": "Bond",
    "PPF": "PPF",
    "SB": "Saving Bank Balance",
    "SmartWealth MF": "Mutual Fund",
    "Stock": "Stock",
    "Stock_ETF": "ETF",
    "SV Gold Bond": "Bond",
    "T Crypto": "Crypto",
}

# SmartWealth MF is tracked under HDFC Invest Now in the current app
SMARTWEALTH_PLATFORM = "HDFC Invest Now"

# Snapshot dates from Google Sheets version history (pivot table totals)
# Each entry: date (YYYY-MM-DD), cells as {(excel_type, excel_platform): amount}
SNAPSHOTS = [
    {
        "date": "2023-12-15",
        "label": "December 15, 2023",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2500000,  # estimated from ratios; HDFC total ~5.19M
            ("FD", "ICICI"): 312792,
            ("FD", "ICICID"): 400000,
            ("Mutual Fund", "HDFC"): 3500000,
            ("Mutual Fund", "ICICID"): 2800000,
            ("SB", "DCB"): 5173,
            ("SB", "HDFC"): 16000,
            ("SB", "ICICI"): 12000,
            ("PPF", "ICICI"): 87681,
            ("Bond", "ICICID"): 123087,  # NCDBond + SV Gold approx
        },
        "note": "Approximate breakdown from Dec 2023 summary totals",
    },
    {
        "date": "2024-06-25",
        "label": "June 25, 2024",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2213609,
            ("FD", "ICICI"): 312792,
            ("FD", "ICICID"): 513000,
            ("Mutual Fund", "Dhan App"): 1120,
            ("Mutual Fund", "HDFC"): 4071389.64,
            ("Mutual Fund", "ICICID"): 3045545.64,
            ("Bond", "ICICID"): 123087,  # NCDBond 20,799 + SV Gold Bond 102,288
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 5173,
            ("Saving Bank Balance", "HDFC"): 1600,
            ("Saving Bank Balance", "ICICI"): 1200,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 60500,
            ("Stock", "Dhan App"): 10000,
        },
    },
    {
        "date": "2024-07-05",
        "label": "July 5, 2024",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2370609,
            ("FD", "ICICI"): 312792,
            ("FD", "ICICID"): 390000,
            ("Mutual Fund", "Dhan App"): 1120,
            ("Mutual Fund", "HDFC"): 4268903.99,
            ("Mutual Fund", "ICICID"): 2951346.96,
            ("Bond", "ICICID"): 123087,
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 5173,
            ("Saving Bank Balance", "HDFC"): 1600,
            ("Saving Bank Balance", "ICICI"): 1200,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 60500,
            ("Stock", "Dhan App"): 115000,
        },
    },
    {
        "date": "2024-08-25",
        "label": "August 25, 2024",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2410609,
            ("FD", "ICICI"): 312792,
            ("FD", "ICICID"): 124000,
            ("Mutual Fund", "Dhan App"): 1816,
            ("Mutual Fund", "HDFC"): 4066326,
            ("Mutual Fund", "ICICID"): 3110921.28,
            ("Mutual Fund", "Kotak Neo"): 64066,
            ("Bond", "ICICID"): 123087,
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 1000,
            ("Saving Bank Balance", "HDFC"): 1600,
            ("Saving Bank Balance", "ICICI"): 1200,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 179733,
            ("Stock", "Dhan App"): 530109,
        },
    },
    {
        "date": "2024-09-28",
        "label": "September 28, 2024",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2500609,
            ("FD", "ICICI"): 312792,
            ("FD", "ICICID"): 124000,
            ("Mutual Fund", "Dhan App"): 1816,
            ("Mutual Fund", "HDFC"): 4207817.63,
            ("Mutual Fund", "ICICID"): 3243646.24,
            ("Mutual Fund", "Kotak Neo"): 141000,
            ("Bond", "ICICID"): 123087,
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 1000,
            ("Saving Bank Balance", "HDFC"): 1600,
            ("Saving Bank Balance", "ICICI"): 1200,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 182000,
            ("Stock", "Dhan App"): 500109,
        },
    },
    {
        "date": "2025-06-09",
        "label": "June 9, 2025",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2955609,
            ("FD", "ICICI"): 220836,
            ("FD", "ICICID"): 50000,
            ("Mutual Fund", "Dhan App"): 311711,
            ("Mutual Fund", "HDFC"): 3757877,
            ("Mutual Fund", "ICICID"): 2992582,
            ("Mutual Fund", "Kotak Neo"): 957000,
            ("Bond", "ICICID"): 157970,  # NCDBond 20,799 + SV Gold Bond 137,171
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 1000,
            ("Saving Bank Balance", "HDFC"): 49000,
            ("Saving Bank Balance", "ICICI"): 15000,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 263489,
            ("Stock", "Dhan App"): 139355,
        },
    },
    {
        "date": "2025-06-27",
        "label": "June 27, 2025",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2955609,
            ("FD", "ICICI"): 220836,
            ("FD", "ICICID"): 50000,
            ("Mutual Fund", "Dhan App"): 425000,
            ("Mutual Fund", "HDFC"): 3814004,
            ("Mutual Fund", "ICICID"): 3036760,
            ("Mutual Fund", "Kotak Neo"): 972000,
            ("Bond", "ICICID"): 158799,
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 1000,
            ("Saving Bank Balance", "HDFC"): 1000,
            ("Saving Bank Balance", "ICICI"): 1000,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 266000,
            ("Stock", "Dhan App"): 93800,
        },
    },
    {
        "date": "2025-07-04",
        "label": "July 4, 2025",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2955609,
            ("FD", "ICICI"): 220836,
            ("FD", "ICICID"): 50000,
            ("Mutual Fund", "Dhan App"): 425000,
            ("Mutual Fund", "HDFC"): 3814004,
            ("Mutual Fund", "ICICID"): 3036760,
            ("Mutual Fund", "Kotak Neo"): 972000,
            ("Bond", "ICICID"): 158799,
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 1000,
            ("Saving Bank Balance", "HDFC"): 1000,
            ("Saving Bank Balance", "ICICI"): 1000,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 266000,
            ("Stock", "Dhan App"): 93800,
        },
    },
    {
        "date": "2025-07-24",
        "label": "July 24, 2025",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2955609,
            ("FD", "ICICI"): 220836,
            ("FD", "ICICID"): 50000,
            ("Mutual Fund", "Dhan App"): 547900,
            ("Mutual Fund", "HDFC"): 3842500,
            ("Mutual Fund", "ICICID"): 2921900,
            ("Mutual Fund", "Kotak Neo"): 974000,
            ("Bond", "ICICID"): 160799,
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 18000,
            ("Saving Bank Balance", "HDFC"): 70000,
            ("Saving Bank Balance", "ICICI"): 82000,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 269000,
            ("Stock", "Dhan App"): 158000,
        },
    },
    {
        "date": "2025-07-25",
        "label": "July 25, 2025",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2955609,
            ("FD", "ICICI"): 220836,
            ("FD", "ICICID"): 50000,
            ("Mutual Fund", "Dhan App"): 633000,
            ("Mutual Fund", "HDFC"): 3842500,
            ("Mutual Fund", "ICICID"): 2921900,
            ("Mutual Fund", "Kotak Neo"): 974000,
            ("Bond", "ICICID"): 160799,
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 18000,
            ("Saving Bank Balance", "HDFC"): 106000,
            ("Saving Bank Balance", "ICICI"): 46000,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 269000,
            ("Stock", "Dhan App"): 212000,
        },
    },
    {
        "date": "2025-07-31",
        "label": "July 31, 2025",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2955609,
            ("FD", "ICICI"): 220836,
            ("FD", "ICICID"): 50000,
            ("Mutual Fund", "Dhan App"): 688000,
            ("Mutual Fund", "HDFC"): 3842500,
            ("Mutual Fund", "ICICID"): 2921900,
            ("Mutual Fund", "Kotak Neo"): 974000,
            ("Bond", "ICICID"): 194799,
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 5000,
            ("Saving Bank Balance", "HDFC"): 50000,
            ("Saving Bank Balance", "ICICI"): 46000,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 269000,
            ("Stock", "Dhan App"): 297000,
        },
    },
    {
        "date": "2025-09-11",
        "label": "September 11, 2025",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2955609,
            ("FD", "ICICI"): 220836,
            ("FD", "ICICID"): 50000,
            ("Mutual Fund", "Dhan App"): 688000,
            ("Mutual Fund", "HDFC"): 3842500,
            ("Mutual Fund", "ICICID"): 2921900,
            ("Mutual Fund", "Kotak Neo"): 974000,
            ("Bond", "ICICID"): 194799,
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 5000,
            ("Saving Bank Balance", "HDFC"): 50000,
            ("Saving Bank Balance", "ICICI"): 46000,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 269000,
            ("Stock", "Dhan App"): 297000,
        },
    },
    {
        "date": "2025-11-14",
        "label": "November 14, 2025",
        "cells": {
            ("FD", "DCB"): 210592,
            ("FD", "HDFC"): 2955609,
            ("FD", "ICICI"): 220836,
            ("FD", "ICICID"): 50000,
            ("Mutual Fund", "Dhan App"): 891000,
            ("Mutual Fund", "HDFC"): 3875000,
            ("Mutual Fund", "ICICID"): 3015000,
            ("Mutual Fund", "Kotak Neo"): 904000,
            ("Bond", "ICICID"): 207799,
            ("PPF", "ICICI"): 87681,
            ("Saving Bank Balance", "DCB"): 5000,
            ("Saving Bank Balance", "HDFC"): 5000,
            ("Saving Bank Balance", "ICICI"): 18000,
            ("Mutual Fund", SMARTWEALTH_PLATFORM): 283000,
            ("ETF", "Dhan App"): 501300,
            ("Crypto", "CoinDCX"): 104000,
        },
    },
]

LEGACY_CUTOFF = "2026-01-18"  # App detailed tracking starts ~Jan 19, 2026
BASELINE_DATE = "2020-01-01"  # Zero baseline for existing investments at historical dates


def to_mongo_date(date_str: str) -> dict:
    """Convert YYYY-MM-DD to MongoDB extended JSON date (UTC midnight)."""
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return {"$date": dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")}


def normalize_cells(raw_cells: dict) -> dict:
    """Merge duplicate platform+type keys and map excel names."""
    merged = {}
    for (excel_type, platform), amount in raw_cells.items():
        if amount is None or amount == 0:
            continue
        inv_type = TYPE_MAP.get(excel_type, excel_type)
        if inv_type in TYPE_MAP.values():
            pass
        elif excel_type in TYPE_MAP:
            inv_type = TYPE_MAP[excel_type]
        plat = PLATFORM_MAP.get(platform, platform)
        key = (plat, inv_type)
        merged[key] = merged.get(key, 0) + float(amount)
    return merged


def collect_legacy_keys():
    keys = set()
    for snap in SNAPSHOTS:
        keys.update(normalize_cells(snap["cells"]).keys())
    return sorted(keys)


def fmt_amount(val: float) -> str:
    return f"{val:.2f}"


def main():
    with INPUT.open(encoding="utf-8") as f:
        data = json.load(f)

    investments = data["collections"]["investments"]
    history = data["collections"]["investment_history"]

    max_inv_id = max(i["id"] for i in investments)
    max_hist_id = max(h["id"] for h in history)

    legacy_keys = collect_legacy_keys()
    legacy_inv_by_key = {}
    next_inv_id = max_inv_id + 1

    for platform, inv_type in legacy_keys:
        inv = {
            "id": next_inv_id,
            "website_app_name": platform,
            "investment_type": inv_type,
            "sub_type_name": "Excel Legacy",
            "sub_type_category": "Historical Snapshot",
            "amount": "0.00",
            "investment_date": to_mongo_date(SNAPSHOTS[0]["date"]),
            "notes": "Migrated from Google Sheets (Share Asset.xlsx) — aggregated platform totals for historical snapshots. Current amount is zero; see investment_history for past values.",
            "created_at": to_mongo_date("2026-07-08"),
            "updated_at": to_mongo_date("2026-07-08"),
        }
        investments.append(inv)
        legacy_inv_by_key[(platform, inv_type)] = next_inv_id
        next_inv_id += 1

    next_hist_id = max_hist_id + 1
    new_history = []

    # Add zero baseline for all pre-existing investments so they don't inflate old snapshots
    existing_ids = [i["id"] for i in investments if i["id"] <= max_inv_id]
    for inv_id in existing_ids:
        new_history.append({
            "id": next_hist_id,
            "investment_id": inv_id,
            "amount": "0.00",
            "change_date": to_mongo_date(BASELINE_DATE),
            "change_type": "added",
            "notes": "Historical baseline — investment did not exist during Excel tracking period",
            "created_at": to_mongo_date("2026-07-08"),
        })
        next_hist_id += 1

    # Add snapshot history for legacy investments
    for snap in SNAPSHOTS:
        cells = normalize_cells(snap["cells"])
        snap_date = snap["date"]
        for (platform, inv_type), inv_id in legacy_inv_by_key.items():
            amount = cells.get((platform, inv_type), 0)
            new_history.append({
                "id": next_hist_id,
                "investment_id": inv_id,
                "amount": fmt_amount(amount),
                "change_date": to_mongo_date(snap_date),
                "change_type": "updated" if snap != SNAPSHOTS[0] else "added",
                "notes": f"Migrated from Google Sheets snapshot — {snap['label']}",
                "created_at": to_mongo_date("2026-07-08"),
            })
            next_hist_id += 1

    # Zero out legacy investments when app tracking took over
    for (platform, inv_type), inv_id in legacy_inv_by_key.items():
        new_history.append({
            "id": next_hist_id,
            "investment_id": inv_id,
            "amount": "0.00",
            "change_date": to_mongo_date(LEGACY_CUTOFF),
            "change_type": "updated",
            "notes": "Excel legacy tracking ended — detailed per-folio tracking started in portfolio app",
            "created_at": to_mongo_date("2026-07-08"),
        })
        next_hist_id += 1

    history.extend(new_history)

    data["meta"]["exportedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    data["meta"]["excelHistoryMigratedAt"] = data["meta"]["exportedAt"]
    data["meta"]["excelHistorySnapshots"] = len(SNAPSHOTS)
    data["meta"]["excelLegacyInvestments"] = len(legacy_keys)

    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    # Validation summary
    def portfolio_total_at(date_str):
        inv_by_id = {i["id"]: i for i in investments}
        hist_by_inv = {}
        for h in history:
            hist_by_inv.setdefault(h["investment_id"], []).append(h)

        total = 0
        for inv in investments:
            inv_id = inv["id"]
            relevant = [
                h for h in hist_by_inv.get(inv_id, [])
                if h["change_date"]["$date"][:10] <= date_str
            ]
            if relevant:
                relevant.sort(key=lambda h: (h["change_date"]["$date"], h["id"]))
                total += float(relevant[-1]["amount"])
            else:
                total += float(inv["amount"])
        return total

    print(f"Output written to: {OUTPUT}")
    print(f"Legacy investments added: {len(legacy_keys)}")
    print(f"History records added: {len(new_history)}")
    print(f"Total investments: {len(investments)}")
    print(f"Total history: {len(history)}")
    print("\nSnapshot totals (reconstructed):")
    for snap in SNAPSHOTS:
        d = snap["date"]
        print(f"  {snap['label']:30} {portfolio_total_at(d):>15,.2f}")


if __name__ == "__main__":
    main()
