import sys
import os
import json
import subprocess

images = [
    ("A_rural", "test_assets/image_a_rural.png"),
    ("B_urban", "test_assets/image_b_urban.png"),
    ("C_coastal", "test_assets/image_c_coastal.png"),
    ("D_agricultural", "test_assets/image_d_agricultural.png")
]

for label, img_path in images:
    cmd = [sys.executable, "server/ml/ml_detector.py", "--input", img_path]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if p.returncode != 0:
        print(f"FAILED {label}: {p.stderr}")
        continue
    try:
        data = json.loads(p.stdout)
        summary = data.get("summary", {})
        diag = data.get("diagnostic_summary", {})
        debug = data.get("debug", {})
        rej_counts = debug.get("rejected_counts", {})
        rej_cats = debug.get("rejection_categories", {})
        
        print(f"\n=======================================================")
        print(f"IMAGE: {label} ({img_path})")
        print(f"-------------------------------------------------------")
        print(f"Accepted Features: Total={summary.get('total_features')}")
        print(f"  Buildings: {summary.get('buildings', 0)} (raw bldgs rej: {rej_counts.get('building', 0)})")
        print(f"  Roads:     {summary.get('roads', 0)} (raw roads rej: {rej_counts.get('road', 0)})")
        print(f"  Fields:    {summary.get('fields', 0)} (raw fields rej: {rej_counts.get('field', 0)})")
        print(f"  Walls:     {summary.get('walls', 0)}")
        print(f"  Fences:    {summary.get('fences', 0)}")
        print(f"  Vegetation:{summary.get('vegetation', 0)}")
        print(f"  Water:     {summary.get('water', 0)}")
        print(f"Diagnostic Summary: raw={diag.get('raw_candidates')}, accepted={diag.get('accepted')}, rejected={diag.get('rejected')}")
        print(f"Top Rejection Categories: {dict(sorted(rej_cats.items(), key=lambda x: x[1], reverse=True)[:5])}")
    except Exception as e:
        print(f"Error parsing JSON for {label}: {e}")
