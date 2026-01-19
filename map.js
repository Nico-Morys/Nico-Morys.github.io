// Calculate distance between two coordinates (in miles)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Interpolate between two hex colors
function interpolateColor(color1, color2, ratio) {
    const hex = (color) => {
        const c = color.replace('#', '');
        return [
            parseInt(c.substr(0, 2), 16),
            parseInt(c.substr(2, 2), 16),
            parseInt(c.substr(4, 2), 16)
        ];
    };
    
    const rgb1 = hex(color1);
    const rgb2 = hex(color2);
    
    const r = Math.round(rgb1[0] + (rgb2[0] - rgb1[0]) * ratio);
    const g = Math.round(rgb1[1] + (rgb2[1] - rgb1[1]) * ratio);
    const b = Math.round(rgb1[2] + (rgb2[2] - rgb1[2]) * ratio);
    
    return `rgb(${r}, ${g}, ${b})`;
}
// Initialize the map
let map;
let stations = [];
let competitors = {};
let selectedStations = new Map(); // Track multiple selected stations: stationId -> {marker, competitorMarkers, lines, numberMarkers}
let competitorMarkers = [];
let competitorPanel;

let filesByDate = {};        // { "2026-01-19": [fileObjects...] }
let availableDays = [];     // ["2026-01-19", "2026-01-18"]
let currentDayIndex = 0;
let currentTimeIndex = 0;
let currentDataFile = '';

// Function to normalize brand name for better matching
function normalizeBrandName(name) {
    if (!name) return '';
    
    // Convert to lowercase for matching
    const lower = name.toLowerCase().trim();
    
    // Handle common brand patterns
    const brandPatterns = {
        'road ranger': 'Road Ranger',
        'ta express': 'TA',
        'ta ': 'TA',
        'travelcenters': 'TA',
        'circle k': 'Circle K',
        'speedway': 'Speedway',
        'huck': "Huck's",
        "huck's": "Huck's",
        'haymakers': 'Haymakers',
        "beck's": "Beck's",
        'beck': "Beck's",
        'k&h': 'K&H',
        'shell': 'Shell',
        'bp': 'BP',
        'exxon': 'Exxon',
        'chevron': 'Chevron',
        'mobil': 'Mobil',
        'atlanta truck': 'Atlanta Truck Stop'
    };
    
    // Check for exact matches first
    for (const [pattern, brand] of Object.entries(brandPatterns)) {
        if (lower.includes(pattern)) {
            return brand;
        }
    }
    
    // Return first word as fallback
    return name.split(' ')[0];
}

// Function to get brand initials/abbreviation
function getBrandInitials(brand) {
    if (!brand) return 'ÃƒÂ¢Ã¢â‚¬ÂºÃ‚Â½';
    
    const brandInitials = {
        'Road Ranger': 'RR',
        'Shell': 'SH',
        'BP': 'BP',
        'Exxon': 'EX',
        'Chevron': 'CV',
        'Mobil': 'MO',
        'Circle K': 'CK',
        'Speedway': 'SW',
        'TA': 'TA',
        "Huck's": "H's",
        'Haymakers': 'HM',
        "Beck's": "B's",
        'K&H': 'KH',
        'Atlanta Truck Stop': 'AT'
    };
    
    return brandInitials[brand] || brand.substring(0, 2).toUpperCase();
}

// Function to get brand color
function getBrandColor(brand) {
    if (!brand) return '#1e3a8a';
    
    const brandColors = {
        'Road Ranger': '#1e3a8a', // Navy Blue
        'Shell': '#FFD700', // Yellow/Gold
        'BP': '#00A859', // Green
        'Exxon': '#ED1C24', // Red
        'Chevron': '#E31937', // Red
        'Mobil': '#FFC72C', // Yellow
        'Circle K': '#FF0000', // Red
        'Speedway': '#FF0000', // Red
        'TA': '#003366', // Navy Blue
        "Huck's": '#0066CC', // Blue
        'Haymakers': '#8B4513', // Brown
        "Beck's": '#228B22', // Forest Green
        'K&H': '#FF8C00', // Dark Orange
        'Atlanta Truck Stop': '#4682B4' // Steel Blue
    };
    
    return brandColors[brand] || '#666666'; // Default gray
}

