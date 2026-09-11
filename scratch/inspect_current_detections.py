import json

with open('data/parcelmap_db.json', 'r', encoding='utf-8') as f:
    db = json.load(f)

feats = [f for f in db.get('detectedFeatures', []) if f.get('imagery_id') == 'img_1789118184412_8b81']
print(f'Active image features: {len(feats)}')
for f in feats:
    fid = f.get('id')
    t = f.get('detection_type')
    g = f.get('geometry', {})
    gt = g.get('type')
    c = g.get('coordinates', [])
    conf = f.get('confidence')
    prov = (f.get('properties') or {}).get('provider') or f.get('provider')
    name = f.get('name')
    if gt == 'LineString':
        length = sum(((c[i+1][0]-c[i][0])**2 + (c[i+1][1]-c[i][1])**2)**0.5 for i in range(len(c)-1))
        print(f'{fid}: {t} {name} | LineString {len(c)} pts | len={length:.1f}px | conf={conf} | prov={prov}')
    elif gt == 'Polygon':
        ring = c[0] if c else []
        area = 0.5 * abs(sum(ring[i][0]*ring[i+1][1] - ring[i+1][0]*ring[i][1] for i in range(len(ring)-1))) if len(ring) >= 3 else 0
        print(f'{fid}: {t} {name} | Polygon {len(ring)} pts | area={area:.0f}px | conf={conf} | prov={prov}')
