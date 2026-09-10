import cv2
import numpy as np
import math

for path in ['test_assets/image_a_rural.png', 'test_assets/image_d_agricultural.png', 'test_assets/image_c_coastal.png', 'test_assets/image_b_urban.png']:
    img = cv2.imread(path)
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 70, 180)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=45, minLineLength=35, maxLineGap=8)
    
    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad_mag = cv2.magnitude(grad_x, grad_y)

    walls, fences = [], []
    if lines is not None:
        kept = []
        for s in lines.reshape(-1, 4).tolist():
            length = math.hypot(s[2] - s[0], s[3] - s[1])
            if length < 35 or length > 180: continue
            
            # Check duplicate within 15px
            mx, my = (s[0] + s[2]) / 2.0, (s[1] + s[3]) / 2.0
            is_dup = False
            for k in kept:
                kmx, kmy = (k[0] + k[2]) / 2.0, (k[1] + k[3]) / 2.0
                if math.hypot(mx - kmx, my - kmy) < 15.0:
                    is_dup = True
                    break
            if is_dup: continue
            kept.append(s)

            patch = gray[max(0, int(my) - 3):min(h, int(my) + 4), max(0, int(mx) - 3):min(w, int(mx) + 4)]
            p_grad = grad_mag[max(0, int(my) - 3):min(h, int(my) + 4), max(0, int(mx) - 3):min(w, int(mx) + 4)]
            avg_grad = float(np.mean(p_grad)) if p_grad.size > 0 else 0.0
            std_dev = float(np.std(patch)) if patch.size > 0 else 0.0

            if avg_grad >= 80.0 and std_dev >= 20.0:
                walls.append(s)
            elif avg_grad >= 55.0 and avg_grad < 85.0:
                fences.append(s)

    print(f"{path}: Kept raw boundary candidates={len(kept)}, Walls={len(walls)}, Fences={len(fences)}")
