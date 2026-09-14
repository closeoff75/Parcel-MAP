import sqlite3
import os
import shutil
import datetime

local_app_data = os.environ.get('LOCALAPPDATA', '')
paths = [
    os.path.join(local_app_data, 'Google', 'Chrome', 'User Data', 'Default', 'History'),
    os.path.join(local_app_data, 'Microsoft', 'Edge', 'User Data', 'Default', 'History')
]

for p in paths:
    if os.path.exists(p):
        temp_copy = p + '.tmp_read'
        try:
            shutil.copy2(p, temp_copy)
            conn = sqlite3.connect(temp_copy)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT url, title, visit_count, last_visit_time 
                FROM urls 
                WHERE url LIKE '%netlify.app%' 
                ORDER BY last_visit_time DESC 
                LIMIT 20
            """)
            print(f"=== History from {p} ===")
            for row in cursor.fetchall():
                url, title, count, last_visit = row
                # Chrome/Edge epoch is Jan 1, 1601 in microseconds
                try:
                    dt = datetime.datetime(1601, 1, 1) + datetime.timedelta(microseconds=last_visit)
                except Exception:
                    dt = "unknown"
                print(f"[{dt}] ({count} visits) {url} - {title}")
            conn.close()
            os.remove(temp_copy)
        except Exception as e:
            print(f"Error querying {p}: {e}")
