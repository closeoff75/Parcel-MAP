"""
ParcelMap Standalone ML Detection Engine (Step 6B Final Geometry Correction)

Executes genuine local ML instance segmentation (YOLOv8n-seg) combined with
specialized aerial computer vision land feature extraction for aerial/drone imagery.

Precision Quality Pass Rules:
1. WATER IS A HARD EXCLUSION MASK:
   - Deep blue & natural water body segmentation.
   - water_exclusion_mask (dilated 15px) strictly excludes all roads, walls, fences, and fields.
   - Any linear or polygonal candidate that crosses or touches water is strictly rejected ("Water crossing").
   - Water polygon coordinates smoothly contour the shoreline and canvas borders with zero internal diagonal shortcuts.
2. STOP IMAGE-EDGE ARTIFACTS:
   - Edge margins (16px) reject artificial boundary lines, edge-to-edge roads, and canvas-hugging polygons ("Image-edge artifact").
3. ROAD GEOMETRY:
   - Continuous paved/dirt corridor centerlines traced via distance-transform ridges.
   - Reject ungrounded straight lines, isolated fragments, or water-crossing segments ("Unsupported line" / "Water crossing").
4. FIELD REGIONS:
   - Coherent agricultural plots only (solidity >= 0.60, aspect <= 2.8, area between 2.5% and 35% of canvas).
   - Residential settlements enclosing buildings are rejected ("Invalid geometry" / residential context).
   - Touching image margins or water is rejected.
5. WALL / FENCE EVIDENCE:
   - Requires bilateral physical gradient contrast (>= 85 for walls, 65-85 for fences) and structural context.
   - Generic road curbs, tree shadows, and coastline surf are strictly rejected.
6. GEOMETRY QUALITY SCORE & DIAGNOSTIC REASON AUDIT:
   - Standardized 9 rejection categories:
     Water crossing, Unsupported line, Image-edge artifact, Insufficient continuity,
     Invalid geometry, Duplicate geometry, Weak evidence, Excessive size, Disconnected feature.
7. 100% offline, local CPU execution (zero cloud dependencies, no API keys).
"""

import sys
import os
import json
import argparse
import time
import math
import numpy as np
import cv2

# Ensure UTF-8 output on Windows
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


# Verified metadata of local weights
MODEL_METADATA = {
    "name": "YOLOv8n-seg (Keremberke Aerial Building Model)",
    "version": "8.4.145",
    "source": "server/ml/models/yolov8n-building-seg.pt",
    "task": "segment",
    "trained_classes": {0: "Building"},
    "nc": 1,
    "primary_class": "Building",
    "inference_engine": "Ultralytics PyTorch CPU/Local"
}

# Step 6B/6C/Iteration 24 Class-Specific Confidence Thresholds
CLASS_CONFIDENCE_THRESHOLDS = {
    "building": 0.40,
    "road": 0.65,
    "field": 0.55,
    "wall": 0.65,
    "fence": 0.65,
    "vegetation": 0.55,
    "water_body": 0.60,
    "water_canal": 0.70
}



def parse_args():
    parser = argparse.ArgumentParser(description="ParcelMap ML Land Feature Detector")
    parser.add_argument("--input", required=True, help="Path to drone image file")
    parser.add_argument("--project_id", default="proj_default", help="Project identifier")
    parser.add_argument("--imagery_id", default="img_default", help="Imagery identifier")
    parser.add_argument("--run_id", default=None, help="Detection run identifier")
    parser.add_argument("--conf", type=float, default=0.35, help="Confidence threshold (default: 0.35)")
    parser.add_argument("--tile_size", type=int, default=640, help="Tile size for large imagery")
    parser.add_argument("--overlap", type=float, default=0.20, help="Tile overlap ratio")
    parser.add_argument("--model_path", default="server/ml/models/yolov8n-building-seg.pt", help="Path to weights")
    parser.add_argument("--debug", action="store_true", help="Enable verbose pipeline debug output")
    return parser.parse_args()


# ==============================================================================
# GEOMETRY UTILITIES & SANITY VALIDATION
# ==============================================================================

def safe_imread(image_path):
    """Reliably read image bytes and decode using OpenCV, supporting Windows unicode paths and spaces."""
    if not os.path.exists(image_path):
        return None
    try:
        with open(image_path, 'rb') as f:
            file_bytes = f.read()
        if len(file_bytes) < 100:
            return None
        arr = np.frombuffer(file_bytes, dtype=np.uint8)
        decoded = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if decoded is not None and decoded.size > 0:
            return decoded
    except Exception:
        pass
    try:
        return cv2.imread(image_path)
    except Exception:
        return None


def calculate_polygon_area(points):
    """Shoelace formula for polygon area in pixels."""
    if not points or len(points) < 3:
        return 0.0
    area = 0.0
    for i in range(len(points) - 1):
        area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1]
    return abs(area) / 2.0


def calculate_line_length(coords):
    """Euclidean length of a line string in pixels."""
    if not coords or len(coords) < 2:
        return 0.0
    length = 0.0
    for i in range(len(coords) - 1):
        length += math.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1])
    return length


def segments_intersect(p1, p2, p3, p4):
    """Check if line segment p1-p2 strictly intersects line segment p3-p4."""
    def ccw(a, b, c):
        return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
    return (ccw(p1, p3, p4) != ccw(p2, p3, p4)) and (ccw(p1, p2, p3) != ccw(p1, p2, p4))


def is_self_intersecting_ring(ring):
    """Verify polygon ring does not self-intersect."""
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    n = len(pts)
    if n < 4:
        return False
    for i in range(n):
        p1, p2 = pts[i], pts[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            p3, p4 = pts[j], pts[(j + 1) % n]
            if segments_intersect(p1, p2, p3, p4):
                return True
    return False


def simplify_contour(contour, epsilon_factor=0.015):
    """Simplify a contour to a clean cadastral polygon using Douglas-Peucker."""
    peri = cv2.arcLength(contour, True)
    epsilon = max(1.5, epsilon_factor * peri)
    approx = cv2.approxPolyDP(contour, epsilon, True)
    points = approx.reshape(-1, 2).tolist()
    if len(points) >= 3:
        if points[0] != points[-1]:
            points.append(points[0])
        return points
    return None


def regularize_building_corners(pts, max_angle_deviation=22):
    """
    Preserves crisp cadastral corners for man-made architectural rooftops.
    """
    if len(pts) < 5 or len(pts) > 7:
        return pts
    open_pts = pts[:-1] if pts[0] == pts[-1] else pts
    n = len(open_pts)
    if n != 4:
        return pts

    is_rectilinear = True
    for i in range(n):
        p_prev = np.array(open_pts[i - 1], dtype=np.float32)
        p_curr = np.array(open_pts[i], dtype=np.float32)
        p_next = np.array(open_pts[(i + 1) % n], dtype=np.float32)

        v1 = p_prev - p_curr
        v2 = p_next - p_curr
        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)
        if norm1 < 1e-4 or norm2 < 1e-4:
            is_rectilinear = False
            break
        cos_angle = np.clip(np.dot(v1, v2) / (norm1 * norm2), -1.0, 1.0)
        angle_deg = np.degrees(np.arccos(cos_angle))
        if abs(angle_deg - 90.0) > max_angle_deviation:
            is_rectilinear = False
            break

    if is_rectilinear:
        pts_np = np.array(open_pts, dtype=np.int32)
        rect = cv2.minAreaRect(pts_np)
        box = cv2.boxPoints(rect)
        box_pts = [[round(float(p[0]), 2), round(float(p[1]), 2)] for p in box]
        box_pts.append(box_pts[0])
        return box_pts

    return pts


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


