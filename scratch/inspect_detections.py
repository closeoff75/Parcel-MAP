import json

with open('data/parcelmap_db.json', 'r', encoding='utf-8') as f:
    db = json.load(f)

img_id = 'img_1789118184412_8b81'
feats = [f for f in db.get('detectedFeatures', []) if f.get('imagery_id') == img_id]
print(f'Total features for {img_id}: {len(feats)}')

by_type = {}
for f in feats:
    t = f.get('detection_type') or f.get('type') or 'unknown'
    by_type.setdefault(t, []).append(f)

for t, items in by_type.items():
    print(f'\n--- {t} ({len(items)}) ---')
    for i, it in enumerate(items[:10]):
        coords = it.get('image_coordinates') or it.get('geometry', {}).get('coordinates', [])
        conf = it.get('confidence')
        name = it.get('name')
        print(f'  [{i+1}] {name} (conf={conf}, pts={len(coords)})')
