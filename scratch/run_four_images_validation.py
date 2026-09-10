import os
import sys
import json
import subprocess
import time

test_images = [
    ("Coastal Regression", "uploads/uav_1788964523242_0f14jo.png"),
    ("IMAGE A — Rural", "test_assets/image_a_rural.png"),
    ("IMAGE B — Urban", "test_assets/image_b_urban.png"),
    ("IMAGE C — Coastal", "test_assets/image_c_coastal.png"),
    ("IMAGE D — Agricultural", "test_assets/image_d_agricultural.png")
]

results = []

for label, img_path in test_images:
    if not os.path.exists(img_path):
        print(f"File not found: {img_path}")
        continue
    
    print(f"\n=======================================================")
    print(f"RUNNING DETECTION ON: {label} ({img_path})")
    print(f"=======================================================")
    
    t0 = time.time()
    cmd = ["python", "-B", "server/ml/ml_detector.py", "--input", img_path]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    t1 = time.time()
    
    if proc.returncode != 0:
        print(f"ERROR: {proc.stderr}")
        continue
    
    try:
        data = json.loads(proc.stdout.strip())
    except Exception as e:
        print(f"JSON Parse Error: {e}\nRaw output: {proc.stdout[:300]}")
        continue
    
    summary = data.get("summary", {})
    diag = data.get("diagnostic_summary", {})
    reasons = diag.get("rejection_reasons", {})
    
    entry = {
        "label": label,
        "path": img_path,
        "elapsed_sec": round(t1 - t0, 2),
        "summary": summary,
        "accepted": diag.get("accepted", len(data.get("features", []))),
        "rejected": diag.get("rejected", 0),
        "raw_candidates": diag.get("raw_candidates", 0),
        "rejection_reasons": reasons
    }
    results.append(entry)
    
    print(f"ACCEPTED ({entry['accepted']}): Buildings={summary.get('buildings')}, Roads={summary.get('roads')}, Fields={summary.get('fields')}, Walls={summary.get('walls')}, Fences={summary.get('fences')}, Veg={summary.get('vegetation')}, Water={summary.get('water')}")
    print(f"REJECTED ({entry['rejected']}): {reasons}")

with open("scratch/four_images_benchmark_results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)

print("\nBenchmark complete! Saved to scratch/four_images_benchmark_results.json")
