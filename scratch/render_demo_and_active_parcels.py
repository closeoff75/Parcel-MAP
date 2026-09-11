import json
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Load database
db_path = os.path.join(os.getcwd(), 'data', 'parcelmap_db.json')
with open(db_path, 'r', encoding='utf-8') as f:
    db = json.load(f)

projects_to_render = [
    {
        'id': 'proj_demo_coastal',
        'imagery_id': 'img_demo_coastal',
        'title': 'Demo Dataset: Coastal Settlement & Agricultural Holdings (proj_demo_coastal)',
        'out_filename': 'demo_coastal_preliminary_parcels.png'
    },
    {
        'id': 'proj_1789117650907',
        'imagery_id': 'img_1789118184412_8b81',
        'title': 'High-Res UAV Survey: Rural Holdings (proj_1789117650907)',
        'out_filename': 'uav_survey_preliminary_parcels.png'
    }
]

artifact_dir = r"C:\Users\princ\.gemini\antigravity-ide\brain\4b971667-7412-41e9-9bd8-3bd92fb72e0c"

for prj_cfg in projects_to_render:
    project_id = prj_cfg['id']
    imagery_id = prj_cfg['imagery_id']
    
    project = next((p for p in db.get('projects', []) if p['id'] == project_id), None)
    imagery = next((img for img in db.get('imagery', []) if img['id'] == imagery_id), None)
    all_feats = db.get('detectedFeatures', []) or db.get('features', [])
    features = [f for f in all_feats if f.get('project_id') == project_id and (not imagery_id or f.get('imagery_id') == imagery_id)]
    parcels = [p for p in db.get('parcels', []) if p.get('project_id') == project_id and (not imagery_id or p.get('imagery_id') == imagery_id)]
    
    print(f"\nRendering {project_id}: {len(features)} features, {len(parcels)} parcels")
    
    # Locate base image
    img_rel = imagery.get('file_url', '').lstrip('/') if imagery else ''
    candidates = [
        os.path.join(os.getcwd(), img_rel),
        os.path.join(os.getcwd(), 'public', img_rel),
        os.path.join(os.getcwd(), 'uploads', os.path.basename(img_rel)),
        os.path.join(os.getcwd(), 'public', 'uploads', os.path.basename(img_rel)),
        os.path.join(os.getcwd(), 'test_assets', os.path.basename(img_rel))
    ]
    img_path = next((p for p in candidates if os.path.exists(p)), None)
    if not img_path:
        print(f"Warning: Image not found for {project_id}, creating blank canvas ({imagery.get('width', 800)}x{imagery.get('height', 600)})")
        w = imagery.get('width', 800) if imagery else 800
        h = imagery.get('height', 600) if imagery else 600
        base_img = Image.new('RGBA', (w, h), (30, 41, 59, 255))
    else:
        print(f"Loaded image from: {img_path}")
        base_img = Image.open(img_path).convert('RGBA')
        
    w, h = base_img.size
    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Draw Water Bodies (Translucent Blue)
    for feat in features:
        if feat.get('detection_type') == 'WATER' or feat.get('feature_type') == 'Water':
            coords = feat.get('image_coordinates', [])
            if coords and isinstance(coords[0], list) and len(coords[0]) >= 3:
                pts = [(int(p[0]), int(p[1])) for p in coords[0]]
                draw.polygon(pts, fill=(14, 116, 144, 110), outline=(6, 182, 212, 230))
            elif coords and len(coords) >= 3 and isinstance(coords[0], (int, float)):
                pts = [(int(p[0]), int(p[1])) for p in coords]
                draw.polygon(pts, fill=(14, 116, 144, 110), outline=(6, 182, 212, 230))

    # Draw Roads (Bold Amber/Orange lines)
    for feat in features:
        if feat.get('detection_type') == 'ROAD' or feat.get('feature_type') == 'Road':
            coords = feat.get('image_coordinates', [])
            if len(coords) >= 2:
                pts = [(int(p[0]), int(p[1])) for p in coords]
                draw.line(pts, fill=(245, 158, 11, 230), width=5)

    # Draw Walls / Fences (Cyan lines)
    for feat in features:
        if feat.get('detection_type') in ['WALL', 'FENCE', 'BOUNDARY']:
            coords = feat.get('image_coordinates', [])
            if len(coords) >= 2:
                pts = [(int(p[0]), int(p[1])) for p in coords]
                draw.line(pts, fill=(6, 182, 212, 200), width=2)

    # Draw Building Footprints (Navy/Blue translucent with white outline)
    for feat in features:
        if feat.get('detection_type') == 'BUILDING':
            coords = feat.get('image_coordinates', [])
            if coords and isinstance(coords[0], list) and len(coords[0]) >= 3:
                pts = [(int(p[0]), int(p[1])) for p in coords[0]]
                draw.polygon(pts, fill=(59, 130, 246, 100), outline=(147, 197, 253, 240))

    # Draw Preliminary Parcels (Purple #a855f7 with confidence-coded styling)
    for p in parcels:
        coords = p.get('image_coordinates', [])
        if not coords or not isinstance(coords, list):
            continue
        ring = coords[0] if (coords and isinstance(coords[0], list) and isinstance(coords[0][0], list)) else coords
        if ring and len(ring) >= 3:
            pts = [(int(pt[0]), int(pt[1])) for pt in ring]
            status = p.get('candidate_status', p.get('status', 'REVIEW'))
            conf = p.get('confidence', 0.85)
            is_acc = (status == 'ACCEPTED' or status == 'accepted')
            
            # Purple theme matching GIS Quality workspace
            fill_col = (168, 85, 247, 50) if is_acc else (168, 85, 247, 30)
            stroke_col = (168, 85, 247, 255) if is_acc else (192, 132, 252, 230)
            
            draw.polygon(pts, fill=fill_col, outline=stroke_col)
            # Thicker border
            for i in range(len(pts)):
                p1 = pts[i]
                p2 = pts[(i+1) % len(pts)]
                draw.line([p1, p2], fill=stroke_col, width=3)
            
            # Centroid label
            cx = sum(pt[0] for pt in pts) // len(pts)
            cy = sum(pt[1] for pt in pts) // len(pts)
            
            ea = p.get('edge_analysis', {})
            road_pct = ea.get('road_supported_pct', p.get('road_supported_pct', 0))
            bound_pct = ea.get('wall_fence_supported_pct', 0) + ea.get('field_supported_pct', 0)
            if bound_pct == 0 and p.get('wall_fence_supported_pct'):
                bound_pct = p.get('wall_fence_supported_pct', 0) + p.get('field_supported_pct', 0)
            
            lbl_line1 = f"{p.get('id', p.get('parcel_id'))} [{status}] ({int(conf*100)}%)"
            supp_pct = p.get('supported_perimeter_pct', p.get('supported_edge_pct', 0))
            lbl_line2 = f"Supp: {supp_pct}% (Road: {road_pct}% | Bound: {bound_pct}%)"
            
            bbox1 = draw.textbbox((cx - 80, cy - 10), lbl_line1)
            bbox2 = draw.textbbox((cx - 80, cy + 6), lbl_line2)
            box_left = min(bbox1[0], bbox2[0]) - 6
            box_top = bbox1[1] - 4
            box_right = max(bbox1[2], bbox2[2]) + 6
            box_bottom = bbox2[3] + 4
            
            draw.rectangle([box_left, box_top, box_right, box_bottom], fill=(15, 23, 42, 230), outline=stroke_col)
            draw.text((cx - 75, cy - 10), lbl_line1, fill=(255, 255, 255, 255))
            draw.text((cx - 75, cy + 6), lbl_line2, fill=(226, 232, 240, 255))

    # Header title bar
    title_bar = Image.new('RGBA', (w, 40), (15, 23, 42, 240))
    t_draw = ImageDraw.Draw(title_bar)
    t_draw.text((12, 10), f"PARCELMAP GIS QUALITY: {prj_cfg['title']}", fill=(248, 250, 252, 255))
    overlay.paste(title_bar, (0, 0))

    composite = Image.alpha_composite(base_img, overlay).convert('RGB')
    out_file = os.path.join(artifact_dir, prj_cfg['out_filename'])
    composite.save(out_file, format="PNG")
    print(f"Saved: {out_file}")

# Also update primary preliminary_parcels_visual_inspection.png with demo coastal
demo_out = os.path.join(artifact_dir, "demo_coastal_preliminary_parcels.png")
main_out = os.path.join(artifact_dir, "preliminary_parcels_visual_inspection.png")
if os.path.exists(demo_out):
    img = Image.open(demo_out)
    img.save(main_out)
    print(f"Updated main visual inspection artifact: {main_out}")
