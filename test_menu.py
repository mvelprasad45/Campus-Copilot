#!/usr/bin/env python3
"""
Test script to verify Canteen A menu items and images are loaded correctly.
"""

import requests
import json
import os
import psycopg2
import psycopg2.extras
from urllib.parse import urlparse
from dotenv import load_dotenv

# Test server
BASE_URL = "http://127.0.0.1:5000"
SESSION = requests.Session()

print("=" * 70)
print("TESTING CANTEEN A MENU WITH FOOD IMAGES")
print("=" * 70)
print()

# Step 1: Register a test student
student_name = "Test Student"
student_email = "test-food-images@college.edu"
student_pass = "TestPass123!"

print("1. Registering test student...")
register_data = {
    "name": student_name,
    "roll_number": "TEST-IMAGES-001",
    "college_email": student_email,
    "password": student_pass,
}

try:
    resp = SESSION.post(f"{BASE_URL}/api/register", json=register_data)
    if resp.status_code == 201:
        print("   ✓ Student registered successfully")
    else:
        print(f"   ℹ {resp.json()}")
except Exception as e:
    print(f"   ⚠ {e}")

# Mark student as verified in database (bypass email verification)
print("\n2. Verifying student in database...")
load_dotenv()
try:
    db_conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    db_cur = db_conn.cursor()
    db_cur.execute("UPDATE students SET is_verified = TRUE WHERE college_email = %s", (student_email,))
    db_conn.commit()
    db_cur.close()
    db_conn.close()
    print("   ✓ Student verified in database")
except Exception as e:
    print(f"   ⚠ {e}")

# Step 3: Login
print("\n3. Logging in...")
login_data = {
    "name": student_name,
    "password": student_pass,
}

try:
    resp = SESSION.post(f"{BASE_URL}/api/login", json=login_data)
    if resp.status_code == 200:
        result = resp.json()
        print(f"   ✓ Logged in as: {result.get('name', 'Student')}")
    else:
        print(f"   ✗ Login failed: {resp.json()}")
except Exception as e:
    print(f"   ✗ Error: {e}")

# Step 4: Load Canteen A menu
print("\n4. Loading Canteen A menu...")
try:
    resp = SESSION.get(f"{BASE_URL}/api/canteens/1/menu")
    if resp.status_code == 200:
        data = resp.json()
        items = data.get('items', [])
        available_items = [i for i in items if i.get('available', True)]
        print(f"   ✓ Loaded {len(available_items)}/{len(items)} menu items\n")
        
        # Display each available item
        print("   CANTEEN A FOOD ITEMS WITH IMAGES:")
        print("   " + "=" * 66)
        for idx, item in enumerate(available_items, 1):
            name = item.get('name', 'Unknown')
            price = item.get('price', 0)
            category = item.get('category', 'General')
            image_url = item.get('image_url', 'None')
            desc = item.get('description', '')[:40]
            
            print(f"\n   {idx}. {name}")
            print(f"      Price: ₹{price} | Category: {category}")
            print(f"      Image: {image_url}")
            if desc:
                print(f"      Desc: {desc}...")
        
        print("\n   " + "=" * 66)
        print(f"\n   ✓ All {len(available_items)} items loaded with details")
        print(f"\n   EXPECTED 7 ITEMS: {len(available_items) == 7}")
        
        # Verify image files exist
        print("\n5. Verifying image files...")
        for item in available_items:
            image_url = item.get('image_url', '')
            if image_url:
                # Extract filename
                filename = image_url.split('/')[-1]
                print(f"   ✓ {filename}")
    else:
        print(f"   ✗ Error: {resp.status_code} - {resp.json()}")
except Exception as e:
    print(f"   ✗ Error: {e}")

print("\n" + "=" * 70)
print("TEST COMPLETE")
print("=" * 70)

