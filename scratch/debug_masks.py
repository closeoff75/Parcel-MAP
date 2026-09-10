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

mask_soil = cv2.inRange(hsv, (10, 30, 40), (42, 220, 220))
is_crop = (hsv[:, :, 0] >= 25) & (hsv[:, :, 0] <= 88) & (hsv[:, :, 1] >= 35) & (exg > 10)
field_raw = (mask_soil | (is_crop.astype(np.uint8) * 255))

print(f"Total area: {total_area} px ({w}x{h})")
print(f"Raw field pixels: {np.count_nonzero(field_raw)} ({np.count_nonzero(field_raw)/total_area*100:.1f}%)")
print(f"Soil pixels: {np.count_nonzero(mask_soil)} ({np.count_nonzero(mask_soil)/total_area*100:.1f}%)")
print(f"Crop pixels: {np.count_nonzero(is_crop)} ({np.count_nonzero(is_crop)/total_area*100:.1f}%)")

# Check why water was detected on image_d_agricultural
is_water = (hsv[:, :, 0] >= 85) & (hsv[:, :, 0] <= 135) & (hsv[:, :, 1] >= 75) & (b > r + 20) & (b >= g - 10)
water_mask_raw = is_water.astype(np.uint8) * 255
kernel_w = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
water_clean = cv2.morphologyEx(water_mask_raw, cv2.MORPH_OPEN, kernel_w)
water_clean = cv2.morphologyEx(water_clean, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
cnts_w, _ = cv2.findContours(water_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
print(f"\nWater candidates on Agricultural image: {len(cnts_w)}")
for idx, c in enumerate(cnts_w):
    area = cv2.contourArea(c)
    rect = cv2.minAreaRect(c)
    rw, rh = rect[1]
    # Check texture standard deviation of this water candidate
    mask_c = np.zeros((h, w), dtype=np.uint8)
    cv2.drawContours(mask_c, [c], -1, 255, -1)
    pts_b = b[mask_c > 0]
    pts_g = g[mask_c > 0]
    pts_r = r[mask_c > 0]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    pts_gray = gray[mask_c > 0]
    std_val = np.std(pts_gray)
    print(f"  Water candidate {idx}: area={area} ({area/total_area*100:.2f}%), rect={rw:.1f}x{rh:.1f}, gray_std={std_val:.2f}, avg_B={np.mean(pts_b):.1f}, avg_R={np.mean(pts_r):.1f}, avg_G={np.mean(pts_g):.1f}")