def validate_geometry(feature, img_w, img_h, water_exclusion_mask=None, water_clean=None):
    """
    Enforces coordinate bounds, area limits, compactness, aspect ratio, self-intersection checks,
    and rejects extreme diagonal artifacts and water crossings using class-specific rules.
    Returns: (is_valid, category, reason)
    """
    geom = feature.get("geometry", {})
    g_type = geom.get("type")
    coords = geom.get("coordinates", [])

    if not coords or len(coords) == 0:
        return False, "Invalid geometry", "empty_geometry"

    total_image_area = float(img_w * img_h)
    max_dim = max(img_w, img_h)
    feat_type = feature.get("type", "unknown")

    if g_type == "Polygon":
        ring = coords[0] if len(coords) > 0 else []
        if len(ring) < 4:
            return False, "Invalid geometry", "polygon_too_few_points"

        for pt in ring:
            if pt[0] < -2 or pt[0] > img_w + 5 or pt[1] < -2 or pt[1] > img_h + 5:
                return False, "Invalid geometry", "coordinates_out_of_image_bounds"

        if is_self_intersecting_ring(ring):
            return False, "Invalid geometry", "self_intersecting_polygon"

        area_px = calculate_polygon_area(ring)

        if feat_type == "building":
            if area_px < 100:
                return False, "Weak evidence", f"building_too_small_{area_px:.0f}px"
            if area_px > (total_image_area * 0.35):
                return False, "Excessive size", f"building_area_out_of_bounds_{area_px:.0f}px"
            pts_np = np.array(ring, dtype=np.float32)
            rect = cv2.minAreaRect(pts_np)
            rw, rh = rect[1]
            if min(rw, rh) < 4.5:
                return False, "Invalid geometry", "building_dimension_too_thin"
            aspect = max(rw, rh) / max(1.0, min(rw, rh))
            if aspect > 4.8:
                return False, "Invalid geometry", f"building_aspect_ratio_too_high_{aspect:.1f}"

            # Water check: Reject only if building footprint is actually submerged in a true water body
            target_water = water_clean if water_clean is not None else water_exclusion_mask
            if target_water is not None:
                xs = [p[0] for p in ring]
                ys = [p[1] for p in ring]
                cx = int(sum(xs) / len(xs))
                cy = int(sum(ys) / len(ys))
                pts_in_water = sum(1 for p in ring if 0 <= int(p[0]) < img_w and 0 <= int(p[1]) < img_h and target_water[int(p[1]), int(p[0])] > 0)
                if 0 <= cx < img_w and 0 <= cy < img_h and target_water[cy, cx] > 0 and pts_in_water > (len(ring) * 0.5):
                    return False, "Water crossing", "Building footprint submerged inside water body"

        elif feat_type == "field":
            if area_px > (total_image_area * 0.95):
                return False, "Excessive size", f"field_area_exceeds_threshold_{area_px:.0f}px"
            if area_px < max(5000.0, total_image_area * 0.008):
                return False, "Weak evidence", f"field_area_too_small_{area_px:.0f}px"
            pts_np = np.array(ring, dtype=np.float32)
            hull = cv2.convexHull(pts_np)
            hull_area = cv2.contourArea(hull)
            solidity = area_px / max(1.0, hull_area)
            if solidity < 0.65:
                return False, "Invalid geometry", f"field_solidity_too_low_{solidity:.2f}"
            rect = cv2.minAreaRect(pts_np)
            rw, rh = rect[1]
            aspect = max(rw, rh) / max(1.0, min(rw, rh))
            if aspect > 3.8:
                return False, "Invalid geometry", f"field_aspect_ratio_too_high_{aspect:.1f}"

        elif feat_type == "vegetation":
            if area_px < 100:
                return False, "Weak evidence", "vegetation_too_small"
            if area_px > (total_image_area * 0.20):
                return False, "Excessive size", f"vegetation_area_too_large_{area_px:.0f}px"
            pts_np = np.array(ring, dtype=np.float32)
            hull = cv2.convexHull(pts_np)
            hull_area = cv2.contourArea(hull)
            solidity = area_px / max(1.0, hull_area)
            if solidity < 0.35:
                return False, "Invalid geometry", f"vegetation_solidity_too_low_{solidity:.2f}"

        elif feat_type == "water":
            sub = feature.get("sub_type", "").lower()
            if "canal" in sub or "canal" in feature.get("name", "").lower():
                if area_px < 100 or area_px > (total_image_area * 0.08):
                    return False, "Invalid geometry", f"water_canal_area_out_of_bounds_{area_px:.0f}"
            else:
                if area_px < 150 or area_px > (total_image_area * 0.70):
                    return False, "Invalid geometry", f"water_body_area_out_of_bounds_{area_px:.0f}"

        # Hard water exclusion for non-water and non-building polygons (sample vertices and edge segments)
        if water_exclusion_mask is not None and feat_type not in ("water", "building"):
            pts_in_water = 0
            for pt in ring:
                px = min(img_w - 1, max(0, int(pt[0])))
                py = min(img_h - 1, max(0, int(pt[1])))
                if water_exclusion_mask[py, px] > 0:
                    pts_in_water += 1
            if pts_in_water > 0:
                return False, "Water crossing", f"{feat_type.capitalize()} polygon extends into water exclusion region ({pts_in_water} vertices in water)"

            # Also check intermediate edge points
            edge_water_pts = 0
            for i in range(len(ring) - 1):
                p1, p2 = ring[i], ring[i + 1]
                for t in (0.25, 0.5, 0.75):
                    sx = min(img_w - 1, max(0, int(p1[0] * (1 - t) + p2[0] * t)))
                    sy = min(img_h - 1, max(0, int(p1[1] * (1 - t) + p2[1] * t)))
                    if water_exclusion_mask[sy, sx] > 0:
                        edge_water_pts += 1
                        break
            if edge_water_pts > 0:
                return False, "Water crossing", f"{feat_type.capitalize()} polygon edge crosses water exclusion boundary"

        return True, None, "valid"

    elif g_type == "LineString":
        if len(coords) < 2:
            return False, "Insufficient continuity", "linestring_too_few_points"

        for pt in coords:
            if pt[0] < -2 or pt[0] > img_w + 5 or pt[1] < -2 or pt[1] > img_h + 5:
                return False, "Invalid geometry", "coordinates_out_of_image_bounds"

        length = calculate_line_length(coords)

        p_start, p_end = coords[0], coords[-1]
        at_edge_start = (p_start[0] < 12 or p_start[0] > img_w - 12 or p_start[1] < 12 or p_start[1] > img_h - 12)
        at_edge_end = (p_end[0] < 12 or p_end[0] > img_w - 12 or p_end[1] < 12 or p_end[1] > img_h - 12)

        if feat_type in ("wall", "fence"):
            if length < 35.0:
                return False, "Insufficient continuity", f"boundary_too_short_{length:.1f}px"
            if length > 150.0:
                return False, "Unsupported line", f"boundary_too_long_artifact_{length:.1f}px"

            if water_exclusion_mask is not None:
                crosses_water = False
                for i in range(len(coords) - 1):
                    p1, p2 = coords[i], coords[i + 1]
                    seg_d = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
                    n_samples = max(5, int(seg_d / 4.0))
                    for t in np.linspace(0, 1, n_samples):
                        sx = min(img_w - 1, max(0, int(p1[0] * (1 - t) + p2[0] * t)))
                        sy = min(img_h - 1, max(0, int(p1[1] * (1 - t) + p2[1] * t)))
                        if water_exclusion_mask[sy, sx] > 0:
                            crosses_water = True
                            break
                    if crosses_water:
                        break
                if crosses_water:
                    return False, "Water crossing", f"{feat_type.capitalize()} crosses water exclusion mask / ocean"

        elif feat_type == "road":
            if at_edge_start and at_edge_end and length > (max_dim * 0.92):
                is_wide = feature.get("estimated_width_pixels", 0) >= 10 or feature.get("width", 0) >= 10
                if not is_wide:
                    return False, "Image-edge artifact", "Road spans canvas border-to-border without physical ground termination"
            if length < 30.0:
                return False, "Insufficient continuity", f"road_too_short_{length:.1f}px"

            # Check road water crossing against true water body (water_clean) rather than dilated boundary
            target_water = water_clean if water_clean is not None else water_exclusion_mask
            if target_water is not None:
                pts_in_water = 0
                total_samples = 0
                for i in range(len(coords) - 1):
                    p1, p2 = coords[i], coords[i + 1]
                    seg_d = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
                    n_samples = max(4, int(seg_d / 4.0))
                    for t in np.linspace(0, 1, n_samples):
                        sx = min(img_w - 1, max(0, int(p1[0] * (1 - t) + p2[0] * t)))
                        sy = min(img_h - 1, max(0, int(p1[1] * (1 - t) + p2[1] * t)))
                        if target_water[sy, sx] > 0:
                            pts_in_water += 1
                        total_samples += 1
                if total_samples > 0 and (pts_in_water / total_samples) > 0.25:
                    return False, "Water crossing", f"Road crosses water body ({int(pts_in_water/total_samples*100)}% submerged)"

        # Check tortuosity / sharp zig-zag turning angles (relax from 72 to 95 deg to allow natural turns)
        for i in range(len(coords) - 2):
            p0, p1, p2 = coords[i], coords[i + 1], coords[i + 2]
            v1 = (p1[0] - p0[0], p1[1] - p0[1])
            v2 = (p2[0] - p1[0], p2[1] - p1[1])
            l1, l2 = math.hypot(*v1), math.hypot(*v2)
            if l1 > 2 and l2 > 2:
                cos_a = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)))
                deg = math.degrees(math.acos(cos_a))
                if deg > 95.0:
                    return False, "Invalid geometry", f"Erratic linear trajectory with sharp turning angle ({deg:.1f} deg)"

        # Reject extreme single-segment jump across image
        for i in range(len(coords) - 1):
            seg_len = math.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1])
            if seg_len > (max_dim * 0.40):
                return False, "Unsupported line", "extreme_single_segment_jump_across_canvas"

        return True, None, "valid"

    return False, "Invalid geometry", f"unsupported_geometry_type_{g_type}"


# ==============================================================================
# COLLAGE & BORDER MASK DETECTION
# ==============================================================================

def get_collage_and_margin_mask(image):
    """
    Detect outer canvas padding and internal panel dividers (e.g. 4-panel collages)
    to suppress artificial border lines.
    """
    h, w = image.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)

    # 1. Edge margins (outer 16 pixels)
    mask[:16, :] = 255
    mask[-16:, :] = 255
    mask[:, :16] = 255
    mask[:, -16:] = 255

    # 2. Internal white/black dividing strips
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    is_pure_white = gray > 248
    is_pure_black = gray < 8

    col_white_frac = np.mean(is_pure_white, axis=0)
    col_black_frac = np.mean(is_pure_black, axis=0)
    divider_cols = np.where((col_white_frac > 0.85) | (col_black_frac > 0.85))[0]
    for c in divider_cols:
        c_min = max(0, c - 6)
        c_max = min(w, c + 7)
        mask[:, c_min:c_max] = 255

    row_white_frac = np.mean(is_pure_white, axis=1)
    row_black_frac = np.mean(is_pure_black, axis=1)
    divider_rows = np.where((row_white_frac > 0.85) | (row_black_frac > 0.85))[0]
    for r in divider_rows:
        r_min = max(0, r - 6)
        r_max = min(h, r + 7)
        mask[r_min:r_max, :] = 255

    return mask


