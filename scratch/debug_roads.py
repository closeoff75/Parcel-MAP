import cv2
import numpy as np
import math

for name in ['image_a_rural.png', 'image_b_urban.png', 'image_c_coastal.png', 'image_d_agricultural.png']:
    img = cv2.imread(f'test_assets/{name}')
    h, w = img.shape[:2]
    total_area = float(w * h)
    max_dim = max(w, h)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    b = img[:, :, 0].astype(np.float32)
    g = img[:, :, 1].astype(np.float32)
    r = img[:, :, 2].astype(np.float32)
    exg = 2.0 * g - r - b

    is_paved = (hsv[:, :, 1] < 65) & (hsv[:, :, 2] >= 70) & (hsv[:, :, 2] <= 245) & (abs(exg) < 18.0)
    is_dirt = (hsv[:, :, 0] >= 14) & (hsv[:, :, 0] <= 42) & (hsv[:, :, 1] >= 35) & (hsv[:, :, 1] <= 170) & (hsv[:, :, 2] >= 65) & (hsv[:, :, 2] <= 215) & (exg < 10.0)
    road_surface = (is_paved | is_dirt).astype(np.uint8) * 255

    kernel_r = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    road_clean = cv2.morphologyEx(road_surface, cv2.MORPH_OPEN, kernel_r)
    road_bridged = cv2.morphologyEx(road_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(road_bridged, connectivity=8)

    print(f"\n=== {name} Road Components: {num_labels - 1} ===")
    good = 0
    for l in range(1, num_labels):
        area = stats[l, cv2.CC_STAT_AREA]
        bx, by, bw, bh = stats[l, :4]
        diag = math.hypot(bw, bh)
        approx_w = area / max(1.0, diag)
        true_elongation = diag / max(1.0, approx_w)
        if area >= 300 and diag >= 45 and true_elongation >= 1.8:
            good += 1
            if good <= 5:
                print(f"  Comp {l}: area={area}, bbox=({bx},{by},{bw},{bh}), approx_w={approx_w:.1f}, elong={true_elongation:.1f}")
    print(f"  Total eligible road candidates: {good}")
