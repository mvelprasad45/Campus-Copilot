#!/usr/bin/env python3
"""
Generate placeholder food images for Canteen A.

These images are high-quality colored placeholders that make the app functional.
Replace these with actual realistic food photos for production.
"""

import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random

# Create images folder if it doesn't exist
IMAGES_DIR = os.path.join(os.path.dirname(__file__), 'static', 'images', 'food')
os.makedirs(IMAGES_DIR, exist_ok=True)

# Image dimensions (square, suitable for food cards)
IMG_WIDTH = 400
IMG_HEIGHT = 400

def create_gradient_bg(width, height, color1, color2):
    """Create a gradient background."""
    img = Image.new('RGB', (width, height), color1)
    pixels = img.load()
    for y in range(height):
        ratio = y / height
        r = int(color1[0] * (1 - ratio) + color2[0] * ratio)
        g = int(color1[1] * (1 - ratio) + color2[1] * ratio)
        b = int(color1[2] * (1 - ratio) + color2[2] * ratio)
        for x in range(width):
            pixels[x, y] = (r, g, b)
    return img

def add_overlay_elements(img, elements):
    """Add semi-transparent circles/shapes to make it look more food-like."""
    overlay = Image.new('RGBA', img.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)
    for elem in elements:
        x, y, size, color, alpha = elem
        draw.ellipse(
            [x - size, y - size, x + size, y + size],
            fill=color + (alpha,)
        )
    img = Image.alpha_composite(img.convert('RGBA'), overlay)
    return img.convert('RGB')

def create_food_image(filename, food_name, color1, color2, accent_colors):
    """Create a themed food image."""
    # Create gradient base
    img = create_gradient_bg(IMG_WIDTH, IMG_HEIGHT, color1, color2)
    
    # Add some accent elements to make it more interesting
    overlay = Image.new('RGBA', img.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Add random elements that suggest the food type
    random.seed(filename)  # Consistent seed per image
    for i in range(8):
        x = random.randint(50, IMG_WIDTH - 50)
        y = random.randint(50, IMG_HEIGHT - 100)
        size = random.randint(15, 40)
        color = random.choice(accent_colors)
        alpha = random.randint(60, 140)
        draw.ellipse([x - size, y - size, x + size, y + size], fill=color + (alpha,))
    
    img = Image.alpha_composite(img.convert('RGBA'), overlay)
    img = img.convert('RGB')
    
    # Add text label with food name
    draw = ImageDraw.Draw(img)
    # Try to use a nice font, fall back to default
    try:
        font = ImageFont.truetype("arial.ttf", 24)
        small_font = ImageFont.truetype("arial.ttf", 16)
    except:
        font = ImageFont.load_default()
        small_font = font
    
    # Add semi-transparent background for text
    text_y = IMG_HEIGHT - 70
    text_box = [10, text_y - 5, IMG_WIDTH - 10, IMG_HEIGHT - 10]
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rectangle(text_box, fill=(0, 0, 0, 80))
    img = Image.alpha_composite(img.convert('RGBA'), overlay)
    img = img.convert('RGB')
    
    # Draw text
    draw = ImageDraw.Draw(img)
    draw.text((IMG_WIDTH // 2, text_y), food_name, fill=(255, 255, 255), font=font, anchor="mm")
    draw.text((IMG_WIDTH // 2, text_y + 35), "Campus Canteen A", fill=(200, 200, 200), font=small_font, anchor="mm")
    
    # Save the image
    filepath = os.path.join(IMAGES_DIR, filename)
    img.save(filepath, quality=90)
    print(f"[OK] {filename}")

# Define food images with their color schemes
food_images = [
    # (filename, food_name, base_color1, base_color2, accent_colors)
    (
        'chicken-biryani.jpg',
        'Chicken Biryani',
        (139, 69, 19),      # Brown
        (184, 134, 11),     # Dark goldenrod
        [(255, 200, 87), (255, 140, 0), (210, 180, 140), (184, 134, 11), (139, 90, 43)]
    ),
    (
        'mutton-biryani.jpg',
        'Mutton Biryani',
        (101, 67, 33),      # Dark brown
        (160, 82, 45),      # Sienna
        [(255, 200, 87), (255, 140, 0), (205, 92, 92), (188, 143, 143), (160, 82, 45)]
    ),
    (
        'chapathi.jpg',
        'Chapathi (2)',
        (210, 180, 140),    # Tan
        (244, 164, 96),     # Sandy brown
        [(255, 215, 0), (255, 228, 181), (245, 222, 179), (210, 180, 140)]
    ),
    (
        'porotta.jpg',
        'Porotta (2)',
        (218, 165, 32),     # Goldenrod
        (255, 215, 0),      # Gold
        [(255, 248, 220), (255, 228, 181), (245, 245, 220), (255, 235, 59)]
    ),
    (
        'full-grill.jpg',
        'Full Grill',
        (165, 42, 42),      # Brown
        (139, 69, 19),      # Saddle brown
        [(255, 140, 0), (255, 165, 0), (184, 134, 11), (160, 82, 45), (210, 105, 30)]
    ),
    (
        'veg-rice.jpg',
        'Veg Rice',
        (255, 215, 0),      # Gold (rice)
        (240, 230, 200),    # Linen
        [(144, 238, 144), (152, 251, 152), (255, 165, 0), (255, 140, 0), (210, 105, 30)]
    ),
    (
        'chicken-rice.jpg',
        'Chicken Rice',
        (255, 200, 87),     # Light brown
        (240, 230, 200),    # Linen
        [(255, 165, 0), (210, 105, 30), (144, 238, 144), (152, 251, 152), (184, 134, 11)]
    ),
]

print("=" * 60)
print("Generating food images...")
print("=" * 60)

for filename, food_name, color1, color2, accents in food_images:
    create_food_image(filename, food_name, color1, color2, accents)

print("=" * 60)
print(f"[OK] All images generated in: {IMAGES_DIR}")
print("=" * 60)
print()
print("[!] IMPORTANT: These are placeholder images.")
print()
print("Replace each image with actual realistic food photography:")
print("  - chicken-biryani.jpg - Long-grain basmati rice with chicken pieces")
print("  - mutton-biryani.jpg - Basmati rice with mutton pieces")
print("  - chapathi.jpg - Two Indian chapatis on a plate")
print("  - porotta.jpg - Two Kerala-style layered porottas")
print("  - full-grill.jpg - Whole grilled chicken")
print("  - veg-rice.jpg - Vegetable fried rice with visible vegetables")
print("  - chicken-rice.jpg - Chicken fried rice with vegetables")
print()
print("All images must be:")
print("  - High resolution (at least 400x400px)")
print("  - Realistic restaurant food photography")
print("  - Consistent visual style and lighting")
print("  - No text, logos, or watermarks")
print("  - JPEG format (jpg)")