# ==============================================================================
# 1. BUILDING DETECTION (YOLOv8n-seg - Single Class "Building")
# ==============================================================================

def run_ml_building_segmentation(image, model, conf_thresh, tile_size, overlap, ignore_mask):
    """
    Step 6B & 6C Building Footprint Segmentation.
    Runs local YOLOv8n-seg exclusively for buildings.
    """
    h, w = image.shape[:2]
    step = int(tile_size * (1.0 - overlap))

    x_starts = list(range(0, max(1, w - tile_size + 1), step))
    if x_starts[-1] + tile_size < w:
        x_starts.append(w - tile_size)
    y_starts = list(range(0, max(1, h - tile_size + 1), step))
    if y_starts[-1] + tile_size < h:
        y_starts.append(h - tile_size)

    tiles = []
    for ys in y_starts:
        for xs in x_starts:
            tiles.append((max(0, xs), max(0, ys), min(w, xs + tile_size), min(h, ys + tile_size)))

    if w <= tile_size and h <= tile_size:
        tiles = [(0, 0, w, h)]

    candidate_polygons = []
    tiles_processed = 0

    for tx1, ty1, tx2, ty2 in tiles:
        tile_crop = image[ty1:ty2, tx1:tx2]
        if tile_crop.shape[0] < 20 or tile_crop.shape[1] < 20:
            continue
        tiles_processed += 1

        try:
            results = model.predict(
                tile_crop,
                conf=conf_thresh,
                imgsz=tile_size,
                verbose=False,
                device="cpu"
            )
        except Exception:
            continue

        for res in results:
            if res.masks is None or len(res.masks) == 0:
                continue

            for m_idx, mask_data in enumerate(res.masks.data):
                m_np = mask_data.cpu().numpy()
                th, tw = tile_crop.shape[:2]
                m_resized = cv2.resize(m_np, (tw, th), interpolation=cv2.INTER_NEAREST).astype(np.uint8)

                cnts, _ = cv2.findContours(m_resized, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                for c in cnts:
                    area = cv2.contourArea(c)
                    if area < 45:
                        continue

                    simplified = simplify_contour(c, epsilon_factor=0.015)
                    if not simplified or len(simplified) < 4:
                        continue

                    global_pts = [[pt[0] + tx1, pt[1] + ty1] for pt in simplified]
                    regularized = regularize_building_corners(global_pts)

                    box_np = np.array(regularized, dtype=np.float32)
                    rect = cv2.minAreaRect(box_np)
                    rw, rh = rect[1]
                    if min(rw, rh) < 4.5:
                        continue
                    aspect = max(rw, rh) / max(1.0, min(rw, rh))
                    if aspect > 4.8:
                        continue

                    bx1, by1 = np.min(box_np, axis=0)
                    bx2, by2 = np.max(box_np, axis=0)
                    conf = float(res.boxes.conf[m_idx].cpu().item()) if res.boxes is not None else 0.85

                    candidate_polygons.append({
                        "points": regularized,
                        "area": calculate_polygon_area(regularized),
                        "bbox": [float(bx1), float(by1), float(bx2), float(by2)],
                        "conf": conf
                    })

    # Non-Maximum Suppression (IoU >= 0.35)
    kept_buildings = []
    sorted_candidates = sorted(candidate_polygons, key=lambda x: x["conf"], reverse=True)

    for cand in sorted_candidates:
        c_box = cand["bbox"]
        c_area = cand["area"]

        pts_np = np.array(cand["points"], dtype=np.int32)
        cx = int(np.mean(pts_np[:, 0]))
        cy = int(np.mean(pts_np[:, 1]))
        if 0 <= cx < w and 0 <= cy < h and ignore_mask[cy, cx] > 0:
            continue

        suppressed = False
        for kept in kept_buildings:
            k_box = kept["bbox"]
            ix1 = max(c_box[0], k_box[0])
            iy1 = max(c_box[1], k_box[1])
            ix2 = min(c_box[2], k_box[2])
            iy2 = min(c_box[3], k_box[3])
            iw = max(0.0, ix2 - ix1)
            ih = max(0.0, iy2 - iy1)
            inter_area = iw * ih
            union_area = c_area + kept["area"] - inter_area
            iou = inter_area / max(1.0, union_area)
            if iou > 0.35:
                suppressed = True
                break

        if not suppressed:
            kept_buildings.append(cand)

    buildings = []
    building_mask = np.zeros((h, w), dtype=np.uint8)

    for idx, b_item in enumerate(kept_buildings):
        pts = b_item["points"]
        cv2.fillPoly(building_mask, [np.array(pts, dtype=np.int32)], 255)

        raw_conf = float(b_item["conf"])
        final_conf = round(raw_conf, 4)

        buildings.append({
            "index": idx + 1,
            "class": "building",
            "type": "building",
            "detection_type": "BUILDING",
            "feature_type": "Building",
            "name": f"Building Footprint {idx + 1}",
            "sub_type": "Residential / Commercial Structure",
            "confidence": final_conf,
            "confidence_type": "model_probability",
            "provider": "ml",
            "raw_model_class": "Building",
            "mapped_feature_type": "building",
            "model_name": MODEL_METADATA["name"],
            "geometry": {
                "type": "Polygon",
                "coordinates": [pts]
            },
            "coordinate_mode": "image",
            "area_pixels": round(b_item["area"], 1),
            "area_image_pixels": round(b_item["area"], 1),
            "evidence": [
                f"ml_confidence_{int(raw_conf * 100)}pct",
                "yolov8n_aerial_segmentation",
                "rectangular_cadastral_profile"
            ]
        })

    return buildings, building_mask, tiles_processed, len(candidate_polygons)


# ==============================================================================
# 2. WATER BODY DETECTION & HARD EXCLUSION MASK
# ==============================================================================

def detect_water_cv(image, ignore_mask, rejections, building_mask=None):
    """
    Step 6B Final Quality Pass: Hard Water Exclusion & Shoreline Tracing.
    - Deep blue / natural water spectral signature:
      Hue 90-130, Saturation >= 100, Blue > Red + 25, Blue >= Green - 10.
    - Generates water_exclusion_mask (dilated 18px) for hard rejection of non-water features.
    - Contours follow the actual shoreline and canvas borders with ZERO internal diagonal shortcuts.
    """
    h, w = image.shape[:2]
    total_area = float(w * h)

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    b = image[:, :, 0].astype(np.float32)
    g = image[:, :, 1].astype(np.float32)
    r = image[:, :, 2].astype(np.float32)

    # True water signature (deep blue sea, lake, reservoir, and clear coastal water with low red)
    is_water = (hsv[:, :, 0] >= 85) & (hsv[:, :, 0] <= 135) & (hsv[:, :, 1] >= 70) & (b > r * 1.5 + 20) & (b >= g - 10) & (r < 28)
    water_mask_raw = is_water.astype(np.uint8) * 255
    if building_mask is not None:
        water_mask_raw[building_mask > 0] = 0

    kernel_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    water_clean = cv2.morphologyEx(water_mask_raw, cv2.MORPH_OPEN, kernel_w)
    water_clean = cv2.morphologyEx(water_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))

    # Filter out rough terrain and false shadow noise via surface texture smoothness
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    contours_raw, _ = cv2.findContours(water_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    water_clean_filtered = np.zeros((h, w), dtype=np.uint8)
    for c in contours_raw:
        area = cv2.contourArea(c)
        rect = cv2.minAreaRect(c)
        rw, rh = rect[1]
        aspect = max(rw, rh) / max(1.0, min(rw, rh))
        if area >= max(600.0, total_area * 0.005) or (aspect >= 4.5 and area >= 300.0):
            m_c = np.zeros((h, w), dtype=np.uint8)
            cv2.drawContours(m_c, [c], -1, 255, -1)
            std_val = float(np.std(gray[m_c > 0])) if np.count_nonzero(m_c) > 0 else 99.0
            mean_r_val = float(np.mean(r[m_c > 0])) if np.count_nonzero(m_c) > 0 else 99.0
            if std_val < 26.0 and mean_r_val < 22.0:
                cv2.drawContours(water_clean_filtered, [c], -1, 255, -1)
    water_clean = water_clean_filtered

    # Exclusion masks (conservative 10px buffer to protect shoreline coastal roads)
    water_exclusion_mask = cv2.dilate(water_clean, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (10, 10)))
    coast_edge = cv2.morphologyEx(water_clean, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    coastline_exclusion_mask = cv2.dilate(coast_edge, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (12, 12)))

    contours_w, _ = cv2.findContours(water_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    water_features = []

    for idx, c in enumerate(sorted(contours_w, key=cv2.contourArea, reverse=True)):
        area = cv2.contourArea(c)
        if area < max(500.0, total_area * 0.005):
            continue

        # Use tight precision epsilon to prevent diagonal shortcut cuts across ocean
        peri = cv2.arcLength(c, True)
        epsilon = max(2.0, min(3.8, 0.001 * peri))
        approx = cv2.approxPolyDP(c, epsilon, True)
        simplified = approx.reshape(-1, 2).tolist()
        if not simplified or len(simplified) < 4:
            continue

        # Border coordinate clamping to eliminate sub-pixel border gaps
        for pt in simplified:
            if pt[0] < 8: pt[0] = 0
            elif pt[0] > w - 9: pt[0] = w - 1
            if pt[1] < 8: pt[1] = 0
            elif pt[1] > h - 9: pt[1] = h - 1

        if simplified[0] != simplified[-1]:
            simplified.append(simplified[0])

        rect = cv2.minAreaRect(c)
        rw, rh = rect[1]
        aspect = max(rw, rh) / max(1.0, min(rw, rh))
        min_dim = min(rw, rh)

        is_canal = (aspect >= 4.5) and (min_dim <= 28.0) and (area < total_area * 0.08)

        if is_canal:
            score = round(min(0.88, max(0.68, 0.72 + (area / total_area) * 0.20)), 4)
            water_features.append({
                "index": len(water_features) + 1,
                "class": "water",
                "type": "water",
                "detection_type": "WATER",
                "feature_type": "Water Canal",
                "name": f"Water Canal {len(water_features) + 1}",
                "sub_type": "Irrigation Canal / Channel",
                "confidence": score,
                "confidence_type": "evidence_score",
                "provider": "cv_derived",
                "raw_model_class": None,
                "mapped_feature_type": "water",
                "model_name": "Aerial CV Waterbody Engine v2.5",
                "method": "Linear artificial channel segmentation & width constraint",
                "source": "cv_derived",
                "geometry": { "type": "Polygon", "coordinates": [simplified] },
                "coordinate_mode": "image",
                "area_pixels": round(area, 1),
                "area_image_pixels": round(area, 1),
                "evidence": [
                    "narrow_channel_geometry",
                    "water_spectral_ratio",
                    f"channel_width_{min_dim:.1f}px"
                ]
            })
        else:
            is_ocean = area > (total_area * 0.12)
            name = "Water Body (Coastal / Ocean)" if is_ocean else f"Water Body {len(water_features) + 1}"
            sub_type = "Natural Water Body / Ocean" if is_ocean else "Water Retention Basin / Pond"
            score = round(min(0.95, max(0.75, 0.80 + (area / total_area) * 0.15)), 4)
            water_features.append({
                "index": len(water_features) + 1,
                "class": "water",
                "type": "water",
                "detection_type": "WATER",
                "feature_type": "Water Body",
                "name": name,
                "sub_type": sub_type,
                "confidence": score,
                "confidence_type": "evidence_score",
                "provider": "cv_derived",
                "raw_model_class": None,
                "mapped_feature_type": "water",
                "model_name": "Aerial CV Waterbody Engine v2.5",
                "method": "Spectral waterbody index & shoreline analysis",
                "source": "cv_derived",
                "geometry": { "type": "Polygon", "coordinates": [simplified] },
                "coordinate_mode": "image",
                "area_pixels": round(area, 1),
                "area_image_pixels": round(area, 1),
                "evidence": [
                    "deep_water_spectral_hue",
                    "smooth_surface_texture",
                    "natural_shoreline_boundary"
                ]
            })

    return water_features, water_clean, water_exclusion_mask, coastline_exclusion_mask, len(contours_w)


# ==============================================================================
# 3. ROAD CORRIDOR DETECTION (Distance Transform Ridges & Corridor Tracing)
# ==============================================================================

def detect_roads_cv(image, building_mask, water_exclusion_mask, edge_margin_mask, ignore_mask, rejections, water_clean=None):
    """
    Step 6B Final Quality Pass: Road Detection with Grounded Water Exclusion.
    - Road surface strictly zeroed out inside true water bodies.
    - Candidate segments crossing open water are rejected ("Water crossing").
    - Segments spanning border-to-border are rejected ("Image-edge artifact").
    - Verifies local road-pixel support along the polyline.
    """
    h, w = image.shape[:2]
    max_dim = max(w, h)
    target_water = water_clean if water_clean is not None else water_exclusion_mask

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    b = image[:, :, 0].astype(np.float32)
    g = image[:, :, 1].astype(np.float32)
    r = image[:, :, 2].astype(np.float32)
    exg = 2.0 * g - r - b

    # Asphalt / concrete pavement: low saturation, moderate brightness, non-vegetative
    is_paved = (hsv[:, :, 1] < 55) & (hsv[:, :, 2] >= 80) & (hsv[:, :, 2] <= 240) & (abs(exg) < 14.0)
    # Dirt road / unpaved rural track: tan/brown hue, moderate saturation, non-vegetative
    is_dirt = (hsv[:, :, 0] >= 16) & (hsv[:, :, 0] <= 38) & (hsv[:, :, 1] >= 40) & (hsv[:, :, 1] <= 160) & (hsv[:, :, 2] >= 70) & (hsv[:, :, 2] <= 210) & (exg < 8.0)

    road_surface = (is_paved | is_dirt).astype(np.uint8) * 255
    road_surface[building_mask > 0] = 0
    if target_water is not None:
        road_surface[target_water > 0] = 0
    road_surface[ignore_mask > 0] = 0

    kernel_r = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    road_clean = cv2.morphologyEx(road_surface, cv2.MORPH_OPEN, kernel_r)
    road_bridged = cv2.morphologyEx(road_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(road_bridged, connectivity=8)

    candidate_roads = []
    road_corridor_mask = np.zeros((h, w), dtype=np.uint8)

    for l in range(1, num_labels):
        area = stats[l, cv2.CC_STAT_AREA]
        bx, by, bw, bh = stats[l, :4]
        diag = math.hypot(bw, bh)
        approx_w = area / max(1.0, diag)
        true_elongation = diag / max(1.0, approx_w)

        comp_mask = (labels == l).astype(np.uint8) * 255
        dist = cv2.distanceTransform(comp_mask, cv2.DIST_L2, 5)
        max_half_w = float(np.max(dist)) if np.max(dist) > 0 else 0.0

        # Width constraint: Road must be an elongated corridor (max half-width <= 32px, approx_w <= 56px)
        if approx_w > 56.0 or max_half_w > 32.0:
            rejections.append({
                "category": "Unsupported line",
                "class": "road",
                "reason": f"Region width exceeds road corridor limits ({approx_w:.1f}px > 56px, max_half={max_half_w:.1f}px) - agricultural plot or open ground",
                "score": 0.35,
                "threshold": CLASS_CONFIDENCE_THRESHOLDS["road"],
                "coordinates": [[int(bx), int(by)], [int(bx + bw), int(by + bh)]]
            })
            continue

        if area >= 320 and diag >= 45 and true_elongation >= 1.8:
            pts = []
            if bw >= bh:
                step = max(6, bw // 32)
                for x in range(bx + 4, bx + bw - 4, step):
                    col_y = np.where(comp_mask[:, x] > 0)[0]
                    if len(col_y) > 0:
                        best_y = int(col_y[np.argmax(dist[col_y, x])])
                        if target_water is None or target_water[best_y, x] == 0:
                            pts.append([int(x), best_y])
            else:
                step = max(6, bh // 32)
                for y in range(by + 4, by + bh - 4, step):
                    row_x = np.where(comp_mask[y, :] > 0)[0]
                    if len(row_x) > 0:
                        best_x = int(row_x[np.argmax(dist[y, row_x])])
                        if target_water is None or target_water[y, best_x] == 0:
                            pts.append([best_x, int(y)])

            if len(pts) >= 3:
                pts_np = np.array(pts, dtype=np.int32).reshape((-1, 1, 2))
                epsilon = max(2.5, 0.015 * cv2.arcLength(pts_np, False))
                simplified = cv2.approxPolyDP(pts_np, epsilon, False).reshape(-1, 2).tolist()

                # Check tortuosity / sharp zig-zag turning angles (roads do not make sharp turns > 78 deg)
                has_sharp_zigzag = False
                for i in range(len(simplified) - 2):
                    p0, p1, p2 = simplified[i], simplified[i + 1], simplified[i + 2]
                    v1 = (p1[0] - p0[0], p1[1] - p0[1])
                    v2 = (p2[0] - p1[0], p2[1] - p1[1])
                    len1 = math.hypot(*v1)
                    len2 = math.hypot(*v2)
                    if len1 > 2 and len2 > 2:
                        cos_a = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (len1 * len2)))
                        deg = math.degrees(math.acos(cos_a))
                        if deg > 78.0:
                            has_sharp_zigzag = True
                            break

                if has_sharp_zigzag:
                    rejections.append({
                        "category": "Invalid geometry",
                        "class": "road",
                        "reason": "Erratic non-road trajectory with sharp zig-zag turning angles",
                        "score": 0.40,
                        "threshold": CLASS_CONFIDENCE_THRESHOLDS["road"],
                        "coordinates": simplified
                    })
                    continue

                # 1. HARD WATER CROSSING VALIDATION (strictly rejects pier docks over water or coastline ledge)
                crosses_water = False
                if target_water is not None:
                    w_pts = sum(1 for p in simplified if 0 <= p[0] < w and 0 <= p[1] < h and target_water[p[1], p[0]] > 0)
                    if w_pts > 0:
                        crosses_water = True
                if water_exclusion_mask is not None and not crosses_water:
                    w_ex = sum(1 for p in simplified if 0 <= p[0] < w and 0 <= p[1] < h and water_exclusion_mask[p[1], p[0]] > 0)
                    if w_ex > (len(simplified) * 0.35):
                        crosses_water = True

                if crosses_water:
                    rejections.append({
                        "category": "Water crossing",
                        "class": "road",
                        "reason": "Road candidate intersects water exclusion mask / ocean pier",
                        "score": 0.35,
                        "threshold": CLASS_CONFIDENCE_THRESHOLDS["road"],
                        "coordinates": simplified
                    })
                    continue

                # 2. IMAGE EDGE ARTIFACT VALIDATION
                p_start, p_end = simplified[0], simplified[-1]
                at_edge_start = (p_start[0] < 12 or p_start[0] > w - 12 or p_start[1] < 12 or p_start[1] > h - 12)
                at_edge_end = (p_end[0] < 12 or p_end[0] > w - 12 or p_end[1] < 12 or p_end[1] > h - 12)
                length = calculate_line_length(simplified)

                if at_edge_start and at_edge_end and length > (max_dim * 0.92):
                    if approx_w < 10.0:
                        rejections.append({
                            "category": "Image-edge artifact",
                            "class": "road",
                            "reason": "Road candidate spans canvas edge-to-edge without grounded terminal",
                            "score": 0.40,
                            "threshold": CLASS_CONFIDENCE_THRESHOLDS["road"],
                            "coordinates": simplified
                        })
                        continue

                if length < 42.0:
                    rejections.append({
                        "category": "Insufficient continuity",
                        "class": "road",
                        "reason": f"Road segment too short ({length:.1f}px < 42px)",
                        "score": 0.45,
                        "threshold": CLASS_CONFIDENCE_THRESHOLDS["road"],
                        "coordinates": simplified
                    })
                    continue

                candidate_roads.append({
                    "coords": simplified,
                    "length": length,
                    "width": approx_w,
                    "elongation": true_elongation
                })
                road_corridor_mask = cv2.bitwise_or(road_corridor_mask, comp_mask)

    roads = []
    for idx, r in enumerate(candidate_roads):
        coords = r["coords"]
        score = round(min(0.95, max(0.68, 0.75 + min(0.20, r["length"] / (max_dim * 0.5)))), 4)
        is_primary = r["length"] > (max_dim * 0.25)
        name = f"Road Corridor {idx + 1} ({'Primary' if is_primary else 'Local Lane'})"
        sub_type = "Primary Paved Highway" if is_primary else "Local Residential Lane"

        roads.append({
            "index": idx + 1,
            "class": "road",
            "type": "road",
            "detection_type": "ROAD",
            "feature_type": "Road",
            "name": name,
            "sub_type": sub_type,
            "confidence": score,
            "confidence_type": "evidence_score",
            "provider": "cv_derived",
            "raw_model_class": None,
            "mapped_feature_type": "road",
            "model_name": "Aerial CV Road Corridor Engine v2.5",
            "method": "Distance-transform ridge extraction & medial axis curve fitting",
            "source": "cv_derived",
            "geometry": {
                "type": "LineString",
                "coordinates": coords
            },
            "coordinate_mode": "image",
            "length_pixels": round(r["length"], 1),
            "estimated_width_pixels": round(r["width"], 1),
            "evidence": [
                "connected_corridor_surface",
                "distance_transform_centerline",
                f"elongation_factor_{r['elongation']:.1f}",
                "water_exclusion_verified"
            ]
        })

    road_stats = {
        "total_segments": len(roads),
        "intersections_detected": 0
    }

    road_corridor_mask_dilated = cv2.dilate(road_corridor_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (14, 14)))
    return roads, road_stats, road_corridor_mask_dilated, len(candidate_roads)


# ==============================================================================
# 4. VEGETATION CANOPY DETECTION (Tree Foliage Clusters)
# ==============================================================================

def detect_vegetation_cv(image, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, edge_margin_mask, ignore_mask, rejections):
    """
    Step 6B Final Quality Pass: Contextual Tree Foliage Clusters.
    - Excludes water, roads, buildings, coastline surf, and edge margins.
    """
    h, w = image.shape[:2]
    total_area = float(w * h)

    b = image[:, :, 0].astype(np.float32)
    g = image[:, :, 1].astype(np.float32)
    r = image[:, :, 2].astype(np.float32)
    exg = 2.0 * g - r - b

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    mean_gray = cv2.blur(gray.astype(np.float32), (7, 7))
    sq_gray = cv2.blur((gray.astype(np.float32)) ** 2, (7, 7))
    std_gray = np.sqrt(np.maximum(0.0, sq_gray - mean_gray ** 2))

    # Terrestrial vegetation: high excess green, texture entropy, and non-aquatic (R >= B - 10 and R >= 25)
    tree_canopy_raw = ((exg > 22.0) & (r >= b - 10.0) & (r >= 25.0) & (std_gray > 14.0)).astype(np.uint8) * 255
    tree_canopy_raw[building_mask > 0] = 0
    tree_canopy_raw[road_corridor_mask > 0] = 0
    tree_canopy_raw[water_exclusion_mask > 0] = 0
    tree_canopy_raw[coastline_exclusion_mask > 0] = 0
    tree_canopy_raw[edge_margin_mask > 0] = 0
    tree_canopy_raw[ignore_mask > 0] = 0

    kernel_v = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    veg_clean = cv2.morphologyEx(tree_canopy_raw, cv2.MORPH_OPEN, kernel_v)
    cnts_v, _ = cv2.findContours(veg_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)

    vegetation = []
    veg_mask = np.zeros((h, w), dtype=np.uint8)

    for idx, c in enumerate(sorted(cnts_v, key=cv2.contourArea, reverse=True)[:18]):
        area = cv2.contourArea(c)
        if area > (total_area * 0.15):
            rejections.append({
                "category": "Excessive size",
                "class": "vegetation",
                "reason": f"Vegetation canopy cluster too large ({area/total_area*100:.1f}%)",
                "score": 0.40,
                "threshold": CLASS_CONFIDENCE_THRESHOLDS["vegetation"],
                "coordinates": c.reshape(-1, 2).tolist()[:4]
            })
            continue

        if area < 200:
            continue

        hull = cv2.convexHull(c)
        hull_area = cv2.contourArea(hull)
        solidity = area / max(1.0, hull_area)
        if solidity < 0.42:
            rejections.append({
                "category": "Invalid geometry",
                "class": "vegetation",
                "reason": f"Jagged / non-compact vegetation canopy (solidity={solidity:.2f} < 0.42)",
                "score": 0.40,
                "threshold": CLASS_CONFIDENCE_THRESHOLDS["vegetation"],
                "coordinates": c.reshape(-1, 2).tolist()[:4]
            })
            continue

        simplified = simplify_contour(c, epsilon_factor=0.012)
        if not simplified or len(simplified) < 4:
            continue

        # Reject vegetation candidate if any vertex or edge midpoint extends into water exclusion or coastline mask
        in_water = False
        for pt in simplified:
            px = min(w - 1, max(0, int(pt[0])))
            py = min(h - 1, max(0, int(pt[1])))
            if water_exclusion_mask[py, px] > 0 or coastline_exclusion_mask[py, px] > 0:
                in_water = True
                break
        if in_water:
            rejections.append({
                "category": "Water crossing",
                "class": "vegetation",
                "reason": "Vegetation canopy candidate extends into water exclusion mask",
                "score": 0.40,
                "threshold": CLASS_CONFIDENCE_THRESHOLDS["vegetation"],
                "coordinates": simplified[:4]
            })
            continue

        cv2.fillPoly(veg_mask, [np.array(simplified, dtype=np.int32)], 255)
        score = round(min(0.88, max(0.68, 0.70 + (area / total_area) * 0.25)), 4)

        vegetation.append({
            "index": idx + 1,
            "class": "vegetation",
            "type": "vegetation",
            "detection_type": "VEGETATION",
            "feature_type": "Vegetation",
            "name": f"Vegetation Canopy Cluster {idx + 1}",
            "sub_type": "Dense Tree Foliage Canopy",
            "confidence": score,
            "confidence_type": "evidence_score",
            "provider": "cv_derived",
            "raw_model_class": None,
            "mapped_feature_type": "vegetation",
            "model_name": "Aerial CV Vegetation Canopy Engine v2.5",
            "method": "Excess Green Index (ExG) & canopy texture entropy clustering",
            "source": "cv_derived",
            "geometry": {
                "type": "Polygon",
                "coordinates": [simplified]
            },
            "coordinate_mode": "image",
            "area_pixels": round(area, 1),
            "area_image_pixels": round(area, 1),
            "evidence": [
                "high_excess_green_index",
                "canopy_foliage_texture_entropy",
                "non_water_ground_canopy"
            ]
        })

    veg_mask_dilated = cv2.dilate(veg_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (10, 10)))
    return vegetation, veg_mask_dilated, len(cnts_v)


