import sys
import os
import json
import math
import numpy as np
import cv2
from PIL import Image, ImageDraw

# Add server to path
sys.path.insert(0, os.getcwd())

from server.ml.ml_detector import (
    MODEL_METADATA,
    CLASS_CONFIDENCE_THRESHOLDS,
    get_collage_and_margin_mask,
    run_ml_building_segmentation,
    detect_water_cv,
    detect_roads_cv,
    detect_vegetation_cv,
    regularize_building_corners,
    calculate_polygon_area,
    calculate_line_length
)
from ultralytics import YOLO

def remove_contour_spikes_and_sawtooth(points, min_interior_angle_deg=50.0):
    """
    Removes acute saw-tooth spikes and zig-zag notches from a polygon contour ring.
    Preserves true macroscopic boundary corners while removing raster threshold notches.
    """
    if not points or len(points) < 5:
        return points

    pts = points[:-1] if points[0] == points[-1] else list(points)
    
    for _ in range(5):
        n = len(pts)
        if n < 4:
            break
        filtered = []
        skip_indices = set()
        for i in range(n):
            if i in skip_indices:
                continue
            p_prev = np.array(pts[(i - 1) % n], dtype=np.float32)
            p_curr = np.array(pts[i], dtype=np.float32)
            p_next = np.array(pts[(i + 1) % n], dtype=np.float32)

            v1 = p_prev - p_curr
            v2 = p_next - p_curr
            l1 = np.linalg.norm(v1)
            l2 = np.linalg.norm(v2)

            if l1 < 4.0 or l2 < 4.0:
                skip_indices.add(i)
                continue

            cos_val = np.clip(np.dot(v1, v2) / (l1 * l2), -1.0, 1.0)
            angle_deg = np.degrees(np.arccos(cos_val))

            base_d = np.linalg.norm(p_prev - p_next)
            # Acute spike or narrow notch
            if angle_deg < min_interior_angle_deg or (base_d < 45.0 and min(l1, l2) > 25.0 and angle_deg < 70.0):
                skip_indices.add(i)
                continue

            filtered.append(pts[i])

        if len(filtered) == len(pts):
            break
        pts = filtered

    if len(pts) >= 3:
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        return pts
    return points

