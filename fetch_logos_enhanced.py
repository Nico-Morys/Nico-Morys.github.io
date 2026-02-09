#!/usr/bin/env python3
"""
Mudflap Logo Fetcher - Enhanced Version
- Includes Road Ranger logo
- Better search strategies for missing brands
- Shows actual chain names from API for debugging
"""

import json
import time
import requests
import re
import urllib3
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Configuration
CONFIG = {
    'API_BASE': 'https://api.mudflapinc.com',
    'OUTPUT_DIR': './mudflap_logos',
    'STATION_DATA_FILE': 'RRMudflapsPrices_2026-01-18_14-50-12.json',
    'DELAY_BETWEEN_REQUESTS': 0.5,
    'REQUEST_TIMEOUT': 10,
    'DOWNLOAD_TIMEOUT': 15,
    'VERIFY_SSL': False,
    'SEARCH_RADIUS': 150,  # Larger radius to find more chains
    'DEBUG_MODE': True  # Show chain names found in API
}

# Headers for Mudflap API
API_HEADERS = {
    'bundle_id': 'com.mudflap.mudflap',
    'user-agent': 'Mudflap/3.32 (com.mudflap.mudflap; build:772; iOS 26.2.0) Alamofire/1.0',
    'accept': 'application/json'
}

# Brand consolidation with multiple name variations to search for
BRAND_SEARCH_TERMS = {
    'Road Ranger': ['Road Ranger', 'RoadRanger'],
    'TA': ['TA', 'TravelCenters', 'TA Express', 'TA Petro', 'Travel Centers'],
    'Speedway': ['Speedway'],
    'Circle K': ['Circle K', 'CircleK'],
    'Kwik Trip': ['Kwik Trip', 'Kwik Star'],
    "Casey's": ["Casey's", "Caseys", "Casey's General"],
    "Huck's": ["Huck's", "Hucks"],
    'Shell': ['Shell'],
    'BP': ['BP'],
    'Petro': ['Petro'],
    '7-Eleven': ['7-Eleven', '7-11', '7 Eleven'],
    'Pilot': ['Pilot', 'Flying J'],
    "Love's": ["Love's", "Loves"],
    'Stripes': ['Stripes', '7Fleet', '7FLEET'],
    "Allsup's": ["Allsup's", "Allsups", "Allsup"],
    'Maverik': ['Maverik', 'Kum & Go', "Kum 'n Go"],
    'PWI': ['PWI'],
    'Haymakers': ['Haymakers'],
    "Beck's": ["Beck's", "Becks"],
    'Mach 1': ['Mach 1', 'Mach1'],
}


def consolidate_brand(full_name: str) -> str:
    """Consolidate a station name to its core brand"""
    # Check known brands first
    for core_brand, variations in BRAND_SEARCH_TERMS.items():
        for variation in variations:
            if variation.lower() in full_name.lower():
                return core_brand
    
    # Fallback: extract first significant word
    name = re.split(r'[#\-]', full_name)[0].strip()
    words = name.split()
    for word in words:
        if not word.isdigit() and len(word) > 1:
            return word
    
    return name.split()[0] if name.split() else name


def sanitize_filename(name: str) -> str:
    """Convert chain name to safe filename"""
    name = re.sub(r'[^a-z0-9]', '_', name.lower())
    name = re.sub(r'_+', '_', name)
    return name.strip('_')