// Function to get logo image URL for a brand
function getBrandLogo(brand) {
    if (!brand) return 'ÃƒÂ¢Ã¢â‚¬ÂºÃ‚Â½';
    
    // Normalize the brand name
    const normalizedBrand = normalizeBrandName(brand);
    
    // For now, use colored circles with brand initials (reliable, no CORS issues)
    // You can add actual logo images later in a logos/ folder
    const initials = getBrandInitials(normalizedBrand);
    const color = getBrandColor(normalizedBrand);
    
    // Return a styled div with initials instead of trying to load external images
    return `<div class="brand-initials" style="background-color: ${color}; color: white; font-weight: bold; font-size: 10px; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 50%;">${initials}</div>`;
}

// ============================================
// DATE NAVIGATION FUNCTIONS
// ============================================

// Load manifest and get available dates
async function loadManifest() {
    try {
        const response = await fetch('manifest.json?v=' + Date.now());
        const manifest = await response.json();

        filesByDate = {};

        manifest.all.forEach(filename => {
            const match = filename.match(
                /RRMudflapsPrices_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/
            );
            if (!match) return;

            const date = match[1];
            const time = match[2].replace(/-/g, ':');
            const [y, m, d] = date.split('-').map(Number);
            const [hh, mm, ss] = time.split(':').map(Number);

            const timestamp = new Date(y, m - 1, d, hh, mm, ss || 0);

            if (!filesByDate[date]) {
                filesByDate[date] = [];
            }

            filesByDate[date].push({
                date,
                time,
                timestamp,
                filename
            });
        });

        // Sort days newest → oldest
        availableDays = Object.keys(filesByDate).sort(
            (a, b) => new Date(b) - new Date(a)
        );

        // Sort times oldest → newest within each day
        availableDays.forEach(day => {
            filesByDate[day].sort(
                (a, b) => a.timestamp - b.timestamp
            );
        });

        currentDayIndex = 0;
        currentTimeIndex = filesByDate[availableDays[0]].length - 1;
        currentDataFile = filesByDate[availableDays[0]][currentTimeIndex].filename;

        updateDateDisplay();
        await loadDataForCurrentDate();

    } catch (error) {
        console.error('Error loading manifest:', error);
    }
}



// Update date display
function updateDateDisplay() {
    const dateDisplay = document.getElementById('current-date');
    const prevBtn = document.getElementById('prev-date');
    const nextBtn = document.getElementById('next-date');

    if (availableDays.length === 0) {
        dateDisplay.textContent = 'No Data';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    const day = availableDays[currentDayIndex];
    const entry = filesByDate[day][currentTimeIndex];

    const [year, month, dayNum] = entry.date.split('-').map(Number);
    const [hour, minute, second] = entry.time.split(':').map(Number);

    const localDate = new Date(
        year,
        month - 1,
        dayNum,
        hour,
        minute,
        second || 0
    );

    dateDisplay.textContent = localDate.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });

    // Disable buttons at absolute bounds
    const atOldest =
        currentDayIndex === availableDays.length - 1 &&
        currentTimeIndex === 0;

    const atNewest =
        currentDayIndex === 0 &&
        currentTimeIndex === filesByDate[availableDays[0]].length - 1;

    prevBtn.disabled = atOldest;
    nextBtn.disabled = atNewest;
}



// Go to previous date
async function goToPreviousDate() {
    if (currentTimeIndex > 0) {
        currentTimeIndex--;
    } else if (currentDayIndex < availableDays.length - 1) {
        currentDayIndex++;
        currentTimeIndex =
            filesByDate[availableDays[currentDayIndex]].length - 1;
    } else {
        return;
    }

    const day = availableDays[currentDayIndex];
    currentDataFile = filesByDate[day][currentTimeIndex].filename;

    updateDateDisplay();
    await loadDataForCurrentDate();
}


