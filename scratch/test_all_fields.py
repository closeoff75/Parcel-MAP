import cv2
import numpy as np

images = [
    ("A_rural", "test_assets/image_a_rural.png"),
    ("B_urban", "test_assets/image_b_urban.png"),
    ("C_coastal", "test_assets/image_c_coastal.png"),
    ("D_agricultural", "test_assets/image_d_agricultural.png")
]

for label, path in images:
    img = cv2.imread(path)
    h, w = img.shape[:2]
    total_area = float(w * h)

    smoothed = cv2.bilateralFilter(img, 9, 60, 60)
    hsv = cv2.cvtColor(smoothed, cv2.COLOR_BGR2HSV)
    b = smoothed[:, :, 0].astype(np.float32)
    g = smoothed[:, :, 1].astype(np.float32)
    r = smoothed[:, :, 2].astype(np.float32)
    exg = 2.0 * g - r - b

    is_soil = (hsv[:, :, 0] >= 10) & (hsv[:, :, 0] <= 42) & (hsv[:, :, 1] >= 28) & (hsv[:, :, 1] <= 210) & (hsv[:, :, 2] >= 35) & (exg <= 8)
    is_green_crop = (hsv[:, :, 0] >= 32) & (hsv[:, :, 0] <= 88) & (hsv[:, :, 1] >= 35) & (exg > 12)
    is_yellow_crop = (hsv[:, :, 0] >= 20) & (hsv[:, :, 0] <= 32) & (hsv[:, :, 1] >= 40) & (hsv[:, :, 2] >= 75) & (exg > -5)

    field_categories = [
        ("Soil Plot", is_soil),
        ("Green Crop Plot", is_green_crop),
        ("Fallow / Grain Plot", is_yellow_crop)
    ]

    total_fields = []
    # Mask out water and roads
    for name, cat_mask in field_categories:
        raw = cat_mask.astype(np.uint8) * 255
        clean = cv2.morphologyEx(raw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
        clean = cv2.morphologyEx(clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (13, 13)))
        cnts, _ = cv2.findContours(clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for c in cnts:
            area = cv2.contourArea(c)
            if area < max(2000, total_area * 0.008) or area > (total_area * 0.45):
                continue
            hull = cv2.convexHull(c)
            solidity = area / max(1.0, cv2.contourArea(hull))
            rect = cv2.minAreaRect(c)
            rw, rh = rect[1]
            aspect = max(rw, rh) / max(1.0, min(rw, rh))
            if solidity >= 0.48 and aspect <= 3.8:
                total_fields.append((name, round(area), round(solidity, 2), round(aspect, 1)))
                
    print(f"=== {label} ({path}) ===")
    print(f"  Fields detected: {len(total_fields)}")
    for f in total_fields:
        print(f"    {f[0]}: area={f[1]} ({f[1]/total_area*100:.1f}%), solidity={f[2]}, aspect={f[3]}")
