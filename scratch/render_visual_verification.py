"""
Visual Verification Renderer for Regression Fix
Renders GeoJSON detections over actual coastal and rural imagery to confirm:
- Buildings in cyan
- Roads in amber
- Water in blue
- No false diagonal lines crossing ocean
"""

import cv2
import numpy as np
import json
import subprocess
import os

os.makedirs("scratch", exist_ok=True)

test_configs = [
    ("Coastal", "test_assets/image_c_coastal.png", "scratch/verified_coastal_detection.png"),
    ("Rural", "test_assets/image_a_rural.png", "scratch/verified_rural_detection.png")
]

for label, img_path, out_path in test_configs:
    # Run detector
    res = subprocess.run([
        "python", "-B", "server/ml/ml_detector.py",
        "--input", img_path,
        "--conf", "0.35"
    ], capture_output=True, text=True)
    
    if res.returncode != 0:
        print(f"Error running detector on {label}:", res.stderr[:300])
        continue
        
    data = json.loads(res.stdout)
    features = data.get("features", [])
    
    img = cv2.imread(img_path)
    h, w = img.shape[:2]
    overlay = img.copy()
    
    # Render order: Water -> Fields -> Veg -> Buildings -> Walls/Fences -> Roads
    def get_rank(f):
        t = (f.get("type") or "").lower()
        if "water" in t: return 1
        if "field" in t: return 2
        if "veg" in t: return 3
        if "build" in t: return 4
        if "wall" in t or "fence" in t: return 5
        if "road" in t: return 6
        return 3

    sorted_feats = sorted(features, key=get_rank)
    
    for f in sorted_feats:
        geom = f.get("geometry", {})
        g_type = geom.get("type")
        coords = geom.get("coordinates", [])
        f_type = (f.get("type") or "").lower()
        
        if g_type == "Polygon" and coords:
            ring = np.array(coords[0], dtype=np.int32)
            if "water" in f_type:
                cv2.fillPoly(overlay, [ring], (240, 150, 40)) # Ocean blue
                cv2.polylines(img, [ring], True, (255, 180, 50), 2)
            elif "building" in f_type:
                cv2.fillPoly(overlay, [ring], (200, 180, 10)) # Cyan
                cv2.polylines(img, [ring], True, (220, 210, 0), 2)
            elif "vegetation" in f_type:
                cv2.fillPoly(overlay, [ring], (50, 180, 50)) # Green
                cv2.polylines(img, [ring], True, (70, 210, 70), 1)
            elif "field" in f_type:
                cv2.fillPoly(overlay, [ring], (50, 200, 180)) # Lime
                cv2.polylines(img, [ring], True, (60, 220, 190), 1)
        elif g_type == "LineString" and coords:
            pts = np.array(coords, dtype=np.int32).reshape((-1, 1, 2))
            if "road" in f_type:
                cv2.polylines(img, [pts], False, (20, 160, 245), 4, cv2.LINE_AA) # Amber road
            elif "wall" in f_type:
                cv2.polylines(img, [pts], False, (210, 215, 220), 2, cv2.LINE_AA) # White wall
            elif "fence" in f_type:
                cv2.polylines(img, [pts], False, (180, 80, 230), 2, cv2.LINE_AA) # Magenta fence

    cv2.addWeighted(overlay, 0.45, img, 0.55, 0, img)
    
    # Add title and summary header
    s = data.get("summary", {})
    text = f"{label}: Buildings={s.get('buildings')} | Roads={s.get('roads')} | Water={s.get('water')} | Total={len(features)}"
    cv2.rectangle(img, (10, 10), (w - 10, 50), (15, 23, 42), -1)
    cv2.putText(img, text, (20, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA)
    
    cv2.imwrite(out_path, img)
    print(f"Saved verified overlay to {out_path}")