def detect_fields_refined(image, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, veg_mask, building_features, edge_margin_mask, ignore_mask, rejections):
    h, w = image.shape[:2]
    total_area = float(w * h)

    smoothed = cv2.bilateralFilter(image, 9, 75, 75)
    hsv = cv2.cvtColor(smoothed, cv2.COLOR_BGR2HSV)
    b = smoothed[:, :, 0].astype(np.float32)
    g = smoothed[:, :, 1].astype(np.float32)
    r = smoothed[:, :, 2].astype(np.float32)
    exg = 2.0 * g - r - b

    # 1. Cultivated soil plots
    is_soil = (hsv[:, :, 0] >= 10) & (hsv[:, :, 0] <= 42) & (hsv[:, :, 1] >= 28) & (hsv[:, :, 1] <= 210) & (hsv[:, :, 2] >= 35) & (exg <= 8.0)
    # 2. Green crop plots
    is_green_crop = (hsv[:, :, 0] >= 32) & (hsv[:, :, 0] <= 88) & (hsv[:, :, 1] >= 35) & (exg > 12.0)
    # 3. Fallow / grain / golden plots
    is_yellow_crop = (hsv[:, :, 0] >= 18) & (hsv[:, :, 0] <= 32) & (hsv[:, :, 1] >= 35) & (hsv[:, :, 2] >= 70) & (exg > -8.0)

    field_categories = [
        ("Soil Plot", is_soil, "Cultivated Soil Plot"),
        ("Green Crop Plot", is_green_crop, "Cultivated Vegetative Crop"),
        ("Fallow / Grain Plot", is_yellow_crop, "Fallow / Harvested Grain Field")
    ]

    road_dil = cv2.dilate(road_corridor_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (14, 14))) if road_corridor_mask is not None else np.zeros((h, w), dtype=np.uint8)
    bldg_dil = cv2.dilate(building_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (18, 18))) if building_mask is not None else np.zeros((h, w), dtype=np.uint8)
    veg_dil = cv2.dilate(veg_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) if veg_mask is not None else np.zeros((h, w), dtype=np.uint8)

    fields = []
    total_raw_candidates = 0

    for cat_name, cat_mask, cat_sub in field_categories:
        field_raw = cat_mask.astype(np.uint8) * 255
        field_raw[bldg_dil > 0] = 0
        field_raw[road_dil > 0] = 0
        field_raw[water_exclusion_mask > 0] = 0
        field_raw[coastline_exclusion_mask > 0] = 0
        field_raw[veg_dil > 0] = 0  # Hedgerows separate fields!
        field_raw[ignore_mask > 0] = 0

        # Close with ellipse to bridge mower furrows and tire tracks
        closed = cv2.morphologyEx(field_raw, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
        # Open to remove thin noisy appendages
        clean = cv2.morphologyEx(closed, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))

        cnts_f, _ = cv2.findContours(clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        total_raw_candidates += len(cnts_f)

        for c in cnts_f:
            area = cv2.contourArea(c)
            if area > (total_area * 0.40):
                continue
            # Minimum field area: at least 7,000 px^2 or 0.8% of canvas
            if area < max(7000.0, total_area * 0.008):
                continue

            # Density-based residential settlement check:
            # Rejects residential blocks enclosing or bordering buildings
            bldgs_inside = 0
            for b_feat in building_features:
                b_pts = b_feat.get("geometry", {}).get("coordinates", [[]])[0]
                if b_pts:
                    bx, by = b_pts[0]
                    if cv2.pointPolygonTest(c, (float(bx), float(by)), False) >= 0:
                        bldgs_inside += 1

            building_density = bldgs_inside / (area / 10000.0)
            if bldgs_inside >= 2 or building_density > 0.8:
                continue

            # In residential context (20+ buildings), filter out courtyards/lawns bordering multiple buildings
            if len(building_features) >= 20:
                c_pts = c.reshape(-1, 2)[::4]
                close_bldgs = 0
                for b_feat in building_features:
                    b_pts = b_feat.get("geometry", {}).get("coordinates", [[]])[0]
                    if b_pts:
                        min_d = min(math.hypot(bx - px, by - py) for bx, by in b_pts for px, py in c_pts)
                        if min_d < 30.0:
                            close_bldgs += 1
                if close_bldgs >= 2:
                    continue

            hull = cv2.convexHull(c)
            hull_area = cv2.contourArea(hull)
            solidity = area / max(1.0, hull_area)
            rect = cv2.minAreaRect(c)
            rw, rh = rect[1]
            aspect = max(rw, rh) / max(1.0, min(rw, rh))

            if solidity < 0.65 or aspect > 3.5:
                continue

            # Adaptive Douglas-Peucker simplification + Spike removal
            peri = cv2.arcLength(c, True)
            epsilon = max(11.0, min(32.0, 0.026 * peri))
            approx = cv2.approxPolyDP(c, epsilon, True)
            pts = approx.reshape(-1, 2).tolist()
            if len(pts) < 4:
                continue

            cleaned_pts = remove_contour_spikes_and_sawtooth(pts)
            if not cleaned_pts or len(cleaned_pts) < 4:
                continue

            clean_poly_np = np.array(cleaned_pts, dtype=np.float32)
            c_area = calculate_polygon_area(cleaned_pts)
            c_hull = cv2.convexHull(clean_poly_np)
            c_solidity = c_area / max(1.0, cv2.contourArea(c_hull))
            if c_solidity < 0.65:
                continue

            # Overlap deduplication
            is_dup = False
            poly_mask = np.zeros((h, w), dtype=np.uint8)
            cv2.fillPoly(poly_mask, [np.array(cleaned_pts, dtype=np.int32)], 255)
            for ef in fields:
                e_coords = ef.get("geometry", {}).get("coordinates", [[]])[0]
                if e_coords:
                    e_mask = np.zeros((h, w), dtype=np.uint8)
                    cv2.fillPoly(e_mask, [np.array(e_coords, dtype=np.int32)], 255)
                    intersection = cv2.bitwise_and(poly_mask, e_mask)
                    inter_area = np.count_nonzero(intersection)
                    if inter_area > (c_area * 0.35):
                        is_dup = True
                        break
            if is_dup:
                continue

            score = round(min(0.92, max(0.68, 0.72 + (c_area / total_area) * 0.25)), 4)
            fields.append({
                "index": len(fields) + 1,
                "class": "field",
                "type": "field",
                "detection_type": "FIELD",
                "feature_type": "Field",
                "name": f"Agricultural Field Parcel {len(fields) + 1}",
                "sub_type": cat_sub,
                "confidence": score,
                "confidence_type": "evidence_score",
                "provider": "cv_derived",
                "raw_model_class": None,
                "mapped_feature_type": "field",
                "model_name": "Aerial CV Field Partition Engine v3.0",
                "method": "Agricultural spectral clustering & regularized boundary partition",
                "source": "cv_derived",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [cleaned_pts]
                },
                "coordinate_mode": "image",
                "area_pixels": round(c_area, 1),
                "area_image_pixels": round(c_area, 1),
                "evidence": [
                    f"{cat_name.lower().replace(' ', '_')}_signature",
                    "non_residential_open_plot",
                    f"solidity_ratio_{c_solidity:.2f}"
                ]
            })

    return fields, total_raw_candidates

