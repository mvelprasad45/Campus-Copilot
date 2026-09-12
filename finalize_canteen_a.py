#!/usr/bin/env python3
import psycopg2
import psycopg2.extras
import os
from dotenv import load_dotenv

load_dotenv()
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

# Mark Samosa as unavailable to preserve order history
cur.execute('UPDATE menu_items SET available = FALSE WHERE name = %s', ('Samosa',))
conn.commit()

# Verify
cur.execute('SELECT id, name, price, image_url, available FROM menu_items WHERE canteen_id = 1 ORDER BY id')
print('✓ Final Canteen A menu:')
for row in cur.fetchall():
    status = '✓' if row['available'] else '✗'
    image = '✓' if row['image_url'] else '✗'
    print(f'  {status} {image} [{row["id"]}] {row["name"]}: ₹{row["price"]}')

cur.close()
conn.close()
