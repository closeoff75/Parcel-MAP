import cv2
import numpy as np
import math
import json

CLASS_CONFIDENCE_THRESHOLDS = {
    "building": 0.50,
    "road": 0.65,
    "field": 0.60,
    "wall": 0.70,
    "fence": 0.75,
    "vegetation": 0.60,
    "water_body": 0.60,
    "water_canal": 0.75
}

def run_test(image_path):
    img = cv2.imread(image_path)
    if img is None:
        print("Cannot load:", image_path)
        return
    h, w = img.shape[:2]
    total_area = float(w * h)
    max_dim = max(w, h)

    rejections = []
    rejection_categories = {
        "Water crossing": 0,
        "Unsupported line": 0,
        "Image-edge artifact": 0,
        "Insufficient continuity": 0,
        "Invalid geometry": 0,
        "Duplicate geometry": 0,
        "Weak evidence": 0,
        "Excessive size": 0,
        "Disconnected feature": 0
    }

    def log_rejection(cat, cls, reason, coords=None, score=0.40):
        rejection_categories[cat] = rejection_categories.get(cat, 0) + 1
        rejections.append({
            "category": cat,
            "class": cls,
            "reason": reason,
            "score": score,
            "threshold": CLASS_CONFIDENCE_THRESHOLDS.get(cls, 0.60),
            "coordinates": coords or []
        })

    # Edge margin mask
    edge_margin_mask = np.zeros((h, w), dtype=np.uint8)
    edge_margin_mask[:16, :] = 255
    edge_margin_mask[-16:, :] = 255
    edge_margin_mask[:, :16] = 255
    edge_margin_mask[:, -16:] = 255

    # 1. Water Detection & Hard Exclusion Mask
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    b = img[:, :, 0].astype(np.float32)
    g = img[:, :, 1].astype(np.float32)
    r = img[:, :, 2].astype(np.float32)

    is_water = (hsv[:, :, 0] >= 90) & (hsv[:, :, 0] <= 130) & (hsv[:, :, 1] >= 100) & (b > r + 25) & (b >= g - 10)
    water_uint8 = is_water.astype(np.uint8) * 255
    water_clean = cv2.morphologyEx(water_uint8, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    water_clean = cv2.morphologyEx(water_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))

    water_exclusion_mask = cv2.dilate(water_clean, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    coastline_edge = cv2.morphologyEx(water_clean, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    coastline_exclusion_mask = cv2.dilate(coastline_edge, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (20, 20)))

    water_features = []
    cnts_w, _ = cv2.findContours(water_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in cnts_w:
        area = cv2.contourArea(c)
        if area < max(600.0, total_area * 0.005):
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.004 * peri, True)
        pts = approx.reshape(-1, 2).tolist()
        if len(pts) < 4:
            continue
        pts.append(pts[0])
        water_features.append({
            "type": "water",
            "name": "Water Body (Coastal / Ocean)",
            "geometry": {"type": "Polygon", "coordinates": [pts]},
            "area": area
        })

    # 2. Road Detection
    exg = 2.0 * g - r - b
    is_paved = (hsv[:, :, 1] < 75) & (hsv[:, :, 2] >= 45) & (hsv[:, :, 2] <= 230) & (exg < 12.0)
    is_dirt = (hsv[:, :, 0] >= 14) & (hsv[:, :, 0] <= 42) & (hsv[:, :, 1] >= 40) & (hsv[:, :, 1] <= 180) & (hsv[:, :, 2] >= 50) & (hsv[:, :, 2] <= 220) & (exg < 10.0)

    road_surface = (is_paved | is_dirt).astype(np.uint8) * 255
    road_surface[water_exclusion_mask > 0] = 0
    road_surface[edge_margin_mask > 0] = 0

    road_clean = cv2.morphologyEx(road_surface, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    road_bridged = cv2.morphologyEx(road_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
    
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(road_bridged, connectivity=8)
    roads = []
    road_corridor_mask = np.zeros((h, w), dtype=np.uint8)

    for l in range(1, num_labels):
        area = stats[l, cv2.CC_STAT_AREA]
        bx, by, bw, bh = stats[l, :4]
        diag = math.hypot(bw, bh)
        approx_w = area / max(1.0, diag)
        true_elongation = diag / max(1.0, approx_w)

        if area > 900 and diag > 95 and true_elongation >= 2.4:
            comp_mask = (labels == l).astype(np.uint8) * 255
            dist = cv2.distanceTransform(comp_mask, cv2.DIST_L2, 5)

            pts = []
            if bw >= bh:
                step = max(10, bw // 28)
                for x in range(bx + 14, bx + bw - 14, step):
                    col_y = np.where(comp_mask[:, x] > 0)[0]
                    if len(col_y) > 0:
                        best_y = int(col_y[np.argmax(dist[col_y, x])])
                        if water_exclusion_mask[best_y, x] == 0:
                            pts.append([int(x), best_y])
            else:
                step = max(10, bh // 28)
                for y in range(by + 14, by + bh - 14, step):
                    row_x = np.where(comp_mask[y, :] > 0)[0]
                    if len(row_x) > 0:
                        best_x = int(row_x[np.argmax(dist[y, row_x])])
                        if water_exclusion_mask[y, best_x] == 0:
                            pts.append([best_x, int(y)])

            if len(pts) >= 4:
                pts_np = np.array(pts, dtype=np.int32).reshape((-1, 1, 2))
                epsilon = max(3.0, 0.015 * cv2.arcLength(pts_np, False))
                simplified = cv2.approxPolyDP(pts_np, epsilon, False).reshape(-1, 2).tolist()

                # Check water crossing
                crosses_water = False
                for i in range(len(simplified) - 1):
                    p1, p2 = simplified[i], simplified[i + 1]
                    for t in np.linspace(0, 1, 12):
                        sx = min(w - 1, max(0, int(p1[0] * (1 - t) + p2[0] * t)))
                        sy = min(h - 1, max(0, int(p1[1] * (1 - t) + p2[1] * t)))
                        if water_exclusion_mask[sy, sx] > 0:
                            crosses_water = True
                            break
                    if crosses_water:
                        break

                if crosses_water:
                    log_rejection("Water crossing", "road", "Road segment intersects water exclusion region / ocean", simplified)
                    continue

                start_pt = simplified[0]
                end_pt = simplified[-1]
                # Image edge check
                if (start_pt[0] < 15 or start_pt[0] > w - 15 or start_pt[1] < 15 or start_pt[1] > h - 15) and \
                   (end_pt[0] < 15 or end_pt[0] > w - 15 or end_pt[1] < 15 or end_pt[1] > h - 15):
                    log_rejection("Image-edge artifact", "road", "Road spans canvas edge-to-edge without grounded terminal", simplified)
                    continue

                roads.append({
                    "type": "road",
                    "geometry": {"type": "LineString", "coordinates": simplified}
                })
                road_corridor_mask = cv2.bitwise_or(road_corridor_mask, comp_mask)

    # 3. Field Detection
    mask_soil = cv2.inRange(hsv, (10, 30, 40), (42, 220, 220))
    is_crop = (hsv[:, :, 0] >= 35) & (hsv[:, :, 0] <= 80) & (hsv[:, :, 1] >= 50) & (exg > 20)
    field_cand = (mask_soil | (is_crop.astype(np.uint8) * 255))
    field_cand[water_exclusion_mask > 0] = 0
    field_cand[road_corridor_mask > 0] = 0
    field_cand[edge_margin_mask > 0] = 0

    field_clean = cv2.morphologyEx(field_cand, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11)))
    field_clean = cv2.morphologyEx(field_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15)))

    cnts_f, _ = cv2.findContours(field_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    fields = []
    for c in cnts_f:
        area = cv2.contourArea(c)
        if area > total_area * 0.25:
            log_rejection("Excessive size", "field", f"Field candidate exceeds maximum region threshold ({area/total_area*100:.1f}%)")
            continue
        if area < total_area * 0.025:
            continue
        hull = cv2.convexHull(c)
        hull_area = cv2.contourArea(hull)
        solidity = area / max(1.0, hull_area)
        rect = cv2.minAreaRect(c)
        aspect = max(rect[1]) / max(1.0, min(rect[1]))

        if solidity < 0.65 or aspect > 2.8:
            log_rejection("Invalid geometry", "field", f"Non-convex agricultural geometry (solidity={solidity:.2f}, aspect={aspect:.1f})")
            continue

        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.015 * peri, True)
        pts = approx.reshape(-1, 2).tolist()
        if len(pts) >= 4:
            pts.append(pts[0])
            fields.append({
                "type": "field",
                "geometry": {"type": "Polygon", "coordinates": [pts]},
                "area": area
            })

    # 4. Stone Walls & Fences
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 70, 180)
    edges[water_exclusion_mask > 0] = 0
    edges[coastline_exclusion_mask > 0] = 0
    edges[road_corridor_mask > 0] = 0
    edges[edge_margin_mask > 0] = 0

    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=45, minLineLength=35, maxLineGap=8)
    walls = []
    fences = []
    
    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad_mag = cv2.magnitude(grad_x, grad_y)

    if lines is not None:
        kept = []
        for s in lines.reshape(-1, 4).tolist():
            length = math.hypot(s[2] - s[0], s[3] - s[1])
            if length < 35 or length > 180:
                continue

            # Check if line touches edge margin
            if s[0] < 18 or s[0] > w - 18 or s[1] < 18 or s[1] > h - 18 or \
               s[2] < 18 or s[2] > w - 18 or s[3] < 18 or s[3] > h - 18:
                log_rejection("Image-edge artifact", "boundary", "Boundary segment terminates at canvas margin", [[s[0], s[1]], [s[2], s[3]]])
                continue

            # Check samples along line against water and coastline
            crosses_w = False
            for t in np.linspace(0, 1, 10):
                lx = int(s[0] * (1 - t) + s[2] * t)
                ly = int(s[1] * (1 - t) + s[3] * t)
                if water_exclusion_mask[ly, lx] > 0 or coastline_exclusion_mask[ly, lx] > 0:
                    crosses_w = True
                    break
            if crosses_w:
                log_rejection("Water crossing", "boundary", "Boundary line crosses water exclusion mask / coastline surf", [[s[0], s[1]], [s[2], s[3]]])
                continue

            # Check road curb overlap
            crosses_r = False
            for t in np.linspace(0, 1, 10):
                lx = int(s[0] * (1 - t) + s[2] * t)
                ly = int(s[1] * (1 - t) + s[3] * t)
                if road_corridor_mask[ly, lx] > 0:
                    crosses_r = True
                    break
            if crosses_r:
                log_rejection("Unsupported line", "boundary", "Boundary line coincides with road pavement curb", [[s[0], s[1]], [s[2], s[3]]])
                continue

            mx = int((s[0] + s[2]) / 2)
            my = int((s[1] + s[3]) / 2)
            is_dup = False
            for k in kept:
                d = math.hypot(mx - (k[0] + k[2]) / 2, my - (k[1] + k[3]) / 2)
                if d < 18:
                    is_dup = True
                    log_rejection("Duplicate geometry", "boundary", "Duplicate parallel boundary candidate within 18px", [[s[0], s[1]], [s[2], s[3]]])
                    break
            if not is_dup:
                kept.append(s)

        for s in kept:
            mx = int((s[0] + s[2]) / 2)
            my = int((s[1] + s[3]) / 2)
            patch = gray[max(0, my - 3):min(h, my + 4), max(0, mx - 3):min(w, mx + 4)]
            patch_grad = grad_mag[max(0, my - 3):min(h, my + 4), max(0, mx - 3):min(w, mx + 4)]
            avg_grad = float(np.mean(patch_grad)) if patch_grad.size > 0 else 0.0
            std_dev = float(np.std(patch)) if patch.size > 0 else 0.0

            coords = [[int(s[0]), int(s[1])], [int(s[2]), int(s[3])]]
            if avg_grad >= 85.0 and std_dev >= 25.0 and len(walls) < 6:
                walls.append({"type": "wall", "geometry": {"type": "LineString", "coordinates": coords}})
            elif avg_grad >= 65.0 and std_dev <= 24.0 and len(fences) < 4:
                fences.append({"type": "fence", "geometry": {"type": "LineString", "coordinates": coords}})
            else:
                log_rejection("Weak evidence", "boundary", f"Insufficient physical contrast (grad={avg_grad:.1f}, std={std_dev:.1f})", coords)

    print(f"\nResults for {image_path}:")
    print(f"  Water: {len(water_features)}")
    print(f"  Roads: {len(roads)}")
    print(f"  Fields: {len(fields)}")
    print(f"  Walls: {len(walls)}")
    print(f"  Fences: {len(fences)}")
    print(f"  Rejections Total: {len(rejections)}")
    print(f"  Rejection Categories Breakdown:")
    for cat, count in rejection_categories.items():
        print(f"    - {cat}: {count}")

for p in [
    'uploads/uav_1788964523242_0f14jo.png',
    'test_assets/image_a_rural.png',
    'test_assets/image_b_urban.png',
    'test_assets/image_c_coastal.png',
    'test_assets/image_d_agricultural.png'
]:
    run_test(p)