def detect_walls_and_fences_refined(image, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, veg_mask, building_features, road_features, field_features, edge_margin_mask, ignore_mask, rejections):
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    edges = cv2.Canny(gray, 75, 185)

    building_dil = cv2.dilate(building_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
    edges[building_dil > 0] = 0
    edges[road_corridor_mask > 0] = 0
    edges[water_exclusion_mask > 0] = 0
    edges[coastline_exclusion_mask > 0] = 0
    edges[veg_mask > 0] = 0
    edges[edge_margin_mask > 0] = 0
    edges[ignore_mask > 0] = 0

    # ZERO OUT FIELD INTERIORS! Tractor furrows and plowing lines inside fields are NOT walls!
    field_mask_all = np.zeros((h, w), dtype=np.uint8)
    for f in field_features:
        f_pts = f.get("geometry", {}).get("coordinates", [[]])[0]
        if f_pts and len(f_pts) >= 3:
            cv2.fillPoly(field_mask_all, [np.array(f_pts, dtype=np.int32)], 255)
    field_interior_mask = cv2.erode(field_mask_all, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)))
    edges[field_interior_mask > 0] = 0

    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=50, minLineLength=40, maxLineGap=8)

    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad_mag = cv2.magnitude(grad_x, grad_y)

    walls = []
    fences = []

    if lines is not None:
        kept = []
        for s in lines.reshape(-1, 4).tolist():
            length = math.hypot(s[2] - s[0], s[3] - s[1])
            if length < 38 or length > 145:
                continue

            if s[0] < 20 or s[0] > w - 20 or s[1] < 20 or s[1] > h - 20 or \
               s[2] < 20 or s[2] > w - 20 or s[3] < 20 or s[3] > h - 20:
                continue

            mid_x = (s[0] + s[2]) / 2.0
            mid_y = (s[1] + s[3]) / 2.0
            if water_exclusion_mask[int(mid_y), int(mid_x)] > 0:
                continue

            # Strict Curtilage Anchoring: must be within 25px of a building footprint OR within 20px of a road
            test_pts = [(s[0], s[1]), (mid_x, mid_y), (s[2], s[3])]
            is_anchored = False

            for b_feat in building_features:
                b_pts = b_feat.get("geometry", {}).get("coordinates", [[]])[0]
                for bp in b_pts:
                    for tp in test_pts:
                        if math.hypot(tp[0] - bp[0], tp[1] - bp[1]) <= 25.0:
                            is_anchored = True
                            break
                    if is_anchored: break
                if is_anchored: break

            if not is_anchored:
                for r_feat in road_features:
                    r_pts = r_feat.get("geometry", {}).get("coordinates", [])
                    for rp in r_pts:
                        for tp in test_pts:
                            if math.hypot(tp[0] - rp[0], tp[1] - rp[1]) <= 20.0:
                                is_anchored = True
                                break
                        if is_anchored: break
                    if is_anchored: break

            if not is_anchored:
                for k in kept:
                    if math.hypot(mid_x - (k[0] + k[2]) / 2, mid_y - (k[1] + k[3]) / 2) <= 18.0:
                        is_anchored = True
                        break

            if not is_anchored:
                continue

            # Deduplication
            is_dup = False
            for k in kept:
                d = math.hypot(mid_x - (k[0] + k[2]) / 2, mid_y - (k[1] + k[3]) / 2)
                if d < 20:
                    is_dup = True
                    break
            if not is_dup:
                kept.append(s)

        for s in kept:
            length = math.hypot(s[2] - s[0], s[3] - s[1])
            mid_x = int((s[0] + s[2]) / 2)
            mid_y = int((s[1] + s[3]) / 2)

            patch = gray[max(0, mid_y - 3):min(h, mid_y + 4), max(0, mid_x - 3):min(w, mid_x + 4)]
            patch_grad = grad_mag[max(0, mid_y - 3):min(h, mid_y + 4), max(0, mid_x - 3):min(w, mid_x + 4)]
            avg_grad = float(np.mean(patch_grad)) if patch_grad.size > 0 else 0.0
            std_dev = float(np.std(patch)) if patch.size > 0 else 0.0

            coords = [[int(s[0]), int(s[1])], [int(s[2]), int(s[3])]]

            # Genuine physical stone wall contrast
            if avg_grad >= 88.0 and std_dev >= 20.0 and len(walls) < 6:
                score = round(min(0.88, max(0.68, 0.70 + (avg_grad / 220.0) * 0.18)), 4)
                walls.append({
                    "index": len(walls) + 1,
                    "class": "wall",
                    "type": "wall",
                    "detection_type": "WALL",
                    "feature_type": "Wall",
                    "name": f"Masonry Stone Wall {len(walls) + 1}",
                    "sub_type": "Stone / Masonry Retaining Wall",
                    "confidence": score,
                    "confidence_type": "evidence_score",
                    "provider": "cv_derived",
                    "raw_model_class": None,
                    "mapped_feature_type": "wall",
                    "model_name": "Aerial CV Boundary Analyzer v3.0",
                    "method": "Bilateral contrast & curtilage masonry analysis",
                    "source": "cv_derived",
                    "geometry": { "type": "LineString", "coordinates": coords },
                    "coordinate_mode": "image",
                    "length_pixels": round(length, 1),
                    "evidence": [
                        "high_gradient_linear_edge",
                        f"masonry_contrast_grad_{int(avg_grad)}",
                        "curtilage_boundary"
                    ]
                })
            elif avg_grad >= 70.0 and avg_grad < 88.0 and std_dev >= 15.0 and len(fences) < 4:
                score = round(min(0.80, max(0.68, 0.70 + (avg_grad / 200.0) * 0.10)), 4)
                fences.append({
                    "index": len(fences) + 1,
                    "class": "fence",
                    "type": "fence",
                    "detection_type": "FENCE",
                    "feature_type": "Fence",
                    "name": f"Boundary Fence {len(fences) + 1}",
                    "sub_type": "Post & Wire Property Boundary Fence",
                    "confidence": score,
                    "confidence_type": "evidence_score",
                    "provider": "cv_derived",
                    "raw_model_class": None,
                    "mapped_feature_type": "fence",
                    "model_name": "Aerial CV Boundary Analyzer v3.0",
                    "method": "Curtilage boundary fence analysis",
                    "source": "cv_derived",
                    "geometry": { "type": "LineString", "coordinates": coords },
                    "coordinate_mode": "image",
                    "length_pixels": round(length, 1),
                    "evidence": [
                        "linear_curtilage_boundary",
                        f"edge_contrast_grad_{int(avg_grad)}"
                    ]
                })

    return walls, fences