// Go to next date
async function goToNextDate() {
    const day = availableDays[currentDayIndex];
    const times = filesByDate[day];

    if (currentTimeIndex < times.length - 1) {
        currentTimeIndex++;
    } else if (currentDayIndex > 0) {
        currentDayIndex--;
        currentTimeIndex = 0;
    } else {
        return;
    }

    const newDay = availableDays[currentDayIndex];
    currentDataFile = filesByDate[newDay][currentTimeIndex].filename;

    updateDateDisplay();
    await loadDataForCurrentDate();
}


// Load data for current date
async function loadDataForCurrentDate() {
    try {
        // Clear existing station markers
        map.eachLayer(layer => {
            if (layer instanceof L.Marker) {
                map.removeLayer(layer);
            }
        });
        
        // Clear data and selections
        stations = [];
        competitors = {};
        selectedStations.clear();
        
        // Hide panel if open
        if (competitorPanel && !competitorPanel.classList.contains('hidden')) {
            hideCompetitorPanel();
        }
        
        // Fetch data
        const response = await fetch(currentDataFile + '?v=' + Date.now());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        console.log(`Loaded ${data.length} entries from ${currentDataFile}`);
        
        // Process and display data
        processStationData(data);
        
    } catch (error) {
        console.error('Error loading data:', error);
        alert(`Error loading data. Check console for details.`);
    }
}

// Process station data (extracted from original code)
function processStationData(data) {
    stations = [];
    competitors = {};
    
    data.forEach((entry, index) => {
        const storeData = entry.rr_store_data;
        
        if (!storeData) {
            console.warn(`Entry ${index} missing rr_store_data`);
            return;
        }
        
        const lat = parseFloat(storeData.latitude);
        const lng = parseFloat(storeData.longitude);
        
        if (!isNaN(lat) && !isNaN(lng) && lat != null && lng != null) {
            const storeMatch = entry.rr_store.match(/(\d+)/);
            const storeId = storeMatch ? parseInt(storeMatch[1]) : index + 1;
            
            let price = null;
            if (storeData.prices && storeData.prices.length > 0) {
                const priceStr = storeData.prices[0].replace('$', '');
                price = parseFloat(priceStr);
            }
            
            const address = storeData.exit || storeData.name || '';
            
            const station = {
                id: storeId,
                name: storeData.name || entry.rr_store,
                address: address,
                latitude: lat,
                longitude: lng,
                price: price,
                brand: 'Road Ranger'
            };
            
            stations.push(station);
            
            if (entry.competitors && entry.competitors.length > 0) {
                const competitorList = entry.competitors
                    .filter(comp => comp.data)
                    .map((comp, compIndex) => {
                        let compPrice = null;
                        if (comp.data.prices && comp.data.prices.length > 0) {
                            const priceStr = comp.data.prices[0].replace('$', '');
                            compPrice = parseFloat(priceStr);
                        }
                        
                        const hasCoords = comp.data.latitude != null && comp.data.longitude != null &&
                                         !isNaN(comp.data.latitude) && !isNaN(comp.data.longitude);
                        
                        let compLat, compLng, distance;
                        
                        if (hasCoords) {
                            compLat = parseFloat(comp.data.latitude);
                            compLng = parseFloat(comp.data.longitude);
                            distance = calculateDistance(lat, lng, compLat, compLng);
                        } else {
                            const angle = (compIndex * 60) * (Math.PI / 180);
                            const radius = 0.3 + (compIndex * 0.1);
                            const latOffset = (radius / 69) * Math.cos(angle);
                            const lngOffset = (radius / 69) * Math.sin(angle);
                            compLat = lat + latOffset;
                            compLng = lng + lngOffset;
                            distance = radius;
                        }
                        
                        let brand = normalizeBrandName(comp.name);
                        
                        return {
                            name: comp.name,
                            price: compPrice,
                            distance: distance,
                            latitude: compLat,
                            longitude: compLng,
                            brand: brand,
                            hasRealCoords: hasCoords
                        };
                    });
                
                if (competitorList.length > 0) {
                    competitors[storeId.toString()] = competitorList;
                }
            }
        }
    });
    
    console.log(`Processed ${stations.length} stations`);
    
    if (stations.length > 0) {
        const bounds = stations.map(s => [s.latitude, s.longitude]);
        map.fitBounds(bounds, { padding: [50, 50] });
        
        stations.forEach(station => {
            try {
                addStationMarker(station);
            } catch (error) {
                console.error(`Error adding marker for station ${station.id}:`, error);
            }
        });
    }
}

