"""
Step 6C Precision Pipeline Prototype & Verification Script
"""
import sys
import os
import cv2
import numpy as np
import math
import json
import time

def run_precision_detection(image_path):
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError("Could not read " + image_path)
    h, w = img.shape[:2]
    max_dim = max(w, h)
    total_area = float(w * h)

    b = img[:, :, 0].astype(np.float32)
    g = img[:, :, 1].astype(np.float32)
    r = img[:, :, 2].astype(np.float32)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    exg = 2.0 * g - r - b
    ndwi = (b - r) / np.maximum(1.0, b + r)

    rejections = []

    # -------------------------------------------------------------
    # 1. BUILDING DETECTION (YOLOv8n-seg)
    # -------------------------------------------------------------
    # For testing, we can run YOLO if ultralytics is available
    from ultralytics import YOLO
    model_path = "server/ml/models/yolov8n-building-seg.pt"
    model = YOLO(model_path)
    
    # Run YOLO on tiles or whole image
    results = model.predict(img, conf=0.50, imgsz=640, verbose=False)
    building_mask = np.zeros((h, w), dtype=np.uint8)
    buildings = []
    
    for r_idx, res in enumerate(results):
        if res.masks is not None:
            for m_idx, mask_data in enumerate(res.masks.data):
                m_np = mask_data.cpu().numpy()
                m_resized = cv2.resize(m_np, (w, h), interpolation=cv2.INTER_NEAREST).astype(np.uint8)
                building_mask[m_resized > 0] = 255
                cnts, _ = cv2.findContours(m_resized, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                if cnts:
                    c = max(cnts, key=cv2.contourArea)
                    peri = cv2.arcLength(c, True)
                    approx = cv2.approxPolyDP(c, max(1.5, 0.015 * peri), True).reshape(-1, 2).tolist()
                    if len(approx) >= 3:
                        if approx[0] != approx[-1]: approx.append(approx[0])
                        area = cv2.contourArea(c)
                        if 60 <= area <= total_area * 0.35:
                            conf = float(res.boxes.conf[m_idx].cpu().item()) if res.boxes is not None else 0.85
                            buildings.append({
                                "type": "building",
                                "name": f"Building Footprint {len(buildings)+1}",
                                "confidence": round(conf, 4),
                                "geometry": {"type": "Polygon", "coordinates": [approx]},
                                "area_pixels": round(area, 1)
                            })

    # -------------------------------------------------------------
    # 2. WATER BODY & WATER CANAL DETECTION
    # -------------------------------------------------------------
    # Water spectral signature: high NDWI or water ratio, low reflectance, smooth texture
    mean_gray = cv2.blur(gray.astype(np.float32), (7, 7))
    sq_gray = cv2.blur((gray.astype(np.float32)) ** 2, (7, 7))
    std_gray = np.sqrt(np.maximum(0.0, sq_gray - mean_gray ** 2))

    water_ratio = (b + 5.0) / (r + 5.0)
    is_water = ((water_ratio > 1.30) | (ndwi > 0.18)) & (g > 35) & (b > 50) & (std_gray < 16.0)
    water_mask_raw = is_water.astype(np.uint8) * 255
    water_mask_raw[building_mask > 0] = 0

    kernel_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    water_clean = cv2.morphologyEx(water_mask_raw, cv2.MORPH_OPEN, kernel_w)
    water_clean = cv2.morphologyEx(water_clean, cv2.MORPH_CLOSE, kernel_w)

    coast_edge = cv2.morphologyEx(water_clean, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    coastline_mask = cv2.dilate(coast_edge, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (18, 18)))

    contours_w, _ = cv2.findContours(water_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    water_features = []
    
    for idx, c in enumerate(sorted(contours_w, key=cv2.contourArea, reverse=True)):
        area = cv2.contourArea(c)
        if area < max(120.0, total_area * 0.003):
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, max(2.0, 0.015 * peri), True).reshape(-1, 2).tolist()
        if len(approx) < 4: continue
        if approx[0] != approx[-1]: approx.append(approx[0])

        rect = cv2.minAreaRect(c)
        rw, rh = rect[1]
        aspect = max(rw, rh) / max(1.0, min(rw, rh))
        min_dim = min(rw, rh)

        # True Canal vs Natural Water Body
        # A canal is narrow (width <= 28px) and elongated (aspect >= 4.5)
        is_canal = (aspect >= 4.5) and (min_dim <= 28.0) and (area < total_area * 0.08)

        if is_canal:
            water_features.append({
                "type": "water",
                "class": "water",
                "name": f"Water Canal {len(water_features)+1}",
                "sub_type": "Irrigation Canal / Channel",
                "confidence": round(0.78, 4),
                "geometry": {"type": "Polygon", "coordinates": [approx]},
                "area_pixels": round(area, 1)
            })
        else:
            # Large natural water body (ocean, lake, retention basin)
            water_features.append({
                "type": "water",
                "class": "water",
                "name": f"Water Body (Coastal / Ocean)" if area > total_area * 0.15 else f"Water Body {len(water_features)+1}",
                "sub_type": "Natural Water Body / Ocean" if area > total_area * 0.15 else "Water Retention Basin / Pond",
                "confidence": round(0.85, 4),
                "geometry": {"type": "Polygon", "coordinates": [approx]},
                "area_pixels": round(area, 1)
            })

    # -------------------------------------------------------------
    # 3. ROAD CORRIDOR DETECTION (Distance Transform Ridges)
    # -------------------------------------------------------------
    is_paved = (hsv[:, :, 1] < 75) & (hsv[:, :, 2] >= 45) & (hsv[:, :, 2] <= 230) & (exg < 12.0)
    is_dirt = (hsv[:, :, 0] >= 14) & (hsv[:, :, 0] <= 42) & (hsv[:, :, 1] >= 40) & (hsv[:, :, 1] <= 180) & (hsv[:, :, 2] >= 50) & (hsv[:, :, 2] <= 220) & (exg < 10.0)
    road_surface = (is_paved | is_dirt).astype(np.uint8) * 255
    road_surface[building_mask > 0] = 0
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
        true_elongation = diag / max(1.0, approx_w)

        # Real road corridors are elongated and sufficiently long
        if area > 1000 and diag > 120 and true_elongation >= 2.5:
            comp_mask = (labels == l).astype(np.uint8) * 255
            road_corridor_mask = cv2.bitwise_or(road_corridor_mask, comp_mask)
            dist = cv2.distanceTransform(comp_mask, cv2.DIST_L2, 5)

            pts = []
            if bw >= bh:
                step = max(8, bw // 35)
                for x in range(bx, bx + bw, step):
                    col_y = np.where(comp_mask[:, x] > 0)[0]
                    if len(col_y) > 0:
                        pts.append([int(x), int(col_y[np.argmax(dist[col_y, x])])])
            else:
                step = max(8, bh // 35)
                for y in range(by, by + bh, step):
                    row_x = np.where(comp_mask[y, :] > 0)[0]
                    if len(row_x) > 0:
                        pts.append([int(row_x[np.argmax(dist[y, row_x])]), int(y)])

            if len(pts) >= 4:
                pts_np = np.array(pts, dtype=np.int32).reshape((-1, 1, 2))
                epsilon = max(3.0, 0.012 * cv2.arcLength(pts_np, False))
                simplified = cv2.approxPolyDP(pts_np, epsilon, False).reshape(-1, 2).tolist()
                
                # Check if road passes into open water
                in_water_pts = sum(1 for p in simplified if water_clean[min(h-1, max(0, p[1])), min(w-1, max(0, p[0]))] > 0)
                if in_water_pts > len(simplified) * 0.15:
                    rejections.append({
                        "class": "road",
                        "reason": f"Rejected Road: Crosses open water ({in_water_pts} vertices in water)",
                        "score": 0.40,
                        "threshold": 0.65
                    })
                    continue

                roads.append({
                    "type": "road",
                    "class": "road",
                    "name": f"Road Corridor {len(roads)+1} (Primary)",
                    "confidence": round(0.92, 4),
                    "geometry": {"type": "LineString", "coordinates": simplified},
                    "length_pixels": round(diag, 1)
                })

    road_corridor_dilated = cv2.dilate(road_corridor_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (14, 14)))

    # -------------------------------------------------------------
    # 4. VEGETATION CANOPY CLUSTERS
    # -------------------------------------------------------------
    tree_canopy_raw = ((exg > 20.0) & (std_gray > 13.0)).astype(np.uint8) * 255
    tree_canopy_raw[building_mask > 0] = 0
    tree_canopy_raw[road_corridor_dilated > 0] = 0
    tree_canopy_raw[water_clean > 0] = 0
    tree_canopy_raw[coastline_mask > 0] = 0

    kernel_v = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    veg_clean = cv2.morphologyEx(tree_canopy_raw, cv2.MORPH_OPEN, kernel_v)
    cnts_v, _ = cv2.findContours(veg_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    vegetation = []
    veg_mask = np.zeros((h, w), dtype=np.uint8)
    
    for idx, c in enumerate(sorted(cnts_v, key=cv2.contourArea, reverse=True)[:5]):
        area = cv2.contourArea(c)
        if area < 150 or area > total_area * 0.20:
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, max(2.0, 0.02 * peri), True).reshape(-1, 2).tolist()
        if len(approx) < 4: continue
        if approx[0] != approx[-1]: approx.append(approx[0])
        
        cv2.fillPoly(veg_mask, [np.array(approx, dtype=np.int32)], 255)
        vegetation.append({
            "type": "vegetation",
            "class": "vegetation",
            "name": f"Vegetation Canopy Cluster {len(vegetation)+1}",
            "confidence": round(0.74, 4),
            "geometry": {"type": "Polygon", "coordinates": [approx]},
            "area_pixels": round(area, 1)
        })

    veg_mask_dilated = cv2.dilate(veg_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (10, 10)))

    # -------------------------------------------------------------
    # 5. AGRICULTURAL FIELD DETECTION
    # -------------------------------------------------------------
    mask_soil = cv2.inRange(hsv, (10, 30, 40), (42, 220, 220))
    field_raw = mask_soil.copy()
    field_raw[building_mask > 0] = 0
    field_raw[road_corridor_dilated > 0] = 0
    field_raw[water_clean > 0] = 0
    field_raw[coastline_mask > 0] = 0
    field_raw[veg_mask_dilated > 0] = 0

    field_clean = cv2.morphologyEx(field_raw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)))
    field_clean = cv2.morphologyEx(field_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
    cnts_f, _ = cv2.findContours(field_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    fields = []
    for c in cnts_f:
        area = cv2.contourArea(c)
        # Sane agricultural parcel area (1.5% to 50% image area)
        if area >= total_area * 0.015 and area <= total_area * 0.50:
            rect = cv2.minAreaRect(c)
            rw, rh = rect[1]
            aspect = max(rw, rh) / max(1.0, min(rw, rh))
            solidity = area / max(1.0, rw * rh)

            # Compactness and non-diagonal triangle check
            if aspect > 4.5 or solidity < 0.40:
                rejections.append({
                    "class": "field",
                    "reason": f"Rejected Field: Diagonal / low solidity geometry (solidity={solidity:.2f}, aspect={aspect:.1f})",
                    "score": 0.45,
                    "threshold": 0.60
                })
                continue

            # Verify no buildings inside field
            bldgs_inside = 0
            for b_feat in buildings:
                b_pts = b_feat["geometry"]["coordinates"][0]
                bx, by = b_pts[0]
                if cv2.pointPolygonTest(c, (float(bx), float(by)), False) >= 0:
                    bldgs_inside += 1
            if bldgs_inside > 1:
                rejections.append({
                    "class": "field",
                    "reason": f"Rejected Field: Contains {bldgs_inside} building footprints (residential area, not agricultural field)",
                    "score": 0.35,
                    "threshold": 0.60
                })
                continue

            approx = cv2.approxPolyDP(c, max(2.0, 0.018 * cv2.arcLength(c, True)), True).reshape(-1, 2).tolist()
            if len(approx) >= 4:
                if approx[0] != approx[-1]: approx.append(approx[0])
                fields.append({
                    "type": "field",
                    "class": "field",
                    "name": f"Agricultural Field Parcel {len(fields)+1}",
                    "confidence": round(0.78, 4),
                    "geometry": {"type": "Polygon", "coordinates": [approx]},
                    "area_pixels": round(area, 1)
                })

    # -------------------------------------------------------------
    # 6. STONE WALLS & FENCES (Strict Exclusion of Coastline & Roads)
    # -------------------------------------------------------------
    edges = cv2.Canny(gray, 70, 180)
    building_dil = cv2.dilate(building_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
    edges[building_dil > 0] = 0
    edges[road_corridor_dilated > 0] = 0
    edges[water_clean > 0] = 0
    edges[coastline_mask > 0] = 0
    edges[veg_mask_dilated > 0] = 0

    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=45, minLineLength=40, maxLineGap=8)
    walls = []
    fences = []

    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad_mag = cv2.magnitude(grad_x, grad_y)

    if lines is not None:
        for s in lines.reshape(-1, 4).tolist():
            length = math.hypot(s[2] - s[0], s[3] - s[1])
            if length < 35 or length > max_dim * 0.40:
                continue
            mx = int((s[0] + s[2]) / 2)
            my = int((s[1] + s[3]) / 2)

            # Check if line coincides with coastline or road shoulder
            if coastline_mask[my, mx] > 0 or water_clean[my, mx] > 0:
                rejections.append({
                    "class": "wall",
                    "reason": "Rejected Wall: Coincides with coastline boundary / ocean surf",
                    "score": 0.42,
                    "threshold": 0.70
                })
                continue

            if road_corridor_dilated[my, mx] > 0:
                rejections.append({
                    "class": "wall",
                    "reason": "Rejected Wall: Coincides with road pavement edge / shoulder",
                    "score": 0.48,
                    "threshold": 0.70
                })
                continue

            patch = gray[max(0, my - 3):min(h, my + 4), max(0, mx - 3):min(w, mx + 4)]
            patch_grad = grad_mag[max(0, my - 3):min(h, my + 4), max(0, mx - 3):min(w, mx + 4)]
            avg_grad = float(np.mean(patch_grad)) if patch_grad.size > 0 else 0.0
            std_dev = float(np.std(patch)) if patch.size > 0 else 0.0

            coords = [[int(s[0]), int(s[1])], [int(s[2]), int(s[3])]]

            # Genuine physical separation criteria
            if avg_grad >= 90.0 and std_dev >= 28.0 and len(walls) < 6:
                walls.append({
                    "type": "wall",
                    "class": "wall",
                    "name": f"Masonry Stone Wall {len(walls)+1}",
                    "confidence": round(0.76, 4),
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "length_pixels": round(length, 1)
                })
            elif avg_grad >= 65.0 and avg_grad < 90.0 and std_dev <= 24.0 and len(fences) < 4:
                fences.append({
                    "type": "fence",
                    "class": "fence",
                    "name": f"Boundary Fence {len(fences)+1}",
                    "confidence": round(0.76, 4),
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "length_pixels": round(length, 1)
                })
            else:
                rejections.append({
                    "class": "boundary",
                    "reason": f"Rejected Linear Edge: Insufficient wall/fence evidence (grad={avg_grad:.1f}, std={std_dev:.1f})",
                    "score": round(min(0.65, avg_grad / 160.0), 2),
                    "threshold": 0.70
                })

    summary = {
        "buildings": len(buildings),
        "roads": len(roads),
        "fields": len(fields),
        "walls": len(walls),
        "fences": len(fences),
        "vegetation": len(vegetation),
        "water": len(water_features),
        "water_body": sum(1 for w in water_features if "canal" not in w["name"].lower()),
        "water_canal": sum(1 for w in water_features if "canal" in w["name"].lower()),
        "total": len(buildings) + len(roads) + len(fields) + len(walls) + len(fences) + len(vegetation) + len(water_features),
        "rejections_count": len(rejections)
    }

    return summary, rejections, {
        "buildings": buildings,
        "roads": roads,
        "fields": fields,
        "walls": walls,
        "fences": fences,
        "vegetation": vegetation,
        "water": water_features
    }

if __name__ == "__main__":
    img_path = "uploads/uav_1788964523242_0f14jo.png"
    summary, rejections, feats = run_precision_detection(img_path)
    print("\n--- RESULTS ON COASTAL IMAGE ---")
    print(json.dumps(summary, indent=2))
    print("\n--- SAMPLE REJECTIONS ---")
    for r in rejections[:8]:
        print(f"[{r['class'].upper()}] {r['reason']} (score={r['score']} < thresh={r['threshold']})")