def test_pipeline():
    img_path = 'uploads/uav_1789118184315_w45wwf.png'
    img = cv2.imread(img_path)
    h, w = img.shape[:2]
    rejections = []

    edge_margin_mask = np.zeros((h, w), dtype=np.uint8)
    edge_margin_mask[:16, :] = 255
    edge_margin_mask[-16:, :] = 255
    edge_margin_mask[:, :16] = 255
    edge_margin_mask[:, -16:] = 255

    ignore_mask = get_collage_and_margin_mask(img)
    water, water_clean, water_exclusion_mask, coastline_exclusion_mask, _ = detect_water_cv(img, ignore_mask, rejections)

    model = YOLO("server/ml/models/yolov8n-building-seg.pt")
    buildings, building_mask, _, _ = run_ml_building_segmentation(img, model, 0.35, 640, 0.20, ignore_mask)

    roads, road_stats, road_corridor_mask, _ = detect_roads_cv(img, building_mask, water_exclusion_mask, edge_margin_mask, ignore_mask, rejections, water_clean=water_clean)
    
    # Filter out road segments with sharp turns (> 78 deg) and isolated stubs < 40px
    clean_roads = []
    for r in roads:
        coords = r.get('geometry', {}).get('coordinates', [])
        if len(coords) < 2 or r.get('length_pixels', 0) < 40.0:
            continue
        has_sharp = False
        for i in range(len(coords) - 2):
            p0, p1, p2 = coords[i], coords[i+1], coords[i+2]
            v1 = (p1[0] - p0[0], p1[1] - p0[1])
            v2 = (p2[0] - p1[0], p2[1] - p1[1])
            l1, l2 = math.hypot(*v1), math.hypot(*v2)
            if l1 > 2 and l2 > 2:
                cos_a = max(-1.0, min(1.0, (v1[0]*v2[0] + v1[1]*v2[1]) / (l1*l2)))
                if math.degrees(math.acos(cos_a)) > 78.0:
                    has_sharp = True
                    break
        if not has_sharp:
            clean_roads.append(r)
    roads = clean_roads

    vegetation, veg_mask, _ = detect_vegetation_cv(img, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, edge_margin_mask, ignore_mask, rejections)

    fields, _ = detect_fields_refined(img, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, veg_mask, buildings, edge_margin_mask, ignore_mask, rejections)

    walls, fences = detect_walls_and_fences_refined(img, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, veg_mask, buildings, roads, fields, edge_margin_mask, ignore_mask, rejections)

    print(f"RESULTS:")
    print(f"  Water: {len(water)}")
    print(f"  Buildings: {len(buildings)}")
    print(f"  Roads: {len(roads)}")
    print(f"  Fields: {len(fields)}")
    print(f"  Walls: {len(walls)}")
    print(f"  Fences: {len(fences)}")

    # Render image
    base = Image.open(img_path).convert('RGBA')
    overlay = Image.new('RGBA', base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for w_feat in water:
        coords = w_feat['geometry']['coordinates'][0]
        pts = [(int(p[0]), int(p[1])) for p in coords]
        draw.polygon(pts, fill=(2, 132, 199, 100), outline=(56, 189, 248, 220), width=2)

    for f_feat in fields:
        coords = f_feat['geometry']['coordinates'][0]
        pts = [(int(p[0]), int(p[1])) for p in coords]
        draw.polygon(pts, fill=(101, 163, 13, 90), outline=(132, 204, 22, 220), width=2)

    for b_feat in buildings:
        coords = b_feat['geometry']['coordinates'][0]
        pts = [(int(p[0]), int(p[1])) for p in coords]
        draw.polygon(pts, fill=(8, 145, 178, 140), outline=(6, 182, 212, 255), width=2)

    for r_feat in roads:
        coords = r_feat['geometry']['coordinates']
        pts = [(int(p[0]), int(p[1])) for p in coords]
        draw.line(pts, fill=(245, 158, 11, 230), width=4)

    for w_feat in walls:
        coords = w_feat['geometry']['coordinates']
        pts = [(int(p[0]), int(p[1])) for p in coords]
        draw.line(pts, fill=(203, 213, 225, 255), width=3)

    for f_feat in fences:
        coords = f_feat['geometry']['coordinates']
        pts = [(int(p[0]), int(p[1])) for p in coords]
        draw.line(pts, fill=(236, 72, 153, 255), width=2)

    out = Image.alpha_composite(base, overlay)
    out_path = r'C:\Users\princ\.gemini\antigravity-ide\brain\4b971667-7412-41e9-9bd8-3bd92fb72e0c\cleaned_ai_features_final.png'
    out.save(out_path)
    print(f"Saved test rendering to {out_path}")

if __name__ == '__main__':
    test_pipeline()
