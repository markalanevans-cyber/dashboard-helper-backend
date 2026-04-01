import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
INPUT_PATH = BASE_DIR / "tyreData.filled.json"
OUTPUT_PATH = BASE_DIR / "tyreData.json"


def is_complete(row):
    required = ["make", "model", "yearFrom", "yearTo", "frontPsi", "rearPsi", "frontBar", "rearBar"]
    for key in required:
      value = row.get(key, "")
      if value is None:
          return False
      if isinstance(value, str) and not value.strip():
          return False
    return True


def main():
    rows = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    clean = []

    for row in rows:
        if not is_complete(row):
            continue

        clean.append({
            "make": row["make"].strip().upper(),
            "model": row["model"].strip().upper(),
            "yearFrom": int(row["yearFrom"]),
            "yearTo": int(row["yearTo"]),
            "frontPsi": row["frontPsi"].strip(),
            "rearPsi": row["rearPsi"].strip(),
            "frontBar": row["frontBar"].strip(),
            "rearBar": row["rearBar"].strip(),
            "loadNote": row.get("loadNote", "").strip(),
            "source": row.get("source", "Curated tyre database").strip() or "Curated tyre database"
        })

    OUTPUT_PATH.write_text(
        json.dumps(clean, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    print(f"Wrote {len(clean)} verified rows to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()