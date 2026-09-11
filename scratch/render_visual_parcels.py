import json
import os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Load database to extract current parcels and features for active project
db_path = os.path.join(os.getcwd(), 'data', 'parcelmap_db.json')
with open(db_path, 'r', encoding='utf-8') as f:
    db = json.load(f)

project_id = 'proj_1789117650907'
imagery_id = 'img_1789118184412_8b81'

project = next((p for p in db.get('projects', []) if p['id'] == project_id), None)
imagery = next((img for img in db.get('imagery', []) if img['id'] == imagery_id), None)
all_feats = db.get('detectedFeatures', []) or db.get('features', [])
features = [f for f in all_feats if f.get('project_id') == project_id or f.get('imagery_id') == imagery_id]
parcels = [p for p in db.get('parcels', []) if p.get('project_id') == project_id or p.get('imagery_id') == imagery_id]

print(f"Project: {project_id}, Features: {len(features)}, Parcels: {len(parcels)}")

# Base image
img_rel = imagery.get('file_url', '').lstrip('/')
img_path = os.path.join(os.getcwd(), img_rel)
if not os.path.exists(img_path):
    # Try alternate location in test_assets
    img_path = os.path.join(os.getcwd(), 'test_assets', 'image_a_rural.png')

print(f"Loading image from: {img_path}")
base_img = Image.open(img_path).convert('RGBA')
overlay = Image.new('RGBA', base_img.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)

# Draw Roads (Orange line)
for feat in features:
    if feat.get('detection_type') == 'ROAD' or feat.get('feature_type') == 'Road':
        coords = feat.get('image_coordinates', [])
        if len(coords) >= 2:
            pts = [(int(p[0]), int(p[1])) for p in coords]
            draw.line(pts, fill=(245, 158, 11, 200), width=4)

# Draw Walls / Fences (Cyan / White dashed)
for feat in features:
    if feat.get('detection_type') in ['WALL', 'FENCE', 'BOUNDARY']:
        coords = feat.get('image_coordinates', [])
        if len(coords) >= 2:
            pts = [(int(p[0]), int(p[1])) for p in coords]
            draw.line(pts, fill=(6, 182, 212, 180), width=2)

# Draw Buildings (Cyan translucent)
for feat in features:
    if feat.get('detection_type') == 'BUILDING':
        coords = feat.get('image_coordinates', [])
        if coords and isinstance(coords[0], list) and len(coords[0]) >= 3:
            pts = [(int(p[0]), int(p[1])) for p in coords[0]]
            draw.polygon(pts, fill=(8, 145, 178, 90), outline=(6, 182, 212, 220))

# Draw Preliminary Parcels
for p in parcels:
    coords = p.get('image_coordinates', [])
    if coords and isinstance(coords[0], list) and len(coords[0]) >= 3:
        pts = [(int(pt[0]), int(pt[1])) for pt in coords[0]]
        status = p.get('candidate_status', 'REVIEW')
        is_acc = (status == 'ACCEPTED')
        
        # Color: Emerald green for Accepted, Amber for Review
        fill_col = (16, 185, 129, 65) if is_acc else (245, 158, 11, 65)
        out_col = (16, 185, 129, 255) if is_acc else (245, 158, 11, 255)
        
        draw.polygon(pts, fill=fill_col, outline=out_col)
        
        # Draw centroid label
        cx = sum(pt[0] for pt in pts) // len(pts)
        cy = sum(pt[1] for pt in pts) // len(pts)
        
        lbl = f"{p['id']} [{status}] ({p.get('supported_edge_pct', 0)}% supp)"
        # Draw background pill
        bbox = draw.textbbox((cx, cy), lbl)
        draw.rectangle([bbox[0]-4, bbox[1]-2, bbox[2]+4, bbox[3]+2], fill=(15, 23, 42, 220), outline=out_col)
        draw.text((cx, cy), lbl, fill=(255, 255, 255, 255))

# Composite
composite = Image.alpha_composite(base_img, overlay).convert('RGB')

artifact_dir = r"C:\Users\princ\.gemini\antigravity-ide\brain\4b971667-7412-41e9-9bd8-3bd92fb72e0c"
out_path = os.path.join(artifact_dir, "preliminary_parcels_visual_inspection.png")
composite.save(out_path, format="PNG")
print(f"Visual parcel map saved to: {out_path}")
