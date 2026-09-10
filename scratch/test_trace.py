import cv2
import numpy as np
import math

def get_skeleton(mask):
    skel = np.zeros(mask.shape, np.uint8)
    element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    temp = mask.copy()
    while True:
        eroded = cv2.erode(temp, element)
        opened = cv2.morphologyEx(eroded, cv2.MORPH_OPEN, element)
        subset = cv2.subtract(eroded, opened)
        skel = cv2.bitwise_or(skel, subset)
        temp = eroded.copy()
        if cv2.countNonZero(temp) == 0:
            break
    return skel

def trace_skeleton_centerline(skel_mask):
    kernel = np.array([[1, 1, 1], [1, 10, 1], [1, 1, 1]], dtype=np.uint8)
    filtered = cv2.filter2D((skel_mask > 0).astype(np.uint8), -1, kernel)
    endpoints = np.argwhere(filtered == 11)
    
    skel_pts = np.argwhere(skel_mask > 0)
    if len(skel_pts) < 5:
        return []
    
    start = endpoints[0] if len(endpoints) > 0 else skel_pts[0]
        
    h, w = skel_mask.shape[:2]
    visited = set()
    queue = [(start[0], start[1])]
    visited.add((start[0], start[1]))
    furthest = (start[0], start[1])
    
    while queue:
        cy, cx = queue.pop(0)
        furthest = (cy, cx)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0: continue
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and skel_mask[ny, nx] > 0 and (ny, nx) not in visited:
                    visited.add((ny, nx))
                    queue.append((ny, nx))
                    
    visited = set()
    queue = [furthest]
    visited.add(furthest)
    parent = {}
    end_point = furthest
    while queue:
        cy, cx = queue.pop(0)
        end_point = (cy, cx)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0: continue
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and skel_mask[ny, nx] > 0 and (ny, nx) not in visited:
                    visited.add((ny, nx))
                    parent[(ny, nx)] = (cy, cx)
                    queue.append((ny, nx))
                    
    path = []
    curr = end_point
    while curr in parent:
        path.append([int(curr[1]), int(curr[0])]) # [x, y]
        curr = parent[curr]
    path.append([int(curr[1]), int(curr[0])])
    
    if len(path) < 3:
        return []
        
    pts_np = np.array(path, dtype=np.int32).reshape((-1, 1, 2))
    simplified = cv2.approxPolyDP(pts_np, 3.5, False).reshape(-1, 2).tolist()
    return simplified

img = cv2.imread("test_assets/image_c_coastal.png")
h, w = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
b = img[:, :, 0].astype(np.float32)
g = img[:, :, 1].astype(np.float32)
r = img[:, :, 2].astype(np.float32)
exg = 2.0 * g - r - b

is_paved = (hsv[:, :, 1] < 65) & (hsv[:, :, 2] >= 70) & (hsv[:, :, 2] <= 245) & (abs(exg) < 18.0)
is_dirt = (hsv[:, :, 0] >= 14) & (hsv[:, :, 0] <= 42) & (hsv[:, :, 1] >= 35) & (hsv[:, :, 1] <= 170) & (hsv[:, :, 2] >= 65) & (hsv[:, :, 2] <= 215) & (exg < 10.0)
road_surface = (is_paved | is_dirt).astype(np.uint8) * 255

is_water = (hsv[:, :, 0] >= 85) & (hsv[:, :, 0] <= 135) & (hsv[:, :, 1] >= 75) & (b > r * 1.6 + 15) & (r < 30)
water_mask = is_water.astype(np.uint8) * 255
water_clean = cv2.morphologyEx(water_mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
water_clean = cv2.morphologyEx(water_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))

road_surface[water_clean > 0] = 0

kernel_r = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
road_clean = cv2.morphologyEx(road_surface, cv2.MORPH_OPEN, kernel_r)
road_bridged = cv2.morphologyEx(road_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(road_bridged, connectivity=8)

for l in range(1, num_labels):
    area = stats[l, cv2.CC_STAT_AREA]
    bx, by, bw, bh = stats[l, :4]
    diag = math.hypot(bw, bh)
    approx_w = area / max(1.0, diag)
    elong = diag / max(1.0, approx_w)
    if area >= 400 and diag >= 60 and elong >= 2.0 and approx_w <= 60:
        mask = (labels == l).astype(np.uint8) * 255
        skel = get_skeleton(mask)
        line = trace_skeleton_centerline(skel)
        print(f"Road {l}: area={area}, points count = {len(line)}")
        if len(line) > 0:
            print(f"  First: {line[0]}, Last: {line[-1]}")
