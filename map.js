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
let checkedStations = new Set(); // Track which stations have been reviewed
let stationMarkers = new Map(); // Track all station markers: stationId -> marker

let filesByDate = {};        // { "2026-01-19": [fileObjects...] }
let availableDays = [];     // ["2026-01-19", "2026-01-18"]
let currentDayIndex = 0;
let currentTimeIndex = 0;
let currentDataFile = '';
let currentSelectedStationForNotes = null; // Track currently selected station for notes
let currentFetchController = null; // AbortController to cancel stale scrub fetches
let hasInitiallyLoaded = false; // True after the very first data load completes
let stationRatings = {}; // { "rr_144": "fair", "144::Casey's General Store #2867": "good", ... }
let modelData = {}; // store_num -> model store object from rr_all_stores_output.json
let storeCosts = {}; // store_num -> cost per gallon (from user paste)
let marginBuffer = 0.00; // additional margin buffer on top of cost

// ============================================
// NOTES MANAGEMENT FUNCTIONS
// ============================================

// Get notes for a specific station from localStorage
function getStationNote(stationId) {
    const key = `rr-station-note-${stationId}`;
    return localStorage.getItem(key) || '';
}

// Save note for a specific station to localStorage
function saveStationNote(stationId, note) {
    const key = `rr-station-note-${stationId}`;
    if (note.trim() === '') {
        localStorage.removeItem(key);
    } else {
        localStorage.setItem(key, note);
    }
}

// Update notes section UI
function updateNotesSection(station) {
    const notesSection = document.getElementById('notes-section');
    const notesStationName = document.getElementById('notes-station-name');
    const notesTextarea = document.getElementById('notes-textarea');
    
    if (!station) {
        notesSection.classList.add('hidden');
        currentSelectedStationForNotes = null;
        notesTextarea.value = '';
        return;
    }
    
    currentSelectedStationForNotes = station;
    notesSection.classList.remove('hidden');
    notesStationName.textContent = station.name;
    notesTextarea.value = getStationNote(station.id);
    notesTextarea.placeholder = `Add notes for ${station.name}...`;
}

// Clear current note
function clearCurrentNote() {
    if (currentSelectedStationForNotes) {
        const notesTextarea = document.getElementById('notes-textarea');
        notesTextarea.value = '';
        saveStationNote(currentSelectedStationForNotes.id, '');
    }
}

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
    if (!brand) return '';
    
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

// Function to extract store number from station name
function getStoreNumber(stationName) {
    if (!stationName) return '';
    
    // Match patterns like "Road Ranger 118", "Road Ranger #118", etc.
    const match = stationName.match(/(?:Road Ranger|RR)\s*#?(\d+)/i);
    if (match && match[1]) {
        return match[1];
    }
    
    // Fallback: look for any number in the name
    const numberMatch = stationName.match(/\d+/);
    return numberMatch ? numberMatch[0] : '';
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
    if (!brand) return '';
    
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
// RATINGS HELPERS
// ============================================

async function loadRatings() {
    try {
        const response = await fetch('ratings.json?v=' + Date.now());
        if (response.ok) {
            stationRatings = await response.json();
            console.log(`Ratings loaded: ${Object.keys(stationRatings).length} entries`);
        }
    } catch (e) {
        console.warn('Could not load ratings.json — ratings will be hidden.', e);
    }
}

function getRatingBadge(rrStoreId, competitorName) {
    const COLORS = {
        poor:          '#1565c0',
        fair:          '#1565c0',
        average:       '#1565c0',
        above_average: '#1565c0',
        best_in_class: '#1565c0',
    };
    const LABELS = {
        poor:          'Poor',
        fair:          'Fair',
        average:       'Average',
        above_average: 'Above Avg',
        best_in_class: 'Best in Class',
    };

    let key;
    if (!competitorName) {
        key = `rr_${rrStoreId}`;
    } else {
        key = `${rrStoreId}::${competitorName}`;
    }

    const rating = stationRatings[key];
    if (!rating) return '';

    const color = COLORS[rating] || '#757575';
    const label = LABELS[rating] || rating;
    return `<span class="station-rating-badge" style="background-color:${color};">${label}</span>`;
}

// ============================================
// DATE NAVIGATION FUNCTIONS
// ============================================

// Calculate total number of timestamps across all days
function getTotalTimestampCount() {
    let total = 0;
    availableDays.forEach(day => {
        total += filesByDate[day].length;
    });
    return total;
}

// Get absolute index from day and time indices
function getAbsoluteIndex(dayIndex, timeIndex) {
    let index = 0;
    
    // availableDays[0] = newest day, availableDays[last] = oldest day
    // We want absolute index 0 = oldest overall, highest = newest overall
    
    // Count all timestamps in days OLDER than current day (higher dayIndex)
    for (let i = availableDays.length - 1; i > dayIndex; i--) {
        index += filesByDate[availableDays[i]].length;
    }
    
    // Add timestamps from the current day (times are sorted oldest to newest)
    index += timeIndex;
    
    return index;
}

// Convert absolute index back to day and time indices
function getIndicesFromAbsolute(absoluteIndex) {
    let remaining = absoluteIndex;
    
    // Iterate from oldest day (highest dayIdx) to newest (dayIdx 0)
    for (let dayIdx = availableDays.length - 1; dayIdx >= 0; dayIdx--) {
        const timesInDay = filesByDate[availableDays[dayIdx]].length;
        
        if (remaining < timesInDay) {
            return { dayIndex: dayIdx, timeIndex: remaining };
        }
        
        remaining -= timesInDay;
    }
    
    // Fallback to newest
    return { dayIndex: 0, timeIndex: filesByDate[availableDays[0]].length - 1 };
}

// Update scrubber position
function updateScrubberPosition() {
    const thumb = document.getElementById('scrubber-thumb');
    const tooltip = document.getElementById('scrubber-tooltip');
    
    if (!thumb || !tooltip) return;
    
    const totalCount = getTotalTimestampCount();
    if (totalCount <= 1) {
        thumb.style.left = '100%';
        return;
    }
    
    const absoluteIndex = getAbsoluteIndex(currentDayIndex, currentTimeIndex);
    // absoluteIndex 0 = oldest (left, 0%), highest = newest (right, 100%)
    const percentage = (absoluteIndex / (totalCount - 1)) * 100;
    
    thumb.style.left = percentage + '%';
    
    // Update tooltip with current date
    const day = availableDays[currentDayIndex];
    const entry = filesByDate[day][currentTimeIndex];
    const [year, month, dayNum] = entry.date.split('-').map(Number);
    const [hour, minute, second] = entry.time.split(':').map(Number);
    const localDate = new Date(year, month - 1, dayNum, hour, minute, second || 0);
    
    tooltip.textContent = localDate.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

// Update scrubber labels
function updateScrubberLabels() {
    const startLabel = document.getElementById('scrubber-start');
    const endLabel = document.getElementById('scrubber-end');
    
    if (!startLabel || !endLabel || availableDays.length === 0) return;
    
    // Oldest timestamp (left side of bar)
    const oldestDay = availableDays[availableDays.length - 1];
    const oldestEntry = filesByDate[oldestDay][0];
    const [oldYear, oldMonth, oldDay] = oldestEntry.date.split('-').map(Number);
    const [oldHour, oldMinute, oldSecond] = oldestEntry.time.split(':').map(Number);
    const oldestDate = new Date(oldYear, oldMonth - 1, oldDay, oldHour, oldMinute, oldSecond || 0);
    
    // Newest timestamp (right side of bar)
    const newestDay = availableDays[0];
    const newestEntry = filesByDate[newestDay][filesByDate[newestDay].length - 1];
    const [newYear, newMonth, newDay] = newestEntry.date.split('-').map(Number);
    const [newHour, newMinute, newSecond] = newestEntry.time.split(':').map(Number);
    const newestDate = new Date(newYear, newMonth - 1, newDay, newHour, newMinute, newSecond || 0);
    
    startLabel.textContent = oldestDate.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric'
    });
    
    endLabel.textContent = newestDate.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric'
    });
}

