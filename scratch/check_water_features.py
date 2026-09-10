import cv2
import numpy as np
import json
import subprocess

img = cv2.imread('uploads/uav_1788964523242_0f14jo.png')
h, w = img.shape[:2]
b = img[:, :, 0].astype(np.float32)
g = img[:, :, 1].astype(np.float32)
r = img[:, :, 2].astype(np.float32)
water_ratio = (b + 5.0) / (r + 5.0)
ndwi = (b - r) / np.maximum(1.0, b + r)
is_water = ((water_ratio > 1.28) | (ndwi > 0.16)) & (g > 30) & (b > 45)
water_uint8 = is_water.astype(np.uint8) * 255
water_mask_clean = cv2.morphologyEx(water_uint8, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))

res = subprocess.check_output(['python', '-B', 'server/ml/ml_detector.py', '--input', 'uploads/uav_1788964523242_0f14jo.png'])
data = json.loads(res)

print("Total features:", len(data.get('features', [])))

for f in data.get('features', []):
    f_type = f['type']
    geom = f['geometry']
    name = f.get('name', 'unnamed')
    if f_type == 'water':
        coords = geom['coordinates'][0]
        print('=== WATER POLYGON EDGES ===')
        for i in range(len(coords)-1):
            p1 = coords[i]
            p2 = coords[i+1]
            length = np.hypot(p2[0]-p1[0], p2[1]-p1[1])
            print(f'  Water edge {p1} -> {p2}, length={length:.1f}')
    else:
        pts = geom['coordinates'][0] if geom['type'] == 'Polygon' else geom['coordinates']
        in_water = 0
        total_samples = 0
        for i in range(len(pts)-1):
            p1 = pts[i]
            p2 = pts[i+1]
            for t in np.linspace(0, 1, 10):
                x = min(w-1, max(0, int(p1[0]*(1-t) + p2[0]*t)))
                y = min(h-1, max(0, int(p1[1]*(1-t) + p2[1]*t)))
                total_samples += 1
                if water_mask_clean[y, x] > 0:
                    in_water += 1
        if in_water > 0:
            print(f'FEATURE IN WATER: [{f_type}] {name} - {in_water}/{total_samples} samples in water! pts={pts[:2]}')
