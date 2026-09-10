import cv2
import numpy as np

for img_name in ["test_assets/image_d_agricultural.png", "test_assets/image_a_rural.png"]:
    img = cv2.imread(img_name)
    h, w = img.shape[:2]
    total_area = float(w * h)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    b = img[:, :, 0].astype(np.float32)
    g = img[:, :, 1].astype(np.float32)
    r = img[:, :, 2].astype(np.float32)
    exg = 2.0 * g - r - b

    mask_soil = cv2.inRange(hsv, (10, 30, 40), (42, 220, 220))
    is_crop = (hsv[:, :, 0] >= 30) & (hsv[:, :, 0] <= 85) & (hsv[:, :, 1] >= 40) & (exg > 15)
    field_raw = (mask_soil | (is_crop.astype(np.uint8) * 255))

    # Check vegetation mask
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mean_gray = cv2.blur(gray.astype(np.float32), (7, 7))
    sq_gray = cv2.blur((gray.astype(np.float32)) ** 2, (7, 7))
    std_gray = np.sqrt(np.maximum(0.0, sq_gray - mean_gray ** 2))
    tree_canopy_raw = ((exg > 22.0) & (r >= b - 10.0) & (r >= 25.0) & (std_gray > 14.0)).astype(np.uint8) * 255
    kernel_v = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    veg_clean = cv2.morphologyEx(tree_canopy_raw, cv2.MORPH_OPEN, kernel_v)
    cnts_v, _ = cv2.findContours(veg_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    veg_mask = np.zeros((h, w), dtype=np.uint8)
    for c in sorted(cnts_v, key=cv2.contourArea, reverse=True)[:6]:
        if cv2.contourArea(c) > 200:
            cv2.drawContours(veg_mask, [c], -1, 255, -1)

    print(f"\n--- {img_name} ---")
    print(f"field_raw before subtractions: {np.count_nonzero(field_raw)}")
    print(f"veg_mask pixels: {np.count_nonzero(veg_mask)}")

    # Margin mask
    edge_margin_mask = np.zeros((h, w), dtype=np.uint8)
    edge_margin_mask[:16, :] = 255
    edge_margin_mask[-16:, :] = 255
    edge_margin_mask[:, :16] = 255
    edge_margin_mask[:, -16:] = 255

    field_raw_sub = field_raw.copy()
    field_raw_sub[veg_mask > 0] = 0
    field_raw_sub[edge_margin_mask > 0] = 0
    print(f"field_raw after veg & margin sub: {np.count_nonzero(field_raw_sub)}")

    field_clean = cv2.morphologyEx(field_raw_sub, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11)))
    field_clean = cv2.morphologyEx(field_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15)))
    cnts_f, _ = cv2.findContours(field_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    print(f"Field contours count: {len(cnts_f)}")
    for i, c in enumerate(cnts_f):
        area = cv2.contourArea(c)
        hull = cv2.convexHull(c)
        solidity = area / max(1.0, cv2.contourArea(hull))
        rect = cv2.minAreaRect(c)
        rw, rh = rect[1]
        aspect = max(rw, rh) / max(1.0, min(rw, rh))
        print(f"  Contour {i}: area={area:.0f} ({area/total_area*100:.1f}%), solidity={solidity:.2f}, aspect={aspect:.1f}")
        if area > total_area * 0.95:
            print("    -> Rejected: Excessive size (>95%)")
        elif area < total_area * 0.025:
            print(f"    -> Rejected: area < 2.5% ({total_area*0.025:.0f})")
        elif solidity < 0.60 or aspect > 2.8:
            print("    -> Rejected: solidity < 0.60 or aspect > 2.8")