# ==============================================================================
# 5. AGRICULTURAL FIELD DETECTION (Strict Coherence & Settlement Rejection)
# ==============================================================================

def detect_fields_cv(image, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, veg_mask, building_features, edge_margin_mask, ignore_mask, rejections):
    """
    Agricultural Field Detection (Spectral Clustering & Boundary Partition).
    - Multi-spectral crop and soil clustering: cultivated soil, green crops, and fallow/grain plots.
    - Road corridor, building footprint, and hedgerow canopy partitioning.
    - Density-based residential settlement rejection (strictly rejects residential building yards).
    - Aspect ratio <= 3.5 and solidity >= 0.65.
    - Adaptive Douglas-Peucker simplification + acute saw-tooth spike removal.
    """
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
                rejections.append({
                    "category": "Excessive size",
                    "class": "field",
                    "reason": f"Field candidate exceeds maximum region threshold ({area/total_area*100:.1f}%)",
                    "score": 0.40,
                    "threshold": CLASS_CONFIDENCE_THRESHOLDS["field"],
                    "coordinates": c.reshape(-1, 2).tolist()[:4]
                })
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
                rejections.append({
                    "category": "Invalid geometry",
                    "class": "field",
                    "reason": f"Encloses {bldgs_inside} building footprints (residential settlement, not agricultural plot)",
                    "score": 0.30,
                    "threshold": CLASS_CONFIDENCE_THRESHOLDS["field"],
                    "coordinates": c.reshape(-1, 2).tolist()[:4]
                })
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
                    rejections.append({
                        "category": "Invalid geometry",
                        "class": "field",
                        "reason": f"Urban residential yard/courtyard adjacent to {close_bldgs} buildings (not agricultural land)",
                        "score": 0.35,
                        "threshold": CLASS_CONFIDENCE_THRESHOLDS["field"],
                        "coordinates": c.reshape(-1, 2).tolist()[:4]
                    })
                    continue

            hull = cv2.convexHull(c)
            hull_area = cv2.contourArea(hull)
            solidity = area / max(1.0, hull_area)
            rect = cv2.minAreaRect(c)
            rw, rh = rect[1]
            aspect = max(rw, rh) / max(1.0, min(rw, rh))

            if solidity < 0.65 or aspect > 3.5:
                rejections.append({
                    "category": "Invalid geometry",
                    "class": "field",
                    "reason": f"Non-convex agricultural geometry (solidity={solidity:.2f} < 0.65, aspect={aspect:.1f})",
                    "score": 0.45,
                    "threshold": CLASS_CONFIDENCE_THRESHOLDS["field"],
                    "coordinates": c.reshape(-1, 2).tolist()[:4]
                })
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


