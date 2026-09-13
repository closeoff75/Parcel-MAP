import http from 'http';

http.get('http://localhost:3000/api/projects/proj_1789117650907/parcels?imagery_id=img_1789142537501_t33b', res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    const data = JSON.parse(body);
    console.log('Total Parcels:', data.count);
    data.parcels.forEach((p, idx) => {
      console.log(`Parcel #${idx+1}: ${p.parcel_id} [${p.candidate_status}] Area: ${p.area_px} Supp%: ${p.supported_perimeter_pct}%`);
      console.log(`  Reason: ${p.decision_reason}`);
      console.log(`  Coords: ${JSON.stringify(p.geometry?.coordinates)}`);
    });
  });
});
