#!/usr/bin/env python3
"""
Migration script to update Canteen A menu with food images.
This replaces the generic menu items with the 7 specific food items.
"""

import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set in .env")
    exit(1)

# Connect to database
conn = psycopg2.connect(DATABASE_URL)
conn.autocommit = False
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

try:
    print("=" * 70)
    print("UPDATING CANTEEN A MENU WITH FOOD IMAGES")
    print("=" * 70)
    
    # Get Canteen A ID
    print("\n1. Finding Canteen A...")
    cur.execute("SELECT id FROM canteens WHERE name = %s", ("Canteen A",))
    row = cur.fetchone()
    if not row:
        print("   ERROR: Canteen A not found!")
        exit(1)
    
    canteen_id = row["id"]
    print(f"   ✓ Found Canteen A (ID: {canteen_id})")
    
    # Map of old item names to new items (to preserve IDs and order history)
    # Only items that exist in current menu will be updated
    items_to_update = {
        "Meals": ("Chicken Biryani", "Long-grain basmati rice with tender chicken pieces, aromatic spices, and traditional garnish", 120.00, "Meals", "images/food/chicken-biryani.jpg"),
        "Fried Rice": ("Chicken Rice", "Flavorful chicken fried rice with tender chicken pieces, fresh vegetables, and perfect seasoning", 120.00, "Rice & Noodles", "images/food/chicken-rice.jpg"),
        "Sandwich": ("Veg Rice", "Aromatic vegetable fried rice with fresh carrots, peas, beans, and authentic spices", 100.00, "Rice & Noodles", "images/food/veg-rice.jpg"),
        "Burger": ("Chapathi (2 pieces)", "Two soft Indian chapatis served fresh, perfect with any curry or gravy", 50.00, "Meals", "images/food/chapathi.jpg"),
        "Tea": ("Mutton Biryani", "Premium basmati rice cooked with slow-cooked mutton, fragrant spices, and authentic flavor", 140.00, "Meals", "images/food/mutton-biryani.jpg"),
        "Juice": ("Porotta (2 pieces)", "Two flaky, layered Kerala-style porottas, crispy and delicious", 50.00, "Meals", "images/food/porotta.jpg"),
        "Chapati": ("Full Grill", "Complete grilled chicken, perfectly roasted with spices, restaurant-style presentation", 400.00, "Meals", "images/food/full-grill.jpg"),
    }
    
    new_items_only = [
        # Items that don't map to old ones (won't be added if we're mapping)
    ]
    
    print("\n2. Updating existing menu items with new food and images...")
    
    # Get current items
    cur.execute(
        "SELECT id, name FROM menu_items WHERE canteen_id = %s ORDER BY name",
        (canteen_id,)
    )
    current_items = {row["name"]: row["id"] for row in cur.fetchall()}
    
    updated_count = 0
    for old_name, (new_name, description, price, category, image_url) in items_to_update.items():
        if old_name in current_items:
            item_id = current_items[old_name]
            cur.execute(
                "UPDATE menu_items SET name = %s, description = %s, price = %s, image_url = %s, category = %s WHERE id = %s",
                (new_name, description, price, image_url, category, item_id)
            )
            updated_count += 1
            print(f"   ✓ {old_name} → {new_name} (ID: {item_id})")
    
    conn.commit()
    print(f"\n✓ Successfully updated {updated_count} items!")
    
    # Verify
    print("\n4. Verifying menu...")
    cur.execute(
        "SELECT id, name, price, image_url FROM menu_items WHERE canteen_id = %s ORDER BY id",
        (canteen_id,)
    )
    items = cur.fetchall()
    print(f"   ✓ Canteen A now has {len(items)} menu items:")
    for item in items:
        print(f"      - {item['name']}: ₹{item['price']} ({item['image_url']})")
    
    print("\n" + "=" * 70)
    print("✓ MIGRATION COMPLETE!")
    print("=" * 70)
    
except Exception as e:
    conn.rollback()
    print(f"\n✗ ERROR: {e}")
    import traceback
    traceback.print_exc()
    exit(1)
finally:
    cur.close()
    conn.close()
