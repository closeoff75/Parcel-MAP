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

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    b = img[:, :, 0].astype(np.float32)
    g = img[:, :, 1].astype(np.float32)
    r = img[:, :, 2].astype(np.float32)

    # Spectral water filter: must have low red, high blue dominance
    is_water = (hsv[:, :, 0] >= 85) & (hsv[:, :, 0] <= 135) & (hsv[:, :, 1] >= 75) & (b > r * 1.5 + 20) & (b >= g - 10) & (r < 28)
    water_mask_raw = is_water.astype(np.uint8) * 255

    kernel_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    water_clean = cv2.morphologyEx(water_mask_raw, cv2.MORPH_OPEN, kernel_w)
    water_clean = cv2.morphologyEx(water_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cnts, _ = cv2.findContours(water_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    verified_water = []
    for c in cnts:
        area = cv2.contourArea(c)
        if area < max(600, total_area * 0.005):
            continue
        mask_c = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(mask_c, [c], -1, 255, -1)
        pts_gray = gray[mask_c > 0]
        std_val = float(np.std(pts_gray))
        mean_r = float(np.mean(r[mask_c > 0]))
        mean_b = float(np.mean(b[mask_c > 0]))
        rect = cv2.minAreaRect(c)
        rw, rh = rect[1]
        aspect = max(rw, rh) / max(1.0, min(rw, rh))
        
        # Smooth surface check (water is specular and smooth, unlike rough ground or shadow)
        if std_val < 26.0 and mean_r < 20.0:
            verified_water.append((round(area), round(std_val, 1), round(mean_b, 1), round(mean_r, 1), round(aspect, 1)))

    print(f"=== {label} Water Bodies: {len(verified_water)} ===")
    for vw in verified_water:
        print(f"  Area={vw[0]} ({vw[0]/total_area*100:.1f}%), std={vw[1]}, B={vw[2]}, R={vw[3]}, aspect={vw[4]}")
