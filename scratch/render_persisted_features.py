import json
import os
from PIL import Image, ImageDraw

db_path = os.path.join(os.getcwd(), 'data', 'parcelmap_db.json')
with open(db_path, 'r', encoding='utf-8') as f:
    db = json.load(f)

img_id = 'img_1789118184412_8b81'
feats = [f for f in db.get('detectedFeatures', []) if f.get('imagery_id') == img_id]
print(f"Rendering {len(feats)} features for {img_id}")

base_path = os.path.join(os.getcwd(), 'uploads', 'uav_1789118184315_w45wwf.png')
base = Image.open(base_path).convert('RGBA')
overlay = Image.new('RGBA', base.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)

# 1. Water (translucent blue)
for feat in feats:
    if feat.get('detection_type') == 'WATER':
        coords = feat.get('geometry', {}).get('coordinates', [[]])[0]
        if coords and len(coords) >= 3:
            pts = [(int(p[0]), int(p[1])) for p in coords]
            draw.polygon(pts, fill=(6, 182, 212, 100), outline=(6, 182, 212, 230))

# 2. Vegetation (green outline)
for feat in feats:
    if feat.get('detection_type') == 'VEGETATION':
        coords = feat.get('geometry', {}).get('coordinates', [[]])[0]
        if coords and len(coords) >= 3:
            pts = [(int(p[0]), int(p[1])) for p in coords]
            draw.polygon(pts, fill=(34, 197, 94, 25), outline=(34, 197, 94, 120))

# 3. Fields (lime green outline)
for feat in feats:
    if feat.get('detection_type') == 'FIELD':
        coords = feat.get('geometry', {}).get('coordinates', [[]])[0]
        if coords and len(coords) >= 3:
            pts = [(int(p[0]), int(p[1])) for p in coords]
            draw.polygon(pts, fill=(132, 204, 22, 40), outline=(132, 204, 22, 255))
            for i in range(len(pts)):
                draw.line([pts[i], pts[(i+1)%len(pts)]], fill=(132, 204, 22, 255), width=2)

# 4. Buildings (cyan fill/outline)
for feat in feats:
    if feat.get('detection_type') == 'BUILDING':
        coords = feat.get('geometry', {}).get('coordinates', [[]])[0]
        if coords and len(coords) >= 3:
            pts = [(int(p[0]), int(p[1])) for p in coords]
            draw.polygon(pts, fill=(6, 182, 212, 90), outline=(6, 182, 212, 240))
            for i in range(len(pts)):
                draw.line([pts[i], pts[(i+1)%len(pts)]], fill=(6, 182, 212, 240), width=2)

# 5. Roads (amber / orange)
for feat in feats:
    if feat.get('detection_type') == 'ROAD':
        coords = feat.get('geometry', {}).get('coordinates', [])
        if coords and len(coords) >= 2:
            pts = [(int(p[0]), int(p[1])) for p in coords]
            draw.line(pts, fill=(245, 158, 11, 230), width=4)

# 6. Walls (slate white)
for feat in feats:
    if feat.get('detection_type') == 'WALL':
        coords = feat.get('geometry', {}).get('coordinates', [])
        if coords and len(coords) >= 2:
            pts = [(int(p[0]), int(p[1])) for p in coords]
            draw.line(pts, fill=(203, 213, 225, 255), width=3)

# 7. Fences (magenta)
for feat in feats:
    if feat.get('detection_type') == 'FENCE':
        coords = feat.get('geometry', {}).get('coordinates', [])
        if coords and len(coords) >= 2:
            pts = [(int(p[0]), int(p[1])) for p in coords]
            draw.line(pts, fill=(236, 72, 153, 255), width=2)

out = Image.alpha_composite(base, overlay).convert('RGB')
out_path = r'C:\Users\princ\.gemini\antigravity-ide\brain\4b971667-7412-41e9-9bd8-3bd92fb72e0c\cleaned_ai_features_final.png'
out.save(out_path)
print(f"Saved: {out_path}")
