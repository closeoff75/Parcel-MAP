import cv2
import numpy as np
import math

def calculate_polygon_area(points):
    if not points or len(points) < 3: return 0.0
    area = 0.0
    for i in range(len(points) - 1):
        area += points[i][0] * points[i + 1][1] - points[i + 1][1] * points[i][0]
    return abs(area) / 2.0

def test_full_pipeline_on_image(path):
    img = cv2.imread(path)
    h, w = img.shape[:2]
    total_area = float(w * h)
    max_dim = max(w, h)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    b = img[:, :, 0].astype(np.float32)
    g = img[:, :, 1].astype(np.float32)
    r = img[:, :, 2].astype(np.float32)
    exg = 2.0 * g - r - b
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 1. WATER DETECTION
    is_water = (hsv[:, :, 0] >= 85) & (hsv[:, :, 0] <= 135) & (hsv[:, :, 1] >= 75) & (b > r * 1.5 + 20) & (b >= g - 10) & (r < 28)
    water_mask_raw = is_water.astype(np.uint8) * 255
    kernel_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    water_clean = cv2.morphologyEx(water_mask_raw, cv2.MORPH_OPEN, kernel_w)
    water_clean = cv2.morphologyEx(water_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    
    cnts_w, _ = cv2.findContours(water_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    water_mask_final = np.zeros((h, w), dtype=np.uint8)
    water_features = []
    for c in cnts_w:
        area = cv2.contourArea(c)
        if area < max(600, total_area * 0.005): continue
        m_c = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(m_c, [c], -1, 255, -1)
        std_val = float(np.std(gray[m_c > 0]))
        mean_r = float(np.mean(r[m_c > 0]))
        if std_val < 26.0 and mean_r < 20.0:
            cv2.drawContours(water_mask_final, [c], -1, 255, -1)
            water_features.append({"area": area, "std": std_val})

    water_clean = water_mask_final
    water_exclusion_mask = cv2.dilate(water_clean, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (14, 14)))

    # 2. ROADS
    is_paved = (hsv[:, :, 1] < 65) & (hsv[:, :, 2] >= 70) & (hsv[:, :, 2] <= 245) & (abs(exg) < 18.0)
    is_dirt = (hsv[:, :, 0] >= 14) & (hsv[:, :, 0] <= 42) & (hsv[:, :, 1] >= 35) & (hsv[:, :, 1] <= 170) & (hsv[:, :, 2] >= 65) & (hsv[:, :, 2] <= 215) & (exg < 10.0)
    road_surface = (is_paved | is_dirt).astype(np.uint8) * 255
    road_surface[water_clean > 0] = 0

    kernel_r = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    road_clean = cv2.morphologyEx(road_surface, cv2.MORPH_OPEN, kernel_r)
    road_bridged = cv2.morphologyEx(road_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(road_bridged, connectivity=8)

    roads = []
    road_corridor_mask = np.zeros((h, w), dtype=np.uint8)
    for l in range(1, num_labels):
        area = stats[l, cv2.CC_STAT_AREA]
        bx, by, bw, bh = stats[l, :4]
        diag = math.hypot(bw, bh)
        approx_w = area / max(1.0, diag)
        elong = diag / max(1.0, approx_w)

        if approx_w > 52.0: continue
        if area >= 320 and diag >= 45 and elong >= 1.9:
            comp_mask = (labels == l).astype(np.uint8) * 255
            dist = cv2.distanceTransform(comp_mask, cv2.DIST_L2, 5)
            pts = []
            if bw >= bh:
                step = max(8, bw // 30)
                for x in range(bx + 6, bx + bw - 6, step):
                    col_y = np.where(comp_mask[:, x] > 0)[0]
                    if len(col_y) > 0:
                        by_idx = int(col_y[np.argmax(dist[col_y, x])])
                        if water_clean[by_idx, x] == 0:
                            pts.append([int(x), by_idx])
            else:
                step = max(8, bh // 30)
                for y in range(by + 6, by + bh - 6, step):
                    row_x = np.where(comp_mask[y, :] > 0)[0]
                    if len(row_x) > 0:
                        bx_idx = int(row_x[np.argmax(dist[y, row_x])])
                        if water_clean[y, bx_idx] == 0:
                            pts.append([bx_idx, int(y)])
            if len(pts) >= 3:
                pts_np = np.array(pts, dtype=np.int32).reshape((-1, 1, 2))
                simplified = cv2.approxPolyDP(pts_np, 4.0, False).reshape(-1, 2).tolist()
                roads.append({"length": len(simplified), "width": approx_w, "pts": simplified})
                cv2.bitwise_or(road_corridor_mask, comp_mask, dst=road_corridor_mask)

    # 3. FIELDS
    smoothed = cv2.bilateralFilter(img, 9, 60, 60)
    hsv_s = cv2.cvtColor(smoothed, cv2.COLOR_BGR2HSV)
    b_s = smoothed[:, :, 0].astype(np.float32)
    g_s = smoothed[:, :, 1].astype(np.float32)
    r_s = smoothed[:, :, 2].astype(np.float32)
    exg_s = 2.0 * g_s - r_s - b_s

    is_soil = (hsv_s[:, :, 0] >= 10) & (hsv_s[:, :, 0] <= 42) & (hsv_s[:, :, 1] >= 28) & (hsv_s[:, :, 1] <= 210) & (hsv_s[:, :, 2] >= 35) & (exg_s <= 8)
    is_green_crop = (hsv_s[:, :, 0] >= 32) & (hsv_s[:, :, 0] <= 88) & (hsv_s[:, :, 1] >= 35) & (exg_s > 12)
    is_yellow_crop = (hsv_s[:, :, 0] >= 20) & (hsv_s[:, :, 0] <= 32) & (hsv_s[:, :, 1] >= 40) & (hsv_s[:, :, 2] >= 75) & (exg_s > -5)

    field_categories = [
        ("Soil Plot", is_soil),
        ("Green Crop Plot", is_green_crop),
        ("Fallow / Grain Plot", is_yellow_crop)
    ]

    road_corridor_dil = cv2.dilate(road_corridor_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
    fields = []
    for cat_name, cat_mask in field_categories:
        raw = cat_mask.astype(np.uint8) * 255
        raw[water_exclusion_mask > 0] = 0
        raw[road_corridor_dil > 0] = 0

        clean = cv2.morphologyEx(raw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
        clean = cv2.morphologyEx(clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (13, 13)))
        cnts_f, _ = cv2.findContours(clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for c in cnts_f:
            area = cv2.contourArea(c)
            if area < max(1800, total_area * 0.007) or area > (total_area * 0.50):
                continue
            hull = cv2.convexHull(c)
            solidity = area / max(1.0, cv2.contourArea(hull))
            rect = cv2.minAreaRect(c)
            rw, rh = rect[1]
            aspect = max(rw, rh) / max(1.0, min(rw, rh))

            if solidity >= 0.45 and aspect <= 4.0:
                simplified = cv2.approxPolyDP(c, 0.015 * cv2.arcLength(c, True), True).reshape(-1, 2).tolist()
                fields.append({
                    "sub_type": cat_name,
                    "area": area,
                    "solidity": solidity,
                    "aspect": aspect,
                    "coords": simplified
                })

    return len(water_features), len(roads), len(fields)

for path in ['test_assets/image_a_rural.png', 'test_assets/image_b_urban.png', 'test_assets/image_c_coastal.png', 'test_assets/image_d_agricultural.png']:
    w_cnt, r_cnt, f_cnt = test_full_pipeline_on_image(path)
    print(f"{path}: Water={w_cnt}, Roads={r_cnt}, Fields={f_cnt}")