// Load manifest and get available dates
async function loadManifest() {
    try {
        // Load model data for recommended pricing (non-blocking — map works without it)
        fetch('rr_all_stores_output.json?v=' + Date.now())
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data && data.stores) {
                    data.stores.forEach(s => { modelData[s.store_num] = s; });
                    console.log(`Loaded model data for ${Object.keys(modelData).length} stores`);
                }
            })
            .catch(e => console.warn('Model data not available (recommended pricing disabled):', e.message));

        const response = await fetch('pricedata/manifest.json?v=' + Date.now());
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

        // Sort days newest to oldest
        availableDays = Object.keys(filesByDate).sort(
            (a, b) => new Date(b) - new Date(a)
        );

        // Sort times oldest to newest within each day
        availableDays.forEach(day => {
            filesByDate[day].sort(
                (a, b) => a.timestamp - b.timestamp
            );
        });

        currentDayIndex = 0;
        currentTimeIndex = filesByDate[availableDays[0]].length - 1;
        currentDataFile = 'pricedata/' + filesByDate[availableDays[0]][currentTimeIndex].filename;

        updateDateDisplay();
        updateScrubberLabels();
        updateScrubberPosition();
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
    
    // Update scrubber position
    updateScrubberPosition();
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
    currentDataFile = 'pricedata/' + filesByDate[day][currentTimeIndex].filename;

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
    currentDataFile = 'pricedata/' + filesByDate[newDay][currentTimeIndex].filename;

    updateDateDisplay();
    await loadDataForCurrentDate();
}

// ============================================
// PROGRESS COUNTER FUNCTIONS
// ============================================

// Update the progress counter display
function updateProgressCounter() {
    const checkedCount = checkedStations.size;
    const totalCount = stations.length;
    const percentage = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;
    
    document.getElementById('checked-count').textContent = checkedCount;
    document.getElementById('total-count').textContent = totalCount;
    document.getElementById('progress-bar').style.width = percentage + '%';
}

// Toggle checked status for a station
function toggleStationChecked(stationId, marker) {
    const stationIdStr = stationId.toString();
    
    if (checkedStations.has(stationIdStr)) {
        // Uncheck the station
        checkedStations.delete(stationIdStr);
        marker.getElement().classList.remove('checked');
    } else {
        // Check the station
        checkedStations.add(stationIdStr);
        marker.getElement().classList.add('checked');
    }
    
    updateProgressCounter();
}

// Check all stations
function checkAllStations() {
    stations.forEach(station => {
        const stationId = station.id.toString();
        checkedStations.add(stationId);
        
        const marker = stationMarkers.get(stationId);
        if (marker && marker.getElement()) {
            marker.getElement().classList.add('checked');
        }
    });
    
    updateProgressCounter();
}

// Uncheck all stations
function uncheckAllStations() {
    checkedStations.clear();
    
    stationMarkers.forEach((marker, stationId) => {
        if (marker && marker.getElement()) {
            marker.getElement().classList.remove('checked');
        }
    });
    
    updateProgressCounter();
}



// Load data for current date