function addStationMarker(station) {
    // Validate coordinates
    if (!station.latitude || !station.longitude || isNaN(station.latitude) || isNaN(station.longitude)) {
        console.error(`Invalid coordinates for station ${station.id}:`, station);
        return;
    }
    // Get logo for the station brand (initials or emoji only)
    const logo = getBrandLogo(station.brand || '');
    
    // Create price badge for RR station (without halo, using orange/yellow theme)
    const priceBadge = station.price ? 
        `<div class="price-badge price-badge-rr">$${station.price.toFixed(2)}</div>` : 
        '';
    
    const fuelIcon = L.divIcon({
        className: 'fuel-marker',
        html: `
            <div class="fuel-icon" style="position: relative; width: 32px; height: 32px;">${logo}</div>
            ${priceBadge}
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
    });
    try {
        const marker = L.marker([station.latitude, station.longitude], {
            icon: fuelIcon
        }).addTo(map);
        marker.on('click', function() {
            showCompetitors(station, marker);
        });
    } catch (error) {
        console.error(`Error creating marker for station ${station.id}:`, error, station);
    }
}

// Remove all competitor markers, lines, and number markers from map
function removeAllCompetitorVisuals() {
    selectedStations.forEach((stationData) => {
        // Remove competitor markers
        if (stationData.competitorMarkers) {
            stationData.competitorMarkers.forEach(marker => map.removeLayer(marker));
        }
        // Remove lines
        if (stationData.lines) {
            stationData.lines.forEach(line => map.removeLayer(line));
        }
        // Remove number markers
        if (stationData.numberMarkers) {
            stationData.numberMarkers.forEach(marker => map.removeLayer(marker));
        }
    });
}

// Show competitors for a station
function showCompetitors(station, marker) {
    const stationId = station.id.toString();
    
    // Check if this station is already selected
    if (selectedStations.has(stationId)) {
        // Deselect this station
        deselectStation(stationId);
        return;
    }
    
    // Add this station to selected stations
    const stationData = {
        station: station,
        marker: marker,
        competitorMarkers: [],
        lines: [],
        numberMarkers: []
    };
    selectedStations.set(stationId, stationData);
    
    // Highlight current marker with animation (keep price badge)
    const stationLogo = getBrandLogo(station.brand || '');
    const stationPriceBadge = station.price ? 
        `<div class="price-badge price-badge-rr">$${station.price.toFixed(2)}</div>` : 
        '';
    const highlightedIcon = L.divIcon({
        className: 'fuel-marker highlighted',
        html: `
            <div class="fuel-icon pulse">${stationLogo}</div>
            ${stationPriceBadge}
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -40]
    });
    marker.setIcon(highlightedIcon);

    // Get competitors for this station
    const stationCompetitors = competitors[stationId] || [];
    console.log(`Station ${station.id} clicked - Found ${stationCompetitors.length} competitors`);
    const stationPrice = station.price || 0;
    
    if (stationCompetitors.length > 0) {
        // Sort by distance
        const sortedCompetitors = [...stationCompetitors].sort((a, b) => a.distance - b.distance);
        
        // Add ALL competitor markers to map with ENHANCED visualizations
        let markersAdded = 0;
        sortedCompetitors.forEach((competitor, index) => {
            if (competitor.latitude && competitor.longitude && !isNaN(competitor.latitude) && !isNaN(competitor.longitude)) {
                markersAdded++;
                
                // Calculate price difference and determine styling
                const priceDiff = competitor.price - stationPrice;
                const absDiff = Math.abs(priceDiff);
                const isLower = competitor.price < stationPrice;
                const isHigher = competitor.price > stationPrice;
                const isSame = absDiff < 0.01; // Consider same if within 1 cent
                
                // Marker color logic
                let markerColor = '#9e9e9e';
                if (isLower) markerColor = '#d32f2f';
                else if (isHigher) markerColor = '#388e3c';
                
                // Determine halo size based on price difference (only if not same price)
                let haloClass = 'halo-small';
                if (absDiff >= 0.20) haloClass = 'halo-large';
                else if (absDiff >= 0.10) haloClass = 'halo-medium';
                
                // Halo type (cheaper or expensive) - only show if price is different
                const haloType = isLower ? 'halo-cheaper' : 'halo-expensive';
                
                // Create price badge
                const badgeClass = isLower ? 'badge-cheaper' : (isHigher ? 'badge-expensive' : '');
                const priceBadge = `<div class="price-badge ${badgeClass}">$${competitor.price.toFixed(2)}</div>`;
                
                // Create price halo (only if price is different)
                const priceHalo = isSame ? '' : `<div class="price-halo ${haloType} ${haloClass}"></div>`;
                
                // Get brand logo
                const competitorLogo = getBrandLogo(competitor.brand || competitor.name);
                
                // Enhanced marker with halo and price badge
                const competitorIcon = L.divIcon({
                    className: 'competitor-marker-wrapper',
                    html: `
                        ${priceHalo}
                        <div class="competitor-icon" style="background-color: ${markerColor}; border-color: ${markerColor};">
                            ${competitorLogo}
                        </div>
                        ${priceBadge}
                    `,
                    iconSize: [26, 26],
                    iconAnchor: [13, 26],
                    popupAnchor: [0, -26]
                });
                
                const competitorMarker = L.marker([competitor.latitude, competitor.longitude], {
                    icon: competitorIcon
                }).addTo(map);
                
                // Add popup
                const diffText = priceDiff > 0 ? `+$${priceDiff.toFixed(2)}` : `-$${absDiff.toFixed(2)}`;
                competitorMarker.bindPopup(`
                    <strong>${competitor.name}</strong><br>
                    Price: <span style="color: #ffeb3b; font-weight: bold;">$${competitor.price.toFixed(2)}</span><br>
                    ${diffText} vs ${station.name}<br>
                    ${competitor.distance.toFixed(1)} mi away
                `);
                stationData.competitorMarkers.push(competitorMarker);

                // GRADIENT POLYLINE - color transitions based on price difference
                // Start color (Road Ranger navy blue)
                const startColor = '#1e3a8a';
                // End color (red for cheaper, green for more expensive)
                const endColor = isLower ? '#d32f2f' : '#388e3c';
                
                // Create gradient effect using multiple segments
                const segments = 5;
                const latStep = (competitor.latitude - station.latitude) / segments;
                const lngStep = (competitor.longitude - station.longitude) / segments;
                
                for (let i = 0; i < segments; i++) {
                    const ratio = i / (segments - 1);
                    // Interpolate color
                    const segmentColor = interpolateColor(startColor, endColor, ratio);
                    const segmentOpacity = 0.5 + (ratio * 0.3); // Gradually increase opacity
                    
                    const segStart = [
                        station.latitude + (latStep * i),
                        station.longitude + (lngStep * i)
                    ];
                    const segEnd = [
                        station.latitude + (latStep * (i + 1)),
                        station.longitude + (lngStep * (i + 1))
                    ];
                    
                    const line = L.polyline([segStart, segEnd], {
                        color: segmentColor,
                        weight: 3,
                        opacity: segmentOpacity,
                        dashArray: '8, 6'
                    }).addTo(map);
                    stationData.lines.push(line);
                }

                // Add number marker at midpoint
                const midLat = (station.latitude + competitor.latitude) / 2;
                const midLng = (station.longitude + competitor.longitude) / 2;
                const numberIcon = L.divIcon({
                    className: 'competitor-number-label',
                    html: `<div style="background: #fff; color: #1976d2; border-radius: 50%; border: 2px solid #1976d2; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.1rem; box-shadow: 0 2px 6px rgba(0,0,0,0.12);">#${index + 1}</div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });
                const numberMarker = L.marker([midLat, midLng], { icon: numberIcon, interactive: false }).addTo(map);
                stationData.numberMarkers.push(numberMarker);
            } else {
                console.warn(`Competitor ${competitor.name} has invalid coordinates:`, competitor);
            }
        });
        console.log(`Added ${markersAdded} competitor markers to map for station ${station.id}`);
    }
    
    // Update panel to show message about multiple selections
    updatePanelForMultipleSelections();
}

// Deselect a station and remove its visuals
function deselectStation(stationId) {
    const stationData = selectedStations.get(stationId);
    if (!stationData) return;
    
    // Remove competitor markers
    stationData.competitorMarkers.forEach(marker => map.removeLayer(marker));
    
    // Remove lines
    stationData.lines.forEach(line => map.removeLayer(line));
    
    // Remove number markers
    stationData.numberMarkers.forEach(marker => map.removeLayer(marker));
    
    // Reset station marker to normal
    const station = stationData.station;
    const marker = stationData.marker;
    const stationLogo = getBrandLogo(station.brand || '');
    const stationPriceBadge = station.price ? 
        `<div class="price-badge price-badge-rr">$${station.price.toFixed(2)}</div>` : 
        '';
    marker.setIcon(L.divIcon({
        className: 'fuel-marker',
        html: `
            <div class="fuel-icon">${stationLogo}</div>
            ${stationPriceBadge}
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -30]
    }));
    
    // Remove from selected stations
    selectedStations.delete(stationId);
    
    // Update panel
    if (selectedStations.size === 0) {
        hideCompetitorPanel();
    } else {
        updatePanelForMultipleSelections();
    }
}

// Update panel to show info about multiple selections
function updatePanelForMultipleSelections() {
    if (selectedStations.size === 0) {
        hideCompetitorPanel();
        return;
    }
    
    const competitorsList = document.getElementById('competitors-list');
    
    // If only one station selected, show detailed view as before
    if (selectedStations.size === 1) {
        const [stationId, stationData] = Array.from(selectedStations.entries())[0];
        const station = stationData.station;
        const stationCompetitors = competitors[stationId] || [];
        const stationPrice = station.price || 0;
        
        document.getElementById('station-name').textContent = station.name;
        const priceText = stationPrice ? `$${stationPrice.toFixed(2)}` : 'Price N/A';
        document.getElementById('station-address').innerHTML = `${station.address}<br><strong style="color: #ffeb3b; font-size: 18px;">Your Price: ${priceText}</strong>`;
        
        competitorsList.innerHTML = '';
        
        if (stationCompetitors.length === 0) {
            competitorsList.innerHTML = '<p class="no-competitors">No competitor data available</p>';
        } else {
            // Sort by distance and show top 5
            const sortedCompetitors = [...stationCompetitors].sort((a, b) => a.distance - b.distance);
            const topCompetitors = sortedCompetitors.slice(0, 5);
            
            topCompetitors.forEach((competitor, index) => {
                const competitorCard = document.createElement('div');
                
                const isLower = competitor.price < stationPrice;
                const isHigher = competitor.price > stationPrice;
                
                if (isLower) {
                    competitorCard.className = 'competitor-card competitor-lower';
                } else if (isHigher) {
                    competitorCard.className = 'competitor-card competitor-higher';
                } else {
                    competitorCard.className = 'competitor-card competitor-equal';
                }
                
                competitorCard.style.animationDelay = `${index * 0.1}s`;
                
                const priceDiff = competitor.price - stationPrice;
                const diffText = priceDiff > 0 ? `+$${priceDiff.toFixed(2)}` : `-$${Math.abs(priceDiff).toFixed(2)}`;
                
                competitorCard.innerHTML = `
                    <div class="competitor-name">${competitor.name}</div>
                    <div class="competitor-price">$${competitor.price.toFixed(2)}</div>
                    <div class="competitor-difference">${diffText}</div>
                    <div class="competitor-distance">${competitor.distance.toFixed(1)} mi away</div>
                `;
                
                competitorsList.appendChild(competitorCard);
            });
            
            if (stationCompetitors.length > 5) {
                const moreText = document.createElement('p');
                moreText.style.textAlign = 'center';
                moreText.style.color = '#aaa';
                moreText.style.marginTop = '10px';
                moreText.style.fontSize = '12px';
                competitorsList.appendChild(moreText);
                moreText.textContent = `+${stationCompetitors.length - 5} more on map`;
            }
        }
    } else {
        // Multiple stations selected - show all with their competitors
        document.getElementById('station-name').textContent = `${selectedStations.size} Stations Selected`;
        document.getElementById('station-address').innerHTML = `Click a selected station again to deselect it.<br>Scroll to see all competitors.`;
        
        competitorsList.innerHTML = '';
        
        // Sort stations by ID for consistent ordering
        const sortedStations = Array.from(selectedStations.entries()).sort((a, b) => {
            return parseInt(a[0]) - parseInt(b[0]);
        });
        
        sortedStations.forEach(([stationId, stationData], stationIndex) => {
            const station = stationData.station;
            const stationCompetitors = competitors[stationId] || [];
            const stationPrice = station.price || 0;
            
            // Create station header
            const stationHeader = document.createElement('div');
            stationHeader.style.cssText = `
                background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
                padding: 12px 14px;
                border-radius: 8px;
                margin-bottom: 10px;
                margin-top: ${stationIndex > 0 ? '20px' : '0'};
                border: 2px solid rgba(59, 130, 246, 0.5);
                cursor: pointer;
                transition: all 0.2s ease;
            `;
            stationHeader.onmouseover = () => {
                stationHeader.style.transform = 'translateX(-3px)';
                stationHeader.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.4)';
            };
            stationHeader.onmouseout = () => {
                stationHeader.style.transform = 'translateX(0)';
                stationHeader.style.boxShadow = 'none';
            };
            stationHeader.onclick = () => {
                deselectStation(stationId);
            };
            
            const priceText = stationPrice ? `$${stationPrice.toFixed(2)}` : 'N/A';
            stationHeader.innerHTML = `
                <div style="font-weight: bold; font-size: 16px; margin-bottom: 4px; color: white;">
                    ${station.name}
                </div>
                <div style="font-size: 12px; opacity: 0.9; color: #e0e7ff;">
                    ${station.address || 'Location'}
                </div>
                <div style="margin-top: 6px; font-size: 14px; color: #ffeb3b; font-weight: bold;">
                    Your Price: ${priceText}
                </div>
                <div style="font-size: 11px; opacity: 0.8; margin-top: 6px; color: #bfdbfe;">
                    Click to deselect Ã¢â‚¬Â¢ ${stationCompetitors.length} competitor${stationCompetitors.length !== 1 ? 's' : ''}
                </div>
            `;
            
            competitorsList.appendChild(stationHeader);
            
            // Show competitors for this station
            if (stationCompetitors.length > 0) {
                const sortedCompetitors = [...stationCompetitors].sort((a, b) => a.distance - b.distance);
                const topCompetitors = sortedCompetitors.slice(0, 5);
                
                topCompetitors.forEach((competitor, index) => {
                    const competitorCard = document.createElement('div');
                    
                    const isLower = competitor.price < stationPrice;
                    const isHigher = competitor.price > stationPrice;
                    
                    if (isLower) {
                        competitorCard.className = 'competitor-card competitor-lower';
                    } else if (isHigher) {
                        competitorCard.className = 'competitor-card competitor-higher';
                    } else {
                        competitorCard.className = 'competitor-card competitor-equal';
                    }
                    
                    competitorCard.style.animationDelay = `${index * 0.05}s`;
                    
                    const priceDiff = competitor.price - stationPrice;
                    const diffText = priceDiff > 0 ? `+$${priceDiff.toFixed(2)}` : `-$${Math.abs(priceDiff).toFixed(2)}`;
                    
                    competitorCard.innerHTML = `
                        <div class="competitor-name">${competitor.name}</div>
                        <div class="competitor-price">$${competitor.price.toFixed(2)}</div>
                        <div class="competitor-difference">${diffText}</div>
                        <div class="competitor-distance">${competitor.distance.toFixed(1)} mi away</div>
                    `;
                    
                    competitorsList.appendChild(competitorCard);
                });
                
                if (stationCompetitors.length > 5) {
                    const moreText = document.createElement('p');
                    moreText.style.cssText = `
                        text-align: center;
                        color: #aaa;
                        margin-top: 8px;
                        margin-bottom: 0;
                        font-size: 11px;
                        font-style: italic;
                    `;
                    moreText.textContent = `+${stationCompetitors.length - 5} more on map`;
                    competitorsList.appendChild(moreText);
                }
            } else {
                const noCompText = document.createElement('p');
                noCompText.style.cssText = `
                    text-align: center;
                    color: #888;
                    padding: 10px;
                    font-size: 12px;
                    font-style: italic;
                `;
                noCompText.textContent = 'No competitors for this station';
                competitorsList.appendChild(noCompText);
            }
        });
    }
    
    showCompetitorPanel();
}

