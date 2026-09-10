import cv2
import numpy as np

img = cv2.imread("test_assets/image_d_agricultural.png")
h, w = img.shape[:2]
total_area = float(w * h)

hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
b = img[:, :, 0].astype(np.float32)
g = img[:, :, 1].astype(np.float32)
r = img[:, :, 2].astype(np.float32)
exg = 2.0 * g - r - b

# True soil and crop
mask_soil = cv2.inRange(hsv, (10, 25, 35), (45, 230, 230))
is_crop = (hsv[:, :, 0] >= 25) & (hsv[:, :, 0] <= 88) & (hsv[:, :, 1] >= 30) & (exg > 8)
field_raw = (mask_soil | (is_crop.astype(np.uint8) * 255))

# Road surface to subtract
is_paved = (hsv[:, :, 1] < 65) & (hsv[:, :, 2] >= 70) & (hsv[:, :, 2] <= 245) & (abs(exg) < 18.0)
is_dirt = (hsv[:, :, 0] >= 14) & (hsv[:, :, 0] <= 42) & (hsv[:, :, 1] >= 35) & (hsv[:, :, 1] <= 170) & (hsv[:, :, 2] >= 65) & (hsv[:, :, 2] <= 215) & (exg < 10.0)
road_surface = (is_paved | is_dirt).astype(np.uint8) * 255

# Subtract road corridors (dilated to act as field separators)
road_dilated = cv2.dilate(road_surface, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)))
field_partitioned = field_raw.copy()
field_partitioned[road_dilated > 0] = 0

# Also subtract strong boundary lines / hedgerows
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
edges = cv2.Canny(gray, 50, 150)
edges_dilated = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
field_partitioned[edges_dilated > 0] = 0

# Morphological cleaning to separate into cohesive field parcels
field_clean = cv2.morphologyEx(field_partitioned, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)))
field_clean = cv2.morphologyEx(field_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11)))

cnts, _ = cv2.findContours(field_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
print(f"Total contours: {len(cnts)}")

accepted = []
for idx, c in enumerate(sorted(cnts, key=cv2.contourArea, reverse=True)):
    area = cv2.contourArea(c)
    if area < max(2000, total_area * 0.008):
        continue
    if area > total_area * 0.60:
        continue
    hull = cv2.convexHull(c)
    solidity = area / max(1.0, cv2.contourArea(hull))
    rect = cv2.minAreaRect(c)
    rw, rh = rect[1]
    aspect = max(rw, rh) / max(1.0, min(rw, rh))
    print(f"Field {idx+1}: area={area:.0f} ({area/total_area*100:.1f}%), solidity={solidity:.2f}, aspect={aspect:.1f}")
    if solidity >= 0.45 and aspect <= 4.0:
        accepted.append((area, solidity, aspect))

print(f"Accepted coherent fields on Agricultural Image: {len(accepted)}")
