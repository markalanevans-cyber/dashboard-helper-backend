import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SEED_PATH = BASE_DIR / "vehicle_scaffold_seed.json"
OUT_JSON_PATH = BASE_DIR / "tyreData.scaffold.json"

YEAR_SPLITS = [
    (2015, 2017),
    (2018, 2020),
    (2021, 2024),
]

BODY_TYPE_DEFAULTS = {
    "car": {
        "frontPsi": "",
        "rearPsi": "",
        "frontBar": "",
        "rearBar": "",
        "loadNote": "",
        "source": "",
        "confidence": "unverified"
    },
    "suv": {
        "frontPsi": "",
        "rearPsi": "",
        "frontBar": "",
        "rearBar": "",
        "loadNote": "",
        "source": "",
        "confidence": "unverified"
    },
    "mpv": {
        "frontPsi": "",
        "rearPsi": "",
        "frontBar": "",
        "rearBar": "",
        "loadNote": "",
        "source": "",
        "confidence": "unverified"
    },
    "van": {
        "frontPsi": "",
        "rearPsi": "",
        "frontBar": "",
        "rearBar": "",
        "loadNote": "",
        "source": "",
        "confidence": "unverified"
    },
    "pickup": {
        "frontPsi": "",
        "rearPsi": "",
        "frontBar": "",
        "rearBar": "",
        "loadNote": "",
        "source": "",
        "confidence": "unverified"
    }
}


def overlap(a_start, a_end, b_start, b_end):
    return max(a_start, b_start) <= min(a_end, b_end)


def main():
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    rows = []

    for make_group in seed:
        make = make_group["make"].strip().upper()

        for model_info in make_group["models"]:
            model = model_info["model"].strip().upper()
            body_type = model_info["bodyType"].strip().lower()
            year_from = int(model_info["yearFrom"])
            year_to = int(model_info["yearTo"])

            for split_start, split_end in YEAR_SPLITS:
                if not overlap(year_from, year_to, split_start, split_end):
                    continue

                row = {
                    "make": make,
                    "model": model,
                    "bodyType": body_type,
                    "yearFrom": max(year_from, split_start),
                    "yearTo": min(year_to, split_end),
                    "variant": "",
                    "frontPsi": BODY_TYPE_DEFAULTS[body_type]["frontPsi"],
                    "rearPsi": BODY_TYPE_DEFAULTS[body_type]["rearPsi"],
                    "frontBar": BODY_TYPE_DEFAULTS[body_type]["frontBar"],
                    "rearBar": BODY_TYPE_DEFAULTS[body_type]["rearBar"],
                    "loadNote": BODY_TYPE_DEFAULTS[body_type]["loadNote"],
                    "source": BODY_TYPE_DEFAULTS[body_type]["source"],
                    "confidence": BODY_TYPE_DEFAULTS[body_type]["confidence"]
                }
                rows.append(row)

    OUT_JSON_PATH.write_text(
        json.dumps(rows, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    print(f"Wrote {len(rows)} scaffold rows to {OUT_JSON_PATH}")


if __name__ == "__main__":
    main()