def search_nearby(lat: float, lng: float, radius: int = None) -> dict:
    """Search for stations near coordinates"""
    if radius is None:
        radius = CONFIG['SEARCH_RADIUS']
        
    url = f"{CONFIG['API_BASE']}/api/v4/truck_stops/nearby"
    params = {
        'origin[latitude]': lat,
        'origin[longitude]': lng,
        'radius': radius
    }
    
    try:
        response = requests.get(
            url,
            params=params,
            headers=API_HEADERS,
            timeout=CONFIG['REQUEST_TIMEOUT'],
            verify=CONFIG['VERIFY_SSL']
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        raise Exception(f"API request failed: {str(e)}")


def find_logo_for_brand(brand: str, coords: tuple, all_chains_seen: set) -> dict:
    """Find logo for a specific brand using known coordinates"""
    lat, lng = coords
    
    # Get search terms for this brand
    search_terms = BRAND_SEARCH_TERMS.get(brand, [brand])
    
    try:
        # Search near the known location
        result = search_nearby(lat, lng)
        
        if 'data' in result:
            # Collect all chain names we see (for debugging)
            for station in result['data']:
                chain = station.get('chain', '')
                if chain:
                    all_chains_seen.add(chain)
            
            # Look for matching chain
            for station in result['data']:
                chain = station.get('chain', '')
                logo_url = station.get('small_branded_pin_url', '')
                
                if not chain or not logo_url:
                    continue
                
                chain_lower = chain.lower()
                
                # Check all search terms for this brand
                for search_term in search_terms:
                    if search_term.lower() in chain_lower:
                        return {
                            'chain': chain,
                            'url': logo_url
                        }
        
        return None
        
    except Exception as e:
        raise Exception(f"Search failed: {str(e)}")


def download_logo(url: str, output_path: Path) -> bool:
    """Download a logo from URL"""
    try:
        response = requests.get(
            url,
            timeout=CONFIG['DOWNLOAD_TIMEOUT'],
            stream=True,
            verify=CONFIG['VERIFY_SSL']
        )
        response.raise_for_status()
        
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        return True
    except Exception as e:
        if output_path.exists():
            output_path.unlink()
        raise Exception(f"Download failed: {str(e)}")


def main():
    print("🚛 Mudflap Logo Fetcher - Enhanced with Road Ranger\n")
    print("=" * 70)
    
    # Create output directory
    output_dir = Path(CONFIG['OUTPUT_DIR'])
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"✓ Output directory: {output_dir}")
    print(f"✓ Search radius: {CONFIG['SEARCH_RADIUS']} miles\n")
    
    # Load data
    print("📍 Loading station data...")
    try:
        with open(CONFIG['STATION_DATA_FILE'], 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ Error loading file: {e}")
        return
    
    # Collect brand families
    brand_families = {}  # core_brand -> {coords, examples, count}
    
    # First, add Road Ranger stores
    print("   Processing Road Ranger stores...")
    rr_count = 0
    for entry in data:
        rr_data = entry.get('rr_store_data', {})
        if rr_data.get('latitude') and rr_data.get('longitude'):
            if 'Road Ranger' not in brand_families:
                brand_families['Road Ranger'] = {
                    'coords': (rr_data['latitude'], rr_data['longitude']),
                    'examples': [],
                    'count': 0
                }
            brand_families['Road Ranger']['examples'].append(rr_data.get('name', 'Road Ranger'))
            brand_families['Road Ranger']['count'] += 1
            rr_count += 1
    
    print(f"   Found {rr_count} Road Ranger locations")
    
    # Now add competitors
    print("   Processing competitor stores...")
    for entry in data:
        if 'competitors' in entry:
            for comp in entry['competitors']:
                full_name = comp.get('name', '')
                if not full_name:
                    continue
                
                core_brand = consolidate_brand(full_name)
                
                # Get coordinates
                comp_data = comp.get('data', {})
                coords = None
                if comp_data.get('latitude') and comp_data.get('longitude'):
                    coords = (comp_data['latitude'], comp_data['longitude'])
                
                # Store
                if core_brand not in brand_families:
                    brand_families[core_brand] = {
                        'coords': coords,
                        'examples': [],
                        'count': 0
                    }
                
                brand_families[core_brand]['examples'].append(full_name)
                brand_families[core_brand]['count'] += 1
                
                if coords and not brand_families[core_brand]['coords']:
                    brand_families[core_brand]['coords'] = coords
    
    print(f"✓ Consolidated to {len(brand_families)} brand families total\n")
    
    # Show top brands
    sorted_brands = sorted(brand_families.items(), 
                          key=lambda x: x[1]['count'], 
                          reverse=True)
    
    print("Top 20 brand families by location count:")
    print("-" * 70)
    for i, (brand, info) in enumerate(sorted_brands[:20], 1):
        examples = ', '.join(info['examples'][:2])
        if len(info['examples']) > 2:
            examples += '...'
        print(f"{i:2d}. {brand:<20} ({info['count']:2d} locations)")
    print()
    
    # Fetch logos
    print("🔍 Fetching logos from Mudflap API...\n")
    
    logo_database = {}
    found = 0
    not_found = 0
    all_chains_seen = set()  # Track all chain names we see
    
    for idx, (brand, info) in enumerate(sorted_brands, 1):
        # Skip if no coordinates
        if not info['coords']:
            print(f"[{idx}/{len(brand_families)}] {brand:<25} ⚠️  No coordinates")
            not_found += 1
            continue
        
        try:
            print(f"[{idx}/{len(brand_families)}] {brand:<25} ", end='', flush=True)
            
            result = find_logo_for_brand(brand, info['coords'], all_chains_seen)
            
            if result:
                logo_database[brand] = {
                    'chain': result['chain'],
                    'url': result['url'],
                    'location_count': info['count'],
                    'examples': info['examples'][:3]
                }
                print(f"✓ Found (chain: {result['chain']})")
                found += 1
            else:
                print("❌ Not found")
                not_found += 1
            
            # Rate limiting
            time.sleep(CONFIG['DELAY_BETWEEN_REQUESTS'])
                
        except Exception as e:
            print(f"❌ Error: {e}")
            not_found += 1
    
    print("\n" + "=" * 70)
    print(f"✓ Found logos for {found} brand families")
    print(f"⚠️  No logo found for {not_found} brands")
    
    # Show unique chain names seen if debug mode
    if CONFIG['DEBUG_MODE'] and all_chains_seen:
        print(f"\n📋 All unique chain names found in API ({len(all_chains_seen)} total):")
        print("-" * 70)
        for i, chain in enumerate(sorted(all_chains_seen), 1):
            print(f"   {chain}")
            if i >= 50:  # Limit output
                print(f"   ... and {len(all_chains_seen) - 50} more")
                break
    print()
    
    # Download logos
    if not logo_database:
        print("❌ No logos to download.")
        return
    
    print("⬇️  Downloading logos...\n")
    
    downloaded = 0
    failed = 0
    skipped = 0
    
    for brand, info in logo_database.items():
        filename = sanitize_filename(brand) + '.png'
        output_path = output_dir / filename
        
        if output_path.exists():
            print(f"⏭️  Skipped (exists): {brand}")
            skipped += 1
            continue
        
        try:
            print(f"  Downloading: {brand}... ", end='', flush=True)
            download_logo(info['url'], output_path)
            print("✓")
            downloaded += 1
            time.sleep(0.2)
        except Exception as e:
            print(f"❌ Failed: {e}")
            failed += 1
    
    # Generate summary
    summary = {
        'generated_at': datetime.now().isoformat(),
        'total_brands': len(logo_database),
        'brands': [
            {
                'brand': brand,
                'chain': info['chain'],
                'url': info['url'],
                'local_file': sanitize_filename(brand) + '.png',
                'location_count': info['location_count'],
                'example_stations': info['examples']
            }
            for brand, info in sorted(logo_database.items())
        ]
    }
    
    summary_path = output_dir / 'logo_database.json'
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)
    
    # Print final summary
    print("\n" + "=" * 70)
    print("📊 Final Summary:")
    print(f"   Brand families found: {found}")
    print(f"   Logos downloaded: {downloaded}")
    print(f"   Failed downloads: {failed}")
    print(f"   Already existed: {skipped}")
    print(f"\n✓ Logos saved to: {output_dir}")
    print(f"✓ Database saved to: {summary_path}")
    
    if not_found > 0:
        print(f"\n💡 TIP: Check the chain names list above to see what the API")
        print(f"   actually calls these brands, then update BRAND_SEARCH_TERMS")
    
    print("\n✅ Done!\n")


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user. Exiting...")
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        exit(1)
