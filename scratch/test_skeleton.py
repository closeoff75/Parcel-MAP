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

# Clean water mask (un-dilated true water)
is_water = (hsv[:, :, 0] >= 85) & (hsv[:, :, 0] <= 135) & (hsv[:, :, 1] >= 75) & (b > r * 1.6 + 15) & (r < 30)
water_mask = is_water.astype(np.uint8) * 255
water_clean = cv2.morphologyEx(water_mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
water_clean = cv2.morphologyEx(water_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))

# Remove water from road surface
road_surface[water_clean > 0] = 0

kernel_r = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
road_clean = cv2.morphologyEx(road_surface, cv2.MORPH_OPEN, kernel_r)
road_bridged = cv2.morphologyEx(road_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(road_bridged, connectivity=8)

print(f"Components found: {num_labels - 1}")
for l in range(1, num_labels):
    area = stats[l, cv2.CC_STAT_AREA]
    bx, by, bw, bh = stats[l, :4]
    diag = math.hypot(bw, bh)
    approx_w = area / max(1.0, diag)
    elong = diag / max(1.0, approx_w)
    if area >= 400 and diag >= 60 and elong >= 2.0 and approx_w <= 60:
        comp_mask = (labels == l).astype(np.uint8) * 255
        skel = get_skeleton(comp_mask)
        skel_pts = np.argwhere(skel > 0)
        print(f"Road Comp {l}: area={area}, diag={diag:.1f}, approx_w={approx_w:.1f}, elong={elong:.1f}, skeleton pixels={len(skel_pts)}")