// Load data for current date
async function loadDataForCurrentDate() {
    // Snapshot selection state NOW, before aborting anything — a subsequent call
    // would otherwise see an already-cleared selectedStations map.
    const previouslySelectedStationIds = Array.from(selectedStations.keys());
    const previouslyCheckedStationIds = Array.from(checkedStations);

    // Abort any in-flight fetch from a previous scrub position
    if (currentFetchController) {
        currentFetchController.abort();
    }
    currentFetchController = new AbortController();
    const signal = currentFetchController.signal;

    try {
        // Fetch data first — don't touch the DOM until we know this request won't be discarded
        const response = await fetch(currentDataFile + '?v=' + Date.now(), { signal });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // If this request was superseded by a newer scrub position, bail out entirely
        // (leaves the map untouched for the winning request to handle)
        if (signal.aborted) return;

        // --- Safe to mutate the map from here — this is the winning request ---

        // Remove competitor markers, lines, and number markers from selectedStations
        selectedStations.forEach(stationData => {
            if (stationData.competitorMarkers) {
                stationData.competitorMarkers.forEach(marker => {
                    if (map.hasLayer(marker)) map.removeLayer(marker);
                });
            }
            if (stationData.lines) {
                stationData.lines.forEach(line => {
                    if (map.hasLayer(line)) map.removeLayer(line);
                });
            }
            if (stationData.numberMarkers) {
                stationData.numberMarkers.forEach(marker => {
                    if (map.hasLayer(marker)) map.removeLayer(marker);
                });
            }
        });

        // Clear ALL remaining markers and polylines from the map
        const layersToRemove = [];
        map.eachLayer(layer => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                layersToRemove.push(layer);
            }
        });
        layersToRemove.forEach(layer => {
            map.removeLayer(layer);
        });

        // Clear data and selections (we'll restore them after loading)
        stations = [];
        competitors = {};
        selectedStations.clear();
        stationMarkers.clear();
        
        console.log(`Loaded ${data.length} entries from ${currentDataFile}`);
        
        // Process and display data
        processStationData(data);
        
        // Restore checked stations
        checkedStations.clear();
        previouslyCheckedStationIds.forEach(stationId => {
            checkedStations.add(stationId);
            const marker = stationMarkers.get(stationId);
            if (marker && marker.getElement()) {
                marker.getElement().classList.add('checked');
            }
        });
        updateProgressCounter();
        
        // Restore selected stations with updated data
        if (previouslySelectedStationIds.length > 0) {
            previouslySelectedStationIds.forEach((stationId, index) => {
                const station = stations.find(s => s.id.toString() === stationId);
                const marker = stationMarkers.get(stationId);
                
                if (station && marker) {
                    // Re-select the station with new data
                    // Preserve order by using index-based timestamp
                    const stationData = {
                        station: station,
                        marker: marker,
                        competitorMarkers: [],
                        lines: [],
                        numberMarkers: [],
                        timestamp: Date.now() - (previouslySelectedStationIds.length - index) * 1000
                    };
                    selectedStations.set(stationId, stationData);
                    
                    // Re-add visuals without calling showCompetitors to avoid resetting order
                    const stationLogo = getBrandLogo(station.brand || '');
                    const stationPriceBadge = station.price ? 
                        `<div class="price-badge price-badge-rr">$${station.price.toFixed(2)}</div>` : 
                        '';
                    
                    const isChecked = checkedStations.has(stationId);
                    const checkedClass = isChecked ? 'checked' : '';
                    
                    // Get store number
                    const storeNumber = getStoreNumber(station.name);
                    const storeNumberBadge = storeNumber ? 
                        `<div class="store-number-badge">${storeNumber}</div>` : '';
                    
                    const highlightedIcon = L.divIcon({
                        className: `fuel-marker highlighted ${checkedClass}`,
                        html: `
                            <div class="fuel-icon pulse">${stationLogo}</div>
                            ${storeNumberBadge}
                            ${stationPriceBadge}
                        `,
                        iconSize: [40, 40],
                        iconAnchor: [20, 40],
                        popupAnchor: [0, -40]
                    });
                    marker.setIcon(highlightedIcon);

                    // Add competitor markers
                    const stationCompetitors = competitors[stationId] || [];
                    const stationPrice = station.price || 0;
                    
                    if (stationCompetitors.length > 0) {
                        const sortedCompetitors = [...stationCompetitors].sort((a, b) => a.distance - b.distance);
                        
                        sortedCompetitors.forEach((competitor, compIndex) => {
                            if (competitor.latitude && competitor.longitude && !isNaN(competitor.latitude) && !isNaN(competitor.longitude)) {
                                const priceDiff = competitor.price - stationPrice;
                                const absDiff = Math.abs(priceDiff);
                                const isLower = competitor.price < stationPrice;
                                const isHigher = competitor.price > stationPrice;
                                const isSame = absDiff < 0.01;
                                
                                let markerColor = '#9e9e9e';
                                if (isLower) markerColor = '#d32f2f';
                                else if (isHigher) markerColor = '#388e3c';
                                
                                let haloClass = 'halo-small';
                                if (absDiff >= 0.20) haloClass = 'halo-large';
                                else if (absDiff >= 0.10) haloClass = 'halo-medium';
                                
                                const haloType = isLower ? 'halo-cheaper' : 'halo-expensive';
                                const badgeClass = isLower ? 'badge-cheaper' : (isHigher ? 'badge-expensive' : '');
                                const priceBadge = `<div class="price-badge ${badgeClass}">$${competitor.price.toFixed(2)}</div>`;
                                const priceHalo = isSame ? '' : `<div class="price-halo ${haloType} ${haloClass}"></div>`;
                                const competitorLogo = getBrandLogo(competitor.brand || competitor.name);
                                
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
                                
                                const diffText = priceDiff > 0 ? `+$${priceDiff.toFixed(2)}` : `-$${absDiff.toFixed(2)}`;
                                competitorMarker.bindPopup(`
                                    <strong>${competitor.name}</strong><br>
                                    Price: <span style="color: #ffeb3b; font-weight: bold;">$${competitor.price.toFixed(2)}</span><br>
                                    ${diffText} vs ${station.name}<br>
                                    ${competitor.distance.toFixed(1)} mi away
                                `);
                                stationData.competitorMarkers.push(competitorMarker);

                                // Add gradient polyline
                                const startColor = '#1e3a8a';
                                const endColor = isLower ? '#d32f2f' : '#388e3c';
                                const segments = 5;
                                const latStep = (competitor.latitude - station.latitude) / segments;
                                const lngStep = (competitor.longitude - station.longitude) / segments;
                                
                                for (let i = 0; i < segments; i++) {
                                    const ratio = i / (segments - 1);
                                    const segmentColor = interpolateColor(startColor, endColor, ratio);
                                    const segmentOpacity = 0.5 + (ratio * 0.3);
                                    
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

                                // Add number marker
                                const midLat = (station.latitude + competitor.latitude) / 2;
                                const midLng = (station.longitude + competitor.longitude) / 2;
                                const numberIcon = L.divIcon({
                                    className: 'competitor-number-label',
                                    html: `<div style="background: #fff; color: #1976d2; border-radius: 50%; border: 2px solid #1976d2; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.1rem; box-shadow: 0 2px 6px rgba(0,0,0,0.12);">#${compIndex + 1}</div>`,
                                    iconSize: [28, 28],
                                    iconAnchor: [14, 14]
                                });
                                const numberMarker = L.marker([midLat, midLng], { icon: numberIcon, interactive: false }).addTo(map);
                                stationData.numberMarkers.push(numberMarker);
                            }
                        });
                    }
                }
            });
            
            // Update panel with restored selections
            updatePanelForMultipleSelections();
        }
        
    } catch (error) {
        // AbortError is expected when a newer scrub position cancels this fetch — ignore it silently
        if (error.name === 'AbortError') return;
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
    
    // Update progress counter
    updateProgressCounter();
    
    // Only fit bounds on the very first load, not when scrubbing or navigating dates
    if (stations.length > 0) {
        if (!hasInitiallyLoaded) {
            const bounds = stations.map(s => [s.latitude, s.longitude]);
            map.fitBounds(bounds, { padding: [50, 50] });
            hasInitiallyLoaded = true;
        }
        
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
    
    const stationId = station.id.toString();
    
    // Get logo for the station brand (initials or emoji only)
    const logo = getBrandLogo(station.brand || '');
    
    // Create price badge for RR station (without halo, using orange/yellow theme)
    const priceBadge = station.price ? 
        `<div class="price-badge price-badge-rr">$${station.price.toFixed(2)}</div>` : 
        '';
    
    // Get store number for the badge
    const storeNumber = getStoreNumber(station.name);
    const storeNumberBadge = storeNumber ? 
        `<div class="store-number-badge">${storeNumber}</div>` : '';
    
    // Add 'checked' class if this station is already checked
    const checkedClass = checkedStations.has(stationId) ? 'checked' : '';
    
    const fuelIcon = L.divIcon({
        className: `fuel-marker ${checkedClass}`,
        html: `
            <div class="fuel-icon" style="position: relative; width: 32px; height: 32px;">${logo}</div>
            ${storeNumberBadge}
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
        
        // Store marker reference
        stationMarkers.set(stationId, marker);
        
        // Handle click events
        marker.on('click', function(e) {
            // Ctrl+Click to check/uncheck station
            if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
                toggleStationChecked(station.id, marker);
                // Prevent the showCompetitors from triggering
                L.DomEvent.stopPropagation(e);
                return;
            }
            
            // Normal click shows competitors AND updates notes section
            showCompetitors(station, marker);
            updateNotesSection(station);
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
            stationData.competitorMarkers.forEach(marker => {
                if (map.hasLayer(marker)) {
                    map.removeLayer(marker);
                }
            });
            stationData.competitorMarkers = [];
        }
        // Remove lines
        if (stationData.lines) {
            stationData.lines.forEach(line => {
                if (map.hasLayer(line)) {
                    map.removeLayer(line);
                }
            });
            stationData.lines = [];
        }
        // Remove number markers
        if (stationData.numberMarkers) {
            stationData.numberMarkers.forEach(marker => {
                if (map.hasLayer(marker)) {
                    map.removeLayer(marker);
                }
            });
            stationData.numberMarkers = [];
        }
    });
}

// Show competitors for a station
function showCompetitors(station, marker) {
    const stationId = station.id.toString();
    
    // Check if this station is already selected
    if (selectedStations.has(stationId)) {
        // Move this station to the front (most recent)
        const existingData = selectedStations.get(stationId);
        selectedStations.delete(stationId);
        selectedStations.set(stationId, existingData);
        
        // Update panel to reflect new order
        updatePanelForMultipleSelections();
        return;
    }
    
    // Add this station to selected stations (at the end, which becomes the front in iteration)
    const stationData = {
        station: station,
        marker: marker,
        competitorMarkers: [],
        lines: [],
        numberMarkers: [],
        timestamp: Date.now() // Add timestamp for ordering
    };
    selectedStations.set(stationId, stationData);
    
    // Highlight current marker with animation (keep price badge)
    const stationLogo = getBrandLogo(station.brand || '');
    const stationPriceBadge = station.price ? 
        `<div class="price-badge price-badge-rr">$${station.price.toFixed(2)}</div>` : 
        '';
    
    // Preserve checked state
    const isChecked = checkedStations.has(stationId);
    const checkedClass = isChecked ? 'checked' : '';
    
    // Get store number
    const storeNumber = getStoreNumber(station.name);
    const storeNumberBadge = storeNumber ? 
        `<div class="store-number-badge">${storeNumber}</div>` : '';
    
    const highlightedIcon = L.divIcon({
        className: `fuel-marker highlighted ${checkedClass}`,
        html: `
            <div class="fuel-icon pulse">${stationLogo}</div>
            ${storeNumberBadge}
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
    
    // Preserve checked state
    const isChecked = checkedStations.has(stationId);
    const checkedClass = isChecked ? 'checked' : '';
    
    // Get store number
    const storeNumber = getStoreNumber(station.name);
    const storeNumberBadge = storeNumber ? 
        `<div class="store-number-badge">${storeNumber}</div>` : '';
    
    marker.setIcon(L.divIcon({
        className: `fuel-marker ${checkedClass}`,
        html: `
            <div class="fuel-icon">${stationLogo}</div>
            ${storeNumberBadge}
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

// Compute a live recommended price for a store using model data + current competitor prices
function computeRecommendedPrice(stationId, currentCompetitors) {
    const storeNum = getStoreNumber(
        (stations.find(s => s.id.toString() === stationId.toString()) || {}).name || ''
    );
    const model = modelData[storeNum];
    if (!model || !model.has_model) return null;

    // Use enhanced model if available, fall back to dow_model
    const em = model.enhanced_model || model.dow_model;
    const dm = model.dow_model;
    if (!em || !dm) return null;

    // Compute live comp_avg from the current map data (not stale model snapshot)
    const validComps = (currentCompetitors || []).filter(c => c.price && c.price > 0);
    if (validComps.length === 0) return null;
    const liveCompAvg = validComps.reduce((sum, c) => sum + c.price, 0) / validComps.length;

    // Today's DOW
    const DOW_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    const now = new Date();
    const todayDow = DOW_NAMES[now.getDay() === 0 ? 6 : now.getDay() - 1]; // JS: 0=Sun

    // Get baseline gallons for today's DOW
    const base = dm.dow_baselines[todayDow] || 0;

    // Get effective slope (use weekend slope if available and it's a weekend)
    const isWeekend = (todayDow === 'Saturday' || todayDow === 'Sunday');
    let effectiveSlope;
    if (em.weekend_slope !== undefined && isWeekend) {
        effectiveSlope = em.weekend_slope;
    } else if (em.weekday_slope !== undefined && !isWeekend) {
        effectiveSlope = em.weekday_slope;
    } else {
        effectiveSlope = em.price_slope || dm.price_slope;
    }

    if (effectiveSlope >= 0) {
        // Model says higher prices = more gallons (anomaly) — just recommend match
        return {
            price: Math.round(liveCompAvg * 100) / 100,
            diffCents: 0,
            predictedGallons: Math.round(base),
            compAvg: liveCompAvg,
            dow: todayDow,
            confidence: model.confidence,
            costSource: 'n/a',
        };
    }

    // ── Gross-profit optimization ──
    // Use actual cost if available from user paste, otherwise estimate
    const currentRR = (stations.find(s => s.id.toString() === stationId.toString()) || {}).price || liveCompAvg;
    let estimatedCost;
    let costSource;
    if (storeCosts[storeNum] !== undefined) {
        estimatedCost = storeCosts[storeNum];
        costSource = 'actual';
    } else {
        const ASSUMED_MARGIN_PER_GAL = 0.05;
        estimatedCost = currentRR - ASSUMED_MARGIN_PER_GAL;
        costSource = 'estimated';
    }

    // The minimum price we're allowed to recommend = cost + buffer (applied in both paths)
    const minPrice = estimatedCost + marginBuffer;

    // Lower bound of search in cents vs comp avg — never go below cost + buffer
    const minDiff = Math.ceil((minPrice - liveCompAvg) * 100);
    console.log('Store:', storeNum, 'minDiff:', minDiff, 'minPrice:', minPrice, 'estimatedCost:', estimatedCost, 'liveCompAvg:', liveCompAvg);

// Search from cost+buffer floor up to +15¢ vs comp avg
    let bestProfit = -Infinity;
    let bestDiff = minDiff;
    for (let diff = Math.max(-15, minDiff); diff <= 15; diff += 0.5) {
        const margin = (liveCompAvg + diff / 100) - estimatedCost;
        const gal = Math.max(0, base + effectiveSlope * diff);
        const profit = margin * gal;
        if (profit > bestProfit) {
            bestProfit = profit;
            bestDiff = diff;
        }
    }

    // Final price: clamp to minimum of cost + buffer
    const rawPrice = liveCompAvg + bestDiff / 100;
    const recPrice = Math.round(Math.max(rawPrice, minPrice) * 100) / 100;
    const predictedGal = Math.round(Math.max(0, base + effectiveSlope * bestDiff));

    return {
        price: recPrice,
        diffCents: Math.round(bestDiff * 10) / 10,
        predictedGallons: predictedGal,
        compAvg: liveCompAvg,
        dow: todayDow,
        confidence: model.confidence,
        costSource: costSource,
    };
}

// Format recommended price HTML for the panel
function formatRecommendedPriceHTML(rec) {
    if (!rec) return '';
    const confColors = { high: '#4ade80', medium: '#fbbf24', low: '#f87171' };
    const confColor = confColors[rec.confidence] || '#888';
    const diffLabel = rec.diffCents < 0 ? `${rec.diffCents}¢ vs comp avg` :
                      rec.diffCents > 0 ? `+${rec.diffCents}¢ vs comp avg` : 'match comp avg';
    const costLabel = rec.costSource === 'actual'
        ? `<span style="color: #4ade80; margin-left: 6px;">✓ actual cost</span>`
        : `<span style="color: #666; margin-left: 6px;">est. cost</span>`;
    return `
        <div style="margin-top: 8px; padding: 8px 12px; background: rgba(74, 222, 128, 0.12); border: 1px solid rgba(74, 222, 128, 0.3); border-radius: 6px;">
            <div style="font-size: 11px; color: #aaa; margin-bottom: 2px;">
                Recommended Price (${rec.dow})
                <span style="color: ${confColor}; margin-left: 6px; font-weight: 600;">${rec.confidence}</span>
                ${costLabel}
            </div>
            <div style="font-size: 20px; font-weight: bold; color: #4ade80;">
                $${rec.price.toFixed(2)}
            </div>
            <div style="font-size: 11px; color: #aaa;">
                ${diffLabel} · ~${rec.predictedGallons.toLocaleString()} gal predicted
            </div>
        </div>
    `;
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
        const rec = computeRecommendedPrice(stationId, stationCompetitors);
        const rrRatingBadge = getRatingBadge(stationId, null);
        document.getElementById('station-address').innerHTML = `${station.address}${rrRatingBadge ? '<br>' + rrRatingBadge : ''}<br><strong style="color: #ffeb3b; font-size: 18px;">Your Price: ${priceText}</strong>${formatRecommendedPriceHTML(rec)}`;
        
        competitorsList.innerHTML = '';
        
        if (stationCompetitors.length === 0) {
            competitorsList.innerHTML = '<p class="no-competitors">No competitor data available</p>';
        } else {
            // Sort by distance and show ALL competitors
            const sortedCompetitors = [...stationCompetitors].sort((a, b) => a.distance - b.distance);
            
            sortedCompetitors.forEach((competitor, index) => {
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
                    <div class="competitor-name">${competitor.name} ${getRatingBadge(stationId, competitor.name)}</div>
                    <div class="competitor-price">$${competitor.price.toFixed(2)}</div>
                    <div class="competitor-difference">${diffText}</div>
                    <div class="competitor-distance">${competitor.distance.toFixed(1)} mi away</div>
                `;
                
                competitorsList.appendChild(competitorCard);
            });
        }
    } else {
        // Multiple stations selected - show all with their competitors
        document.getElementById('station-name').textContent = `${selectedStations.size} Stations Selected`;
        document.getElementById('station-address').innerHTML = `Scroll to see all competitors.`;
        
        competitorsList.innerHTML = '';
        
        // Sort stations by timestamp (most recent first) - reverse chronological order
        const sortedStations = Array.from(selectedStations.entries()).sort((a, b) => {
            const timestampA = a[1].timestamp || 0;
            const timestampB = b[1].timestamp || 0;
            return timestampB - timestampA; // Most recent first
        });
        
        sortedStations.forEach(([stationId, stationData], stationIndex) => {
            const station = stationData.station;
            const stationCompetitors = competitors[stationId] || [];
            const stationPrice = station.price || 0;
            
            // Create station header
            const stationHeader = document.createElement('div');
            stationHeader.style.cssText = `
                background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
                padding: 14px 16px;
                border-radius: 8px;
                margin-bottom: 12px;
                margin-top: ${stationIndex > 0 ? '24px' : '0'};
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
                // Move this station to the top by updating its timestamp
                const stationData = selectedStations.get(stationId);
                stationData.timestamp = Date.now();
                
                // Re-trigger update to show new order
                updatePanelForMultipleSelections();
                
                // Also update the notes section for this station
                updateNotesSection(station);
            };
            
            const priceText = stationPrice ? `$${stationPrice.toFixed(2)}` : 'N/A';
            const multiRec = computeRecommendedPrice(stationId, stationCompetitors);
            const multiRecHTML = multiRec ? `
                <div style="font-size: 12px; margin-bottom: 6px; color: #4ade80; font-weight: bold;">
                    Rec: $${multiRec.price.toFixed(2)}
                    <span style="font-weight: 400; color: #86efac; font-size: 10px; margin-left: 4px;">${multiRec.diffCents < 0 ? multiRec.diffCents : '+' + multiRec.diffCents}¢ vs avg · ~${multiRec.predictedGallons.toLocaleString()} gal</span>
                </div>
            ` : '';
            stationHeader.innerHTML = `
                <div style="font-weight: bold; font-size: 15px; margin-bottom: 6px; color: white; line-height: 1.3;">
                    ${station.name}
                </div>
                <div style="font-size: 13px; margin-bottom: 8px; color: #ffeb3b; font-weight: bold;">
                    Your Price: ${priceText}
                </div>
                ${multiRecHTML}
                <div style="font-size: 11px; opacity: 0.85; color: #bfdbfe;">
                    ${stationCompetitors.length} competitor${stationCompetitors.length !== 1 ? 's' : ''}  Click to move to top
                </div>
            `;
            
            competitorsList.appendChild(stationHeader);
            
            // Show competitors for this station
            if (stationCompetitors.length > 0) {
                const sortedCompetitors = [...stationCompetitors].sort((a, b) => a.distance - b.distance);
                
                
                sortedCompetitors.forEach((competitor, index) => {
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
                    
                    
                    
                    const priceDiff = competitor.price - stationPrice;
                    const diffText = priceDiff > 0 ? `+$${priceDiff.toFixed(2)}` : `-$${Math.abs(priceDiff).toFixed(2)}`;
                    
                    competitorCard.innerHTML = `
                        <div class="competitor-name">${competitor.name} ${getRatingBadge(stationId, competitor.name)}</div>
                        <div class="competitor-price">$${competitor.price.toFixed(2)}</div>
                        <div class="competitor-difference">${diffText}</div>
                        <div class="competitor-distance">${competitor.distance.toFixed(1)} mi away</div>
                    `;
                    
                    competitorsList.appendChild(competitorCard);
                });
                
                
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
    // Get all station IDs first
    const stationIds = Array.from(selectedStations.keys());
    
    // Remove all visuals WITHOUT updating the panel each time
    stationIds.forEach(stationId => {
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
        
        // Preserve checked state
        const isChecked = checkedStations.has(stationId);
        const checkedClass = isChecked ? 'checked' : '';
        
        // Get store number
        const storeNumber = getStoreNumber(station.name);
        const storeNumberBadge = storeNumber ? 
            `<div class="store-number-badge">${storeNumber}</div>` : '';
        
        marker.setIcon(L.divIcon({
            className: `fuel-marker ${checkedClass}`,
            html: `
                <div class="fuel-icon">${stationLogo}</div>
                ${storeNumberBadge}
                ${stationPriceBadge}
            `,
            iconSize: [30, 30],
            iconAnchor: [15, 30],
            popupAnchor: [0, -30]
        }));
    });
    
    // Clear all selections at once
    selectedStations.clear();
    
    // Hide notes section immediately
    updateNotesSection(null);
    
    // Then animate the panel closing
    competitorPanel.classList.remove('visible');
    
    
    competitorPanel.classList.remove('show');
    competitorPanel.style.display = 'none';
    
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
    const checkAllBtn = document.getElementById('check-all-btn');
    const uncheckAllBtn = document.getElementById('uncheck-all-btn');



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
    
    // Progress counter button listeners
    if (checkAllBtn) checkAllBtn.addEventListener('click', checkAllStations);
    if (uncheckAllBtn) uncheckAllBtn.addEventListener('click', uncheckAllStations);

    // ============================================
    // DATE SCRUBBER EVENT LISTENERS
    // ============================================
    
    const scrubberTrack = document.getElementById('scrubber-track');
    const scrubberThumb = document.getElementById('scrubber-thumb');
    
    let isDragging = false;
    let scrubAnimFrame = null; // rAF handle for throttling mousemove during scrub
    
    // Function to set date from scrubber position
    async function setDateFromPosition(clientX) {
        const rect = scrubberTrack.getBoundingClientRect();
        const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        
        const totalCount = getTotalTimestampCount();
        const targetIndex = Math.round(percentage * (totalCount - 1));
        
        const { dayIndex, timeIndex } = getIndicesFromAbsolute(targetIndex);
        
        // Only update if changed
        if (dayIndex !== currentDayIndex || timeIndex !== currentTimeIndex) {
            currentDayIndex = dayIndex;
            currentTimeIndex = timeIndex;
            
            const day = availableDays[currentDayIndex];
            currentDataFile = 'pricedata/' + filesByDate[day][currentTimeIndex].filename;
            
            updateDateDisplay();
            await loadDataForCurrentDate();
        }
    }
    
    // Mouse down on thumb - start dragging
    if (scrubberThumb) {
        scrubberThumb.addEventListener('mousedown', (e) => {
            isDragging = true;
            e.preventDefault();
        });
    }
    
    // Mouse move - drag (throttled to one update per animation frame)
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        if (scrubAnimFrame) return; // already scheduled for this frame
        scrubAnimFrame = requestAnimationFrame(() => {
            scrubAnimFrame = null;
            setDateFromPosition(e.clientX);
        });
    });
    
    // Mouse up - stop dragging and cancel any pending frame
    document.addEventListener('mouseup', () => {
        isDragging = false;
        if (scrubAnimFrame) {
            cancelAnimationFrame(scrubAnimFrame);
            scrubAnimFrame = null;
        }
    });
    
    // Click on track - jump to position
    if (scrubberTrack) {
        scrubberTrack.addEventListener('click', (e) => {
            if (e.target === scrubberTrack) {
                setDateFromPosition(e.clientX);
            }
        });
    }
    
    // Mouse wheel on scrubber - scroll through dates
    if (scrubberTrack) {
        scrubberTrack.addEventListener('wheel', async (e) => {
            e.preventDefault();
            
            // Scroll DOWN (positive deltaY) = go to PREVIOUS (older/backwards in time)
            // Scroll UP (negative deltaY) = go to NEXT (newer/forwards in time)
            if (e.deltaY > 0) {
                // Scroll down - go to previous date (backward in time)
                await goToPreviousDate();
            } else if (e.deltaY < 0) {
                // Scroll up - go to next date (forward in time)
                await goToNextDate();
            }
        }, { passive: false });
    }

    // Notes section event listeners
    const notesTextarea = document.getElementById('notes-textarea');
    const clearNoteBtn = document.getElementById('clear-note-btn');
    
    if (notesTextarea) {
        // Auto-save notes as user types (with debouncing)
        let saveTimeout;
        notesTextarea.addEventListener('input', function() {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                if (currentSelectedStationForNotes) {
                    saveStationNote(currentSelectedStationForNotes.id, notesTextarea.value);
                }
            }, 500); // Wait 500ms after user stops typing
        });
    }
    
    if (clearNoteBtn) {
        clearNoteBtn.addEventListener('click', clearCurrentNote);
    }

       // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Spacebar to close competitor panel (only if not typing in notes)
        if (e.key === ' ' || e.code === 'Space') {
            // Don't trigger if user is typing in the notes textarea
            const notesTextarea = document.getElementById('notes-textarea');
            if (notesTextarea && document.activeElement === notesTextarea) {
                return; // Allow normal spacebar behavior in textarea
            }
            
            if (selectedStations.size > 0) {
                e.preventDefault(); // Prevent page scroll
                hideCompetitorPanel();
            }
        }
    });

    // ============================================
    // COST TABLE EVENT LISTENERS
    // ============================================

    // Sorted store numbers — must match the order users paste from Excel
    const STORE_ORDER = [
        '118','132','136','139','140','141','144','145','157','181',
        '185','186','187','203','205','206','209','210','211','225',
        '226','235','236','240','242','263','265','266','268','269',
        '270','271','272','273','275','276','277','278','279','280',
        '281','282','283','284','285','286','287','289','290','312',
        '315','319','323'
    ];

    const applyCostsBtn = document.getElementById('apply-costs-btn');
    const clearCostsBtn = document.getElementById('clear-costs-btn');
    const marginBufferSel = document.getElementById('margin-buffer');
    const costPasteArea = document.getElementById('cost-paste-area');
    const costTableBody = document.getElementById('cost-table-body');
    const costStatus = document.getElementById('cost-status');

    function applyCosts() {
        const raw = costPasteArea.value.trim();
        if (!raw) {
            costStatus.textContent = 'Paste cost data first.';
            costStatus.style.color = '#f87171';
            return;
        }

        // Parse pasted values — one number per line, may have $ signs or commas
        const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        const values = lines.map(l => parseFloat(l.replace(/[$,]/g, '')));

        if (values.length > STORE_ORDER.length) {
            costStatus.textContent = `Too many values (${values.length}). Expected up to ${STORE_ORDER.length}.`;
            costStatus.style.color = '#f87171';
            return;
        }

        // Read margin buffer
        marginBuffer = parseFloat(marginBufferSel.value) || 0;

        // Map values to store numbers
        storeCosts = {};
        let validCount = 0;
        values.forEach((val, i) => {
            if (!isNaN(val) && val > 0 && i < STORE_ORDER.length) {
                storeCosts[STORE_ORDER[i]] = val;
                validCount++;
            }
        });

        // Build table
        costTableBody.innerHTML = '';
        STORE_ORDER.forEach((storeNum, i) => {
            const cost = storeCosts[storeNum];
            if (cost === undefined) return; // skip stores without cost data

            // Find current price from map data
            const station = stations.find(s => getStoreNumber(s.name) === storeNum);
            const currentPrice = station ? station.price : null;
            const margin = currentPrice ? (currentPrice - cost).toFixed(2) : '—';
            const marginColor = currentPrice && (currentPrice - cost) > 0 ? '#4ade80' : '#f87171';

            // Compute recommended price for this store
            const stationId = station ? station.id.toString() : '';
            const stationComps = station ? (competitors[stationId] || []) : [];
            const rec = station ? computeRecommendedPrice(stationId, stationComps) : null;
            const recText = rec ? `$${rec.price.toFixed(2)}` : '—';
            const recColor = rec ? '#4ade80' : '#666';

            const tr = document.createElement('div');
            tr.style.cssText = 'display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; border-bottom: 1px solid #2a2a2a;';
            tr.innerHTML = `
                <div style="padding: 4px 8px; color: #ddd; font-size: 11px;">RR ${storeNum}</div>
                <div style="padding: 4px 8px; text-align: right; color: #ffeb3b; font-size: 11px;">$${currentPrice ? currentPrice.toFixed(2) : '—'}</div>
                <div style="padding: 4px 8px; text-align: right; color: #4ade80; font-family: monospace; font-size: 11px;">$${cost.toFixed(2)}</div>
                <div style="padding: 4px 8px; text-align: right; color: ${marginColor}; font-family: monospace; font-size: 11px;">$${margin}</div>
                <div style="padding: 4px 8px; text-align: right; color: ${recColor}; font-weight: 600; font-size: 11px;">${recText}</div>
            `;
            costTableBody.appendChild(tr);
        });

        costStatus.textContent = `Applied costs for ${validCount} stores with $${marginBuffer.toFixed(2)} margin buffer. Click any store on the map to see updated recommendations.`;
        costStatus.style.color = '#4ade80';

        // If a station is currently selected, refresh the panel
        if (selectedStations.size > 0) {
            updatePanelForMultipleSelections();
        }
    }

    function clearCosts() {
        storeCosts = {};
        marginBuffer = parseFloat(marginBufferSel.value) || 0;
        costPasteArea.value = '';
        costTableBody.innerHTML = '<div style="padding: 20px 12px; text-align: center; color: #555; font-size: 11px;">Paste cost data and click "Apply Costs" to populate</div>';
        costStatus.textContent = 'Costs cleared. Using estimated margins.';
        costStatus.style.color = '#888';

        // Refresh panel if open
        if (selectedStations.size > 0) {
            updatePanelForMultipleSelections();
        }
    }

    if (applyCostsBtn) applyCostsBtn.addEventListener('click', applyCosts);
    if (clearCostsBtn) clearCostsBtn.addEventListener('click', clearCosts);
    if (marginBufferSel) {
        marginBufferSel.addEventListener('change', function() {
            marginBuffer = parseFloat(this.value) || 0;
            // Re-apply if we have costs
            if (Object.keys(storeCosts).length > 0) {
                applyCosts();
            }
        });
    }

    // Load ratings and manifest/initial data in parallel
    loadRatings();
    loadManifest();
});
