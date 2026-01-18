import json
import csv
import re
import sys
import os

# Read the JSON file
print("Reading store_comparison_results.json...")
with open('store_comparison_results.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Get CSV filename from command line argument or try common names
if len(sys.argv) > 1:
    csv_file = sys.argv[1]
else:
    # Try common CSV filenames
    possible_files = ['stores.csv', 'coordinates.csv', 'store_coordinates.csv', 'data.csv']
    csv_file = None
    for filename in possible_files:
        if os.path.exists(filename):
            csv_file = filename
            break
    
    if not csv_file:
        print("CSV file not found. Please provide the filename:")
        print("  python map_coordinates.py your_file.csv")
        print("\nOr place your CSV file as one of: stores.csv, coordinates.csv, store_coordinates.csv, data.csv")
        sys.exit(1)

print(f"Reading coordinates from {csv_file}...")

# Try to read the CSV
try:
    with open(csv_file, 'r', encoding='utf-8') as f:
        # Try to detect delimiter
        sample = f.read(1024)
        f.seek(0)
        sniffer = csv.Sniffer()
        delimiter = sniffer.sniff(sample).delimiter
        
        reader = csv.DictReader(f, delimiter=delimiter)
        csv_data = list(reader)
        
        # Print column names for debugging
        if csv_data:
            print(f"CSV columns found: {list(csv_data[0].keys())}")
except FileNotFoundError:
    print(f"Error: File '{csv_file}' not found.")
    print("Please make sure the CSV file is in the same directory.")
    sys.exit(1)
except Exception as e:
    print(f"Error reading CSV: {e}")
    sys.exit(1)

# Create a mapping from store number to coordinates
store_coords = {}
for row in csv_data:
    # Get store number - try different possible column names
    store_num = None
    store_num_key = None
    
    # Look for store number column
    for key in row.keys():
        key_lower = key.lower()
        if ('store' in key_lower and '#' in key_lower) or \
           ('store' in key_lower and 'number' in key_lower) or \
           key_lower == 'store #' or key_lower == 'store number':
            store_num = row[key]
            store_num_key = key
            break
    
    # If not found, try first numeric column
    if not store_num:
        for key, value in row.items():
            if value and str(value).strip().isdigit():
                store_num = value
                store_num_key = key
                break
    
    if store_num:
        # Get latitude and longitude
        lat = None
        lng = None
        
        for key in row.keys():
            key_lower = key.lower()
            if 'lat' in key_lower:
                lat = row[key]
            elif 'lon' in key_lower or 'lng' in key_lower:
                lng = row[key]
        
        if lat and lng:
            try:
                store_num_int = int(str(store_num).strip())
                lat_float = float(str(lat).strip())
                lng_float = float(str(lng).strip())
                store_coords[store_num_int] = {
                    'latitude': lat_float,
                    'longitude': lng_float
                }
            except ValueError as e:
                print(f"Warning: Could not parse coordinates for store {store_num}: {e}")
        else:
            print(f"Warning: Missing coordinates for store {store_num}")
    else:
        print(f"Warning: Could not find store number in row: {row}")

print(f"\nLoaded {len(store_coords)} stores from CSV")

# Update JSON with coordinates
updated_count = 0
for entry in data:
    # Extract store number from "Road Ranger 118" format
    rr_store = entry.get('rr_store', '')
    match = re.search(r'(\d+)', rr_store)
    
    if match:
        store_num = int(match.group(1))
        
        if store_num in store_coords:
            coords = store_coords[store_num]
            entry['rr_store_data']['latitude'] = coords['latitude']
            entry['rr_store_data']['longitude'] = coords['longitude']
            updated_count += 1
            print(f"Updated Road Ranger {store_num} with coordinates")

# Write updated JSON back
print(f"\nUpdating store_comparison_results.json...")
with open('store_comparison_results.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"\nDone! Updated {updated_count} stores with coordinates.")
print(f"Stores in CSV but not found in JSON: {len(store_coords) - updated_count}")