// Show competitor panel with animation
function showCompetitorPanel() {
    competitorPanel.classList.add('show');
    competitorPanel.style.display = 'block';
    
    // Trigger animation
    setTimeout(() => {
        competitorPanel.classList.add('visible');
    }, 10);
}

// Hide competitor panel and clear all selections
function hideCompetitorPanel() {
    competitorPanel.classList.remove('visible');
    
    setTimeout(() => {
        competitorPanel.classList.remove('show');
        competitorPanel.style.display = 'none';
        
        // Deselect all stations
        const stationIds = Array.from(selectedStations.keys());
        stationIds.forEach(stationId => {
            deselectStation(stationId);
        });
    }, 300);
}


// Initialize map when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Initialize map centered on Midwest Chicago Area
    map = L.map('map', {
        wheelPxPerZoomLevel: 100,
        minZoom: 4, // Prevent zooming out too far
        maxZoom: 18  // Optional: set max zoom for performance
    }).setView([41.0, -87.0], 6);
    
    
    // Map click handler - only close panel if clicking on the map itself, not on markers
    map.on('click', function(e) {
        // Don't do anything - let station clicks toggle their selection
        // Panel can only be closed via the X button
    });

    // Dark theme map
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20,
        updateWhenIdle: false,
        keepBuffer: 4,
        detectRetina: true,
        fadeAnimation: true
    }).addTo(map);

    // Get DOM elements
    competitorPanel = document.getElementById('competitor-panel');
    const closePanelBtn = document.getElementById('close-panel');
    const prevBtn = document.getElementById('prev-date');
    const nextBtn = document.getElementById('next-date');



    // Set up event listeners
    if (closePanelBtn) {
        closePanelBtn.addEventListener('click', hideCompetitorPanel);
    }
    
    if (competitorPanel) {
        competitorPanel.addEventListener('click', function(e) {
            if (e.target === competitorPanel) {
                hideCompetitorPanel();
            }
        });
    }
    
    if (prevBtn) prevBtn.addEventListener('click', goToPreviousDate);
    if (nextBtn) nextBtn.addEventListener('click', goToNextDate);

    // Load manifest and initial data
    loadManifest();
});
