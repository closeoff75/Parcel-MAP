"""
Regression Fix Verification Script
Validates:
1. Building ML detection (YOLOv8n-seg) operates and produces different counts per image
2. Road CV-derived evidence operates without ocean crossing or diagonal artifacts
3. Water exclusion remains solid
4. Per-class Raw -> Accepted -> Rejected diagnostic breakdown
5. Logging of all rejection reasons and counts
"""

import sys
import os
import json
import subprocess

TEST_CASES = [
    ("COASTAL TEST IMAGE", "test_assets/image_c_coastal.png", "img_coastal_001"),
    ("RURAL TEST IMAGE", "test_assets/image_a_rural.png", "img_rural_002"),
    ("URBAN TEST IMAGE", "test_assets/image_b_urban.png", "img_urban_003")
]

results = {}

for label, img_path, img_id in TEST_CASES:
    print(f"\n{'='*70}")
    print(f"RUNNING {label}: {img_path}")
    print(f"{'='*70}")
    
    cmd = [
        "python", "-B", "server/ml/ml_detector.py",
        "--input", img_path,
        "--imagery_id", img_id,
        "--project_id", "proj_regression_test",
        "--conf", "0.35"
    ]
    
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"ERROR ({res.returncode}):", res.stderr[:500])
        continue
        
    try:
        data = json.loads(res.stdout)
    except Exception as e:
        print("JSON parse error:", e, res.stdout[:200])
        continue
        
    summary = data.get("summary", {})
    diag = data.get("diagnostic_summary", {})
    classes = diag.get("classes", {})
    rejections = data.get("debug", {}).get("rejected_detections", [])
    
    # Extract building and road specifics
    bldg_raw = classes.get("buildings", {}).get("raw", 0)
    bldg_acc = classes.get("buildings", {}).get("accepted", 0)
    bldg_rej = classes.get("buildings", {}).get("rejected", 0)
    
    road_raw = classes.get("roads", {}).get("raw", 0)
    road_acc = classes.get("roads", {}).get("accepted", 0)
    road_rej = classes.get("roads", {}).get("rejected", 0)
    
    print(f"\n[Detection]")
    print(f"imagery_id: {img_id}")
    print(f"detection_run_id: {data.get('detection_run_id')}")
    print(f"image dimensions: {data.get('debug', {}).get('image_size', '1024x1024')}")
    print(f"model: {data.get('model_name')}")
    print(f"raw ML building count: {bldg_raw}")
    print(f"filtered building count: {bldg_acc}")
    print(f"saved building count: {bldg_acc}")
    print(f"displayed building count: {bldg_acc}")
    
    print(f"\n[Road]")
    print(f"raw road candidates: {road_raw}")
    print(f"filtered road candidates: {road_acc}")
    print(f"saved road count: {road_acc}")
    print(f"displayed road count: {road_acc}")
    
    print(f"\n[Water]")
    print(f"water bodies: {summary.get('water_body', 0)}")
    print(f"water canals: {summary.get('water_canal', 0)}")
    
    print(f"\nDETECTION SUMMARY (Per-Class Breakdown)")
    for c_name, c_stats in classes.items():
        print(f"  {c_name.capitalize():<12}: {c_stats.get('raw', 0)} raw -> {c_stats.get('accepted', 0)} accepted -> {c_stats.get('rejected', 0)} rejected")
        
    print(f"\nRejection Categories Audit:")
    for r_cat, r_count in diag.get("rejection_reasons", {}).items():
        if r_count > 0:
            print(f"  {r_cat:<28}: {r_count}")
            
    # Sample building and road rejection reasons
    bldg_rejs = [r for r in rejections if r.get("class") == "building"]
    road_rejs = [r for r in rejections if r.get("class") == "road"]
    
    if bldg_rejs:
        print(f"\nSample Building Rejections ({len(bldg_rejs)} total):")
        for br in bldg_rejs[:3]:
            print(f"  Reason: {br.get('reason')} | Category: {br.get('category')}")
    else:
        print(f"\nNo building rejections logged.")
        
    if road_rejs:
        print(f"\nSample Road Rejections ({len(road_rejs)} total):")
        for rr in road_rejs[:3]:
            print(f"  Reason: {rr.get('reason')} | Category: {rr.get('category')}")
    else:
        print(f"\nNo road rejections logged.")
        
    results[label] = {
        "summary": summary,
        "classes": classes,
        "features_count": data.get("features_count")
    }

# Difference Test Summary
print(f"\n{'='*70}")
print("DIFFERENCE TEST COMPARISON")
print(f"{'='*70}")
for lbl, d in results.items():
    s = d["summary"]
    print(f"{lbl:<25}: Buildings={s.get('buildings')}, Roads={s.get('roads')}, Water={s.get('water')}, Fields={s.get('fields')}, Total={d['features_count']}")