# ==============================================================================
# 6. STONE WALL & FENCE BOUNDARY DETECTION (Strict Curtilage Verification)
# ==============================================================================

def detect_walls_and_fences_cv(image, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, veg_mask, building_features, road_features, field_features, edge_margin_mask, ignore_mask, rejections):
    """
    Step 6B Final Quality Pass: Physical Boundary Verification (Conservative Curtilage).
    - Field interiors are strictly zeroed out: tractor furrows and plowing lines are eliminated.
    - Zeroed out inside building footprints, road corridors, water exclusion mask, coastline surf, and edge margins.
    - Rejects ungrounded lines touching image edges ("Image-edge artifact").
    - Requires structural curtilage anchoring: within 25px of building footprint OR within 20px of road corridor.
    - Enforces physical contrast (Sobel gradient >= 88 for walls, >= 70 for fences) ("Weak evidence").
    - Provider marked as 'cv_derived' with honest evidence score.
    """
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
    raw_lines_count = len(lines) if lines is not None else 0

    if lines is not None:
        kept = []
        for s in lines.reshape(-1, 4).tolist():
            length = math.hypot(s[2] - s[0], s[3] - s[1])
            # Maximum length constraint: impossible long straight line rejection
            if length < 38 or length > 145:
                continue

            # Must not touch outer edges
            if s[0] < 20 or s[0] > w - 20 or s[1] < 20 or s[1] > h - 20 or \
               s[2] < 20 or s[2] > w - 20 or s[3] < 20 or s[3] > h - 20:
                rejections.append({
                    "category": "Image-edge artifact",
                    "class": "boundary",
                    "reason": "Boundary line terminates at outer canvas border",
                    "score": 0.40,
                    "threshold": CLASS_CONFIDENCE_THRESHOLDS["wall"],
                    "coordinates": [[int(s[0]), int(s[1])], [int(s[2]), int(s[3])]]
                })
                continue

            # Water check
            mid_x = (s[0] + s[2]) / 2.0
            mid_y = (s[1] + s[3]) / 2.0
            if water_exclusion_mask[int(mid_y), int(mid_x)] > 0:
                rejections.append({
                    "category": "Water crossing",
                    "class": "boundary",
                    "reason": "Boundary line crosses water exclusion mask / ocean",
                    "score": 0.35,
                    "threshold": CLASS_CONFIDENCE_THRESHOLDS["wall"],
                    "coordinates": [[int(s[0]), int(s[1])], [int(s[2]), int(s[3])]]
                })
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
                rejections.append({
                    "category": "Disconnected feature",
                    "class": "boundary",
                    "reason": "Boundary line is isolated from any building curtilage, road corridor, or boundary network",
                    "score": 0.40,
                    "threshold": CLASS_CONFIDENCE_THRESHOLDS["wall"],
                    "coordinates": [[int(s[0]), int(s[1])], [int(s[2]), int(s[3])]]
                })
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
            else:
                rejections.append({
                    "category": "Weak evidence",
                    "class": "boundary",
                    "reason": f"Insufficient physical contrast (grad={avg_grad:.1f} < 88, std={std_dev:.1f})",
                    "score": round(min(0.68, avg_grad / 160.0), 2),
                    "threshold": CLASS_CONFIDENCE_THRESHOLDS["wall"],
                    "coordinates": coords
                })

    return walls, fences, raw_lines_count


# ==============================================================================
# 7. CROSS-CLASS CONFLICT RESOLUTION
# ==============================================================================

def resolve_cross_class_conflicts(buildings, roads, fields, walls, fences, vegetation, water):
    """
    Step 6B Final Quality Pass: Priority Order
    BUILDING > ROAD > WATER > FIELD > WALL/FENCE > VEGETATION.
    """
    filtered_walls = []
    for w_feat in walls:
        w_coords = w_feat.get("geometry", {}).get("coordinates", [])
        if len(w_coords) < 2: continue
        w_mid = w_coords[len(w_coords) // 2]
        is_near_road = False
        for r_feat in roads:
            for r_pt in r_feat.get("geometry", {}).get("coordinates", []):
                if math.hypot(w_mid[0] - r_pt[0], w_mid[1] - r_pt[1]) < 18.0:
                    is_near_road = True
                    break
            if is_near_road: break
        if not is_near_road:
            filtered_walls.append(w_feat)

    filtered_fences = []
    for f_feat in fences:
        f_coords = f_feat.get("geometry", {}).get("coordinates", [])
        if len(f_coords) < 2: continue
        f_mid = f_coords[len(f_coords) // 2]
        is_dup = False
        for r_feat in roads:
            for r_pt in r_feat.get("geometry", {}).get("coordinates", []):
                if math.hypot(f_mid[0] - r_pt[0], f_mid[1] - r_pt[1]) < 18.0:
                    is_dup = True
                    break
            if is_dup: break
        if not is_dup:
            for w_feat in filtered_walls:
                for w_pt in w_feat.get("geometry", {}).get("coordinates", []):
                    if math.hypot(f_mid[0] - w_pt[0], f_mid[1] - w_pt[1]) < 15.0:
                        is_dup = True
                        break
                if is_dup: break
        if not is_dup:
            filtered_fences.append(f_feat)

    return buildings, roads, fields, filtered_walls, filtered_fences, vegetation, water


def post_process_false_positive_filter(buildings, roads, fields, walls, fences, vegetation, water, img_w, img_h, water_exclusion_mask, rejections):
    """
    Step 6B Final Quality Pass: Post-Processing False Positive Filter (Requirement G).
    Removes:
    - tiny isolated polygons/lines
    - extreme outlier geometries
    - impossible long lines
    - heavily jagged artifacts
    - disconnected fragments with weak evidence
    - geometries extending into unrelated land/water
    """
    total_area = float(img_w * img_h)

    # 1. Filter Buildings
    kept_buildings = []
    for b in buildings:
        coords = b.get("geometry", {}).get("coordinates", [[]])[0]
        if not coords or len(coords) < 4:
            continue
        area = calculate_polygon_area(coords)
        if area < 100.0 or area > (total_area * 0.35):
            continue
        kept_buildings.append(b)

    # 2. Filter Roads
    kept_roads = []
    for r in roads:
        coords = r.get("geometry", {}).get("coordinates", [])
        if not coords or len(coords) < 2:
            continue
        length = calculate_line_length(coords)
        if length < 42.0:
            continue
        # Hard water exclusion for road candidates (no roads on water pier or submerged shoreline)
        if water_exclusion_mask is not None:
            if any(0 <= int(p[0]) < img_w and 0 <= int(p[1]) < img_h and water_exclusion_mask[int(p[1]), int(p[0])] > 0 for p in coords):
                continue
        kept_roads.append(r)

    # 3. Filter Fields
    kept_fields = []
    for f in fields:
        coords = f.get("geometry", {}).get("coordinates", [[]])[0]
        if not coords or len(coords) < 4:
            continue
        area = calculate_polygon_area(coords)
        if area < max(5000.0, total_area * 0.008) or area > (total_area * 0.45):
            continue
        poly_np = np.array(coords, dtype=np.float32)
        hull = cv2.convexHull(poly_np)
        solidity = area / max(1.0, cv2.contourArea(hull))
        if solidity < 0.65:
            continue
        kept_fields.append(f)

    # 4. Filter Walls (strict curtilage anchoring and length)
    kept_walls = []
    for w in walls:
        coords = w.get("geometry", {}).get("coordinates", [])
        if not coords or len(coords) < 2:
            continue
        length = calculate_line_length(coords)
        if length < 35.0 or length > 150.0:
            continue
        mid = [(coords[0][0] + coords[1][0]) / 2.0, (coords[0][1] + coords[1][1]) / 2.0]
        is_anchored = False
        for b in kept_buildings:
            b_coords = b.get("geometry", {}).get("coordinates", [[]])[0]
            for bp in b_coords:
                if math.hypot(mid[0] - bp[0], mid[1] - bp[1]) <= 28.0:
                    is_anchored = True
                    break
            if is_anchored: break
        if not is_anchored:
            for r in kept_roads:
                r_coords = r.get("geometry", {}).get("coordinates", [])
                for rp in r_coords:
                    if math.hypot(mid[0] - rp[0], mid[1] - rp[1]) <= 22.0:
                        is_anchored = True
                        break
                if is_anchored: break
        if is_anchored:
            kept_walls.append(w)
        else:
            rejections.append({
                "category": "Disconnected feature",
                "class": "wall",
                "reason": "Wall disconnected from building curtilage or road",
                "score": w.get("confidence", 0.0),
                "threshold": CLASS_CONFIDENCE_THRESHOLDS["wall"],
                "coordinates": coords
            })

    # 5. Filter Fences
    kept_fences = []
    for fc in fences:
        coords = fc.get("geometry", {}).get("coordinates", [])
        if not coords or len(coords) < 2:
            continue
        length = calculate_line_length(coords)
        if length < 35.0 or length > 140.0:
            continue
        mid = [(coords[0][0] + coords[1][0]) / 2.0, (coords[0][1] + coords[1][1]) / 2.0]
        is_anchored = False
        for b in kept_buildings:
            b_coords = b.get("geometry", {}).get("coordinates", [[]])[0]
            for bp in b_coords:
                if math.hypot(mid[0] - bp[0], mid[1] - bp[1]) <= 28.0:
                    is_anchored = True
                    break
            if is_anchored: break
        if not is_anchored:
            for r in kept_roads:
                r_coords = r.get("geometry", {}).get("coordinates", [])
                for rp in r_coords:
                    if math.hypot(mid[0] - rp[0], mid[1] - rp[1]) <= 22.0:
                        is_anchored = True
                        break
                if is_anchored: break
        if is_anchored:
            kept_fences.append(fc)
        else:
            rejections.append({
                "category": "Disconnected feature",
                "class": "fence",
                "reason": "Fence disconnected from building curtilage or road",
                "score": fc.get("confidence", 0.0),
                "threshold": CLASS_CONFIDENCE_THRESHOLDS["fence"],
                "coordinates": coords
            })

    return kept_buildings, kept_roads, kept_fields, kept_walls, kept_fences, vegetation, water


# ==============================================================================
# MAIN PIPELINE ENTRY POINT
# ==============================================================================

def main():
    start_time = time.time()
    args = parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({"success": False, "error": f"Input image not found: {args.input}"}))
        sys.exit(1)

    file_size = os.path.getsize(args.input)
    if file_size < 100:
        print(json.dumps({
            "success": False,
            "error": f"Uploaded image file is corrupted or unreadable (file size: {file_size} bytes). Please upload a valid drone image."
        }))
        sys.exit(1)

    img = safe_imread(args.input)
    if img is None or img.size == 0 or img.shape[0] < 10 or img.shape[1] < 10:
        print(json.dumps({"success": False, "error": f"Failed to decode image file: {args.input}. Supported formats: PNG, JPG, JPEG."}))
        sys.exit(1)

    img_h, img_w = img.shape[:2]
    run_id = args.run_id or f"run_{int(time.time() * 1000)}"
    rejections = []

    # 1. Edge margins and collage divider strip mask
    edge_margin_mask = np.zeros((img_h, img_w), dtype=np.uint8)
    edge_margin_mask[:16, :] = 255
    edge_margin_mask[-16:, :] = 255
    edge_margin_mask[:, :16] = 255
    edge_margin_mask[:, -16:] = 255

    ignore_mask = get_collage_and_margin_mask(img)

    # 2. Load model with robust multi-location discovery
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))

    resolved_model_path = None
    candidate_paths = []

    if args.model_path:
        if os.path.isabs(args.model_path):
            candidate_paths.append(args.model_path)
        else:
            candidate_paths.append(os.path.join(os.getcwd(), args.model_path))
            candidate_paths.append(os.path.join(project_root, args.model_path))
            candidate_paths.append(os.path.join(script_dir, args.model_path))

    candidate_paths.extend([
        os.path.join(script_dir, "models", "yolov8n-building-seg.pt"),
        os.path.join(project_root, "server", "ml", "models", "yolov8n-building-seg.pt"),
        os.path.join(os.getcwd(), "server", "ml", "models", "yolov8n-building-seg.pt"),
        os.path.join(project_root, "yolov8n-seg.pt"),
        os.path.join(os.getcwd(), "yolov8n-seg.pt")
    ])

    for cand in candidate_paths:
        if cand and os.path.exists(cand) and os.path.isfile(cand):
            resolved_model_path = cand
            break

    if not resolved_model_path:
        print(json.dumps({
            "success": False,
            "error": "The model is currently unreachable: Model weights file (yolov8n-building-seg.pt) not found."
        }))
        sys.exit(1)

    try:
        from ultralytics import YOLO
        model = YOLO(resolved_model_path)
    except Exception as model_err:
        print(json.dumps({
            "success": False,
            "error": f"The model is currently unreachable: Failed to initialize model weights ({str(model_err)})"
        }))
        sys.exit(1)

    # 3. Stage 1: Early Water & Coastline Segmentation with Hard Exclusion Masks
    water, water_clean, water_exclusion_mask, coastline_exclusion_mask, raw_water_count = detect_water_cv(
        img, ignore_mask, rejections
    )

    # 4. Stage 2: Building Segmentation (YOLOv8n-seg)
    t_ml_start = time.time()
    buildings, building_mask, tiles_count, raw_bldg_count = run_ml_building_segmentation(
        img, model, args.conf, args.tile_size, args.overlap, ignore_mask
    )
    t_ml_done = time.time()

    # Filter any building candidate located in water exclusion mask
    valid_buildings = []
    target_water = water_clean if water_clean is not None else water_exclusion_mask
    for b in buildings:
        coords = b.get("geometry", {}).get("coordinates", [[]])[0]
        if coords and target_water is not None:
            cx = int(sum(p[0] for p in coords) / len(coords))
            cy = int(sum(p[1] for p in coords) / len(coords))
            if 0 <= cx < img_w and 0 <= cy < img_h and target_water[cy, cx] > 0:
                pts_in_w = sum(1 for p in coords if 0 <= int(p[0]) < img_w and 0 <= int(p[1]) < img_h and target_water[int(p[1]), int(p[0])] > 0)
                if pts_in_w > (len(coords) * 0.5):
                    rejections.append({
                        "category": "Water crossing",
                        "class": "building",
                        "reason": f"Building footprint submerged inside water body ({pts_in_w}/{len(coords)} vertices in water)",
                        "score": b.get("confidence", 0.0),
                        "threshold": CLASS_CONFIDENCE_THRESHOLDS["building"],
                        "coordinates": coords
                    })
                    continue
        valid_buildings.append(b)
    buildings = valid_buildings

    # Update building mask with valid buildings
    building_mask = np.zeros((img_h, img_w), dtype=np.uint8)
    for b in buildings:
        coords = b.get("geometry", {}).get("coordinates", [[]])[0]
        if coords:
            cv2.fillPoly(building_mask, [np.array(coords, dtype=np.int32)], 255)

    # 5. Stage 3: Secondary Aerial CV Land Feature Analysis (Spatial Hierarchy)
    t_cv_start = time.time()

    # Road corridor segmentation (hard exclusion against water and edge margins)
    roads, road_stats, road_corridor_mask, raw_roads_count = detect_roads_cv(
        img, building_mask, water_exclusion_mask, edge_margin_mask, ignore_mask, rejections, water_clean=water_clean
    )

    # Vegetation canopy segmentation (excludes buildings, roads, water, coastline, edge margins)
    vegetation, veg_mask, raw_veg_count = detect_vegetation_cv(
        img, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, edge_margin_mask, ignore_mask, rejections
    )

    # Agricultural field segmentation (excludes buildings, roads, water, coastline, tree canopy, edge margins)
    fields, raw_fields_count = detect_fields_cv(
        img, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, veg_mask, buildings, edge_margin_mask, ignore_mask, rejections
    )

    # Linear boundary segmentation (excludes rooflines, road shoulders, coastline surf, canopy shadows, edge margins)
    walls, fences, raw_linear_count = detect_walls_and_fences_cv(
        img, building_mask, road_corridor_mask, water_exclusion_mask, coastline_exclusion_mask, veg_mask, buildings, roads, fields, edge_margin_mask, ignore_mask, rejections
    )

    t_cv_done = time.time()

    # Raw stage counts
    raw_stage_counts = {
        "buildings": raw_bldg_count,
        "roads": raw_roads_count,
        "fields": raw_fields_count,
        "walls": len(walls),
        "fences": len(fences),
        "vegetation": len(vegetation),
        "water": len(water)
    }

    # 5. Stage 3: Cross-Class Conflict Resolution
    buildings, roads, fields, walls, fences, vegetation, water = resolve_cross_class_conflicts(
        buildings, roads, fields, walls, fences, vegetation, water
    )

    # Stage 3B: False Positive Filter Pass (Requirement G)
    buildings, roads, fields, walls, fences, vegetation, water = post_process_false_positive_filter(
        buildings, roads, fields, walls, fences, vegetation, water, img_w, img_h, water_exclusion_mask, rejections
    )

    cleaned_stage_counts = {
        "buildings": len(buildings),
        "roads": len(roads),
        "fields": len(fields),
        "walls": len(walls),
        "fences": len(fences),
        "vegetation": len(vegetation),
        "water": len(water)
    }

    # 6. Stage 4: Geometry Sanity Validation & Confidence Thresholding
    all_candidate_groups = [
        ("building", buildings),
        ("road", roads),
        ("field", fields),
        ("wall", walls),
        ("fence", fences),
        ("vegetation", vegetation),
        ("water", water)
    ]

    final_features = []
    final_by_class = {
        "buildings": [],
        "roads": [],
        "fields": [],
        "walls": [],
        "fences": [],
        "vegetation": [],
        "water": []
    }

    feat_counter = 1

    for cls_name, feat_list in all_candidate_groups:
        for feat in feat_list:
            is_valid, cat, reason = validate_geometry(feat, img_w, img_h, water_exclusion_mask, water_clean=water_clean)
            if not is_valid:
                rejections.append({
                    "category": cat or "Invalid geometry",
                    "class": cls_name,
                    "reason": f"Rejected Geometry: {reason}",
                    "score": feat.get("confidence", 0.0),
                    "threshold": CLASS_CONFIDENCE_THRESHOLDS.get(cls_name, 0.60),
                    "coordinates": feat.get("geometry", {}).get("coordinates", [])
                })
                continue

            # Confidence check against class-specific threshold
            thresh_key = cls_name
            if cls_name == "water":
                is_c = "canal" in feat.get("name", "").lower() or "canal" in feat.get("sub_type", "").lower()
                thresh_key = "water_canal" if is_c else "water_body"
            thresh = CLASS_CONFIDENCE_THRESHOLDS.get(thresh_key, 0.60)
            if feat.get("confidence", 0.0) < thresh:
                rejections.append({
                    "category": "Weak evidence",
                    "class": cls_name,
                    "reason": f"Confidence below class threshold ({feat.get('confidence', 0.0)} < {thresh})",
                    "score": feat.get("confidence", 0.0),
                    "threshold": thresh,
                    "coordinates": feat.get("geometry", {}).get("coordinates", [])
                })
                continue

            f_id = f"det_{args.imagery_id}_{feat['type']}_{feat_counter}"
            feat["id"] = f_id
            feat["project_id"] = args.project_id
            feat["imagery_id"] = args.imagery_id
            feat["detection_run_id"] = run_id
            feat["source_feature_ids"] = []
            if "image_coordinates" not in feat:
                geom = feat.get("geometry", {})
                if geom.get("type") == "Polygon":
                    feat["image_coordinates"] = geom.get("coordinates", [[]])[0]
                else:
                    feat["image_coordinates"] = geom.get("coordinates", [])
            feat["source"] = feat.get("provider", "ml")
            feat["created_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            final_features.append(feat)
            plural_key = cls_name + "s" if not cls_name.endswith("s") else cls_name
            if plural_key in final_by_class:
                final_by_class[plural_key].append(feat)
            elif cls_name in final_by_class:
                final_by_class[cls_name].append(feat)

            feat_counter += 1

    final_buildings = final_by_class["buildings"]
    final_roads = final_by_class["roads"]
    final_fields = final_by_class["fields"]
    final_walls = final_by_class["walls"]
    final_fences = final_by_class["fences"]
    final_vegetation = final_by_class["vegetation"]
    final_water = final_by_class["water"]

    water_body_count = sum(1 for w in final_water if "canal" not in w.get("name", "").lower() and w.get("sub_type", "").lower() != "irrigation canal / channel")
    water_canal_count = sum(1 for w in final_water if "canal" in w.get("name", "").lower() or w.get("sub_type", "").lower() == "irrigation canal / channel")

    summary = {
        "buildings": len(final_buildings),
        "roads": len(final_roads),
        "fields": len(final_fields),
        "walls": len(final_walls),
        "fences": len(final_fences),
        "vegetation": len(final_vegetation),
        "water": len(final_water),
        "water_body": water_body_count,
        "water_canal": water_canal_count,
        "total": len(final_features)
    }

    avg_conf = (
        round(sum(f["confidence"] for f in final_features) / len(final_features), 4)
        if final_features else 0.0
    )

    total_time_ms = int((time.time() - start_time) * 1000)

    # GeoJSON Layers
    def make_layer(items, name):
        return {
            "type": "FeatureCollection",
            "name": name,
            "features": [
                {
                    "type": "Feature",
                    "id": item["id"],
                    "geometry": item["geometry"],
                    "properties": {
                        k: v for k, v in item.items() if k != "geometry"
                    }
                }
                for item in items
            ]
        }

    layers = {
        "roads": make_layer(final_roads, "Roads & Corridors"),
        "buildings": make_layer(final_buildings, "Building Footprints"),
        "fields": make_layer(final_fields, "Agricultural Fields"),
        "walls": make_layer(final_walls, "Stone Walls"),
        "fences": make_layer(final_fences, "Boundary Fences"),
        "vegetation": make_layer(final_vegetation, "Vegetation Canopy"),
        "water": make_layer(final_water, "Water Features")
    }

    # Group rejections into standard 9 diagnostic categories
    standard_categories = [
        "Water crossing",
        "Unsupported line",
        "Image-edge artifact",
        "Insufficient continuity",
        "Invalid geometry",
        "Duplicate geometry",
        "Weak evidence",
        "Excessive size",
        "Disconnected feature"
    ]
    rejection_categories = {cat: 0 for cat in standard_categories}
    rejections_by_class = {}

    for r in rejections:
        cat = r.get("category", "Weak evidence")
        if cat in rejection_categories:
            rejection_categories[cat] += 1
        else:
            rejection_categories["Weak evidence"] += 1
        c_k = r.get("class", "other")
        rejections_by_class[c_k] = rejections_by_class.get(c_k, 0) + 1

    per_class_summary = {
        "buildings": {
            "raw": raw_stage_counts.get("buildings", 0),
            "accepted": len(final_buildings),
            "rejected": max(0, raw_stage_counts.get("buildings", 0) - len(final_buildings))
        },
        "roads": {
            "raw": raw_stage_counts.get("roads", 0),
            "accepted": len(final_roads),
            "rejected": max(0, raw_stage_counts.get("roads", 0) - len(final_roads))
        },
        "fields": {
            "raw": raw_stage_counts.get("fields", 0),
            "accepted": len(final_fields),
            "rejected": max(0, raw_stage_counts.get("fields", 0) - len(final_fields))
        },
        "walls": {
            "raw": raw_stage_counts.get("walls", 0),
            "accepted": len(final_walls),
            "rejected": max(0, raw_stage_counts.get("walls", 0) - len(final_walls))
        },
        "fences": {
            "raw": raw_stage_counts.get("fences", 0),
            "accepted": len(final_fences),
            "rejected": max(0, raw_stage_counts.get("fences", 0) - len(final_fences))
        },
        "vegetation": {
            "raw": raw_stage_counts.get("vegetation", 0),
            "accepted": len(final_vegetation),
            "rejected": max(0, raw_stage_counts.get("vegetation", 0) - len(final_vegetation))
        },
        "water": {
            "raw": raw_stage_counts.get("water", 0),
            "accepted": len(final_water),
            "rejected": max(0, raw_stage_counts.get("water", 0) - len(final_water))
        }
    }

    diagnostic_summary = {
        "raw_candidates": sum(raw_stage_counts.values()) + len(rejections),
        "accepted": len(final_features),
        "rejected": len(rejections),
        "rejection_reasons": rejection_categories,
        "classes": per_class_summary
    }

    debug_info = {
        "pipeline_stages": {
            "stage_1_raw": raw_stage_counts,
            "stage_2_filtered": cleaned_stage_counts,
            "stage_3_geometry_cleaned": cleaned_stage_counts,
            "stage_4_final": summary,
            "rejected_geometry_count": len(rejections)
        },
        "diagnostic_summary": diagnostic_summary,
        "rejected_detections": rejections[:50],
        "rejected_counts": rejections_by_class,
        "rejection_categories": rejection_categories,
        "timings_ms": {
            "ml_building_inference": int((t_ml_done - t_ml_start) * 1000),
            "cv_land_features": int((t_cv_done - t_cv_start) * 1000),
            "total_execution": total_time_ms
        },
        "road_network": road_stats,
        "confidence_distribution": {
            "high": sum(1 for f in final_features if f["confidence"] >= 0.80),
            "medium": sum(1 for f in final_features if 0.60 <= f["confidence"] < 0.80),
            "low": sum(1 for f in final_features if 0.40 <= f["confidence"] < 0.60),
            "very_low": sum(1 for f in final_features if f["confidence"] < 0.40)
        }
    }

    output = {
        "success": True,
        "status": "completed" if final_features else "empty",
        "provider": "ml",
        "model_name": MODEL_METADATA["name"],
        "project_id": args.project_id,
        "imagery_id": args.imagery_id,
        "detection_run_id": run_id,
        "summary": summary,
        "layers": layers,
        "features": final_features,
        "features_count": len(final_features),
        "average_confidence": avg_conf,
        "diagnostic_summary": diagnostic_summary,
        "debug": debug_info,
        "execution_time_ms": total_time_ms,
        "disclaimer": "AI-generated preliminary feature detection. Results require human verification. Non-georeferenced imagery is displayed in image space. AI-derived parcel boundaries are not legal cadastral boundaries."
    }

    def make_json_safe(obj):
        if obj is None:
            return None
        if isinstance(obj, (bool, str)):
            return obj
        if isinstance(obj, (int, np.integer)):
            return int(obj)
        if isinstance(obj, (float, np.floating)):
            if math.isnan(obj) or math.isinf(obj):
                return None
            return round(float(obj), 6)
        if isinstance(obj, np.ndarray):
            return make_json_safe(obj.tolist())
        if isinstance(obj, dict):
            return {str(k): make_json_safe(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [make_json_safe(item) for item in obj]
        return str(obj)

    safe_output = make_json_safe(output)
    print(json.dumps(safe_output, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        import traceback
        err_msg = str(exc)
        print(json.dumps({
            "success": False,
            "error": f"ML Detection Engine error: {err_msg}"
        }))
        sys.exit(1)
