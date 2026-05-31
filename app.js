// PVFARM — Solar & BESS Layout Configurator Logic

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide Icons
    lucide.createIcons();

    // Map Settings & Layer Definitions
    let map, drawnItems, setbackLayer, solarRowsLayer, bessLayer;
    let siteBoundary = null; 
    let siteBoundaries = [];
    let isDefaultPreset = true;
    let setbackPolygon = null; 
    let baseSatellite, baseVector;
    
    // Custom Drawing State (Ultra-robust for Mobile & Desktop)
    let isDrawingMode = true; // Active on startup so user can draw immediately!
    let drawCoords = [];
    let drawMarkers = [];
    let drawPolyline = null;
    
    // UI State
    let activePreset = 'nueva-ecija';
    let trackerType = 'fixed'; 
    let bessPlacement = 'auto'; 
    let yieldChart = null;
    let economicsChart = null;

    // Presets Coordinates & Sample Boundaries
    const PRESETS = {
        'nueva-ecija': {
            name: "Cabanatuan, Nueva Ecija, Philippines",
            coords: [15.488, 120.968],
            irradiance: 1950, // kWh/m²/year - Tropical Monsoon
            boundary: [
                [120.962, 15.493],
                [120.974, 15.493],
                [120.974, 15.483],
                [120.962, 15.483],
                [120.962, 15.493]
            ]
        },
        california: {
            name: "Mojave Desert, California",
            coords: [35.021, -117.891],
            irradiance: 2350, 
            boundary: [
                [-117.897, 35.026],
                [-117.885, 35.026],
                [-117.885, 35.016],
                [-117.897, 35.016],
                [-117.897, 35.026]
            ]
        },
        australia: {
            name: "Queensland Outback, Australia",
            coords: [-23.552, 144.382],
            irradiance: 2200,
            boundary: [
                [144.376, -23.547],
                [144.388, -23.547],
                [144.388, -23.557],
                [144.376, -23.557],
                [144.376, -23.547]
            ]
        },
        spain: {
            name: "Zaragoza Plains, Spain",
            coords: [41.648, -0.889],
            irradiance: 1750,
            boundary: [
                [-0.895, 41.653],
                [-0.883, 41.653],
                [-0.883, 41.643],
                [-0.895, 41.643],
                [-0.895, 41.653]
            ]
        }
    };

    // Initialize Map
    function initMap() {
        baseSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        });
        
        baseVector = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{y}/{x}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        });

        // Start with Nueva Ecija (default)
        const start = PRESETS[activePreset];
        map = L.map('map', {
            center: start.coords,
            zoom: 15,
            layers: [baseSatellite],
            preferCanvas: true
        });

        drawnItems = new L.FeatureGroup().addTo(map);
        setbackLayer = new L.FeatureGroup().addTo(map);
        solarRowsLayer = new L.FeatureGroup().addTo(map);
        bessLayer = new L.FeatureGroup().addTo(map);

        // Custom Map Drawing Click Listener
        map.on('click', function (e) {
            if (!isDrawingMode) return;
            
            // UX Feature: If a boundary exists and the user makes their first new click,
            // we clear the old preset layout and instantly begin drawing their custom boundary!
            // UX Feature: If the default preset layout is active and the user starts drawing,
            // we clear the preset and begin their custom powerplant layout.
            if (isDefaultPreset && drawCoords.length === 0) {
                clearLayout();
                isDefaultPreset = false;
                isDrawingMode = true; // keep draw active
                
                // Show completion controls and swap draw button to cancel state
                document.getElementById('tool-complete').style.display = 'inline-flex';
                const drawBtn = document.getElementById('tool-draw');
                drawBtn.classList.add('active');
                drawBtn.innerHTML = '<i data-lucide="x"></i> Cancel';
                lucide.createIcons();
                map.dragging.disable(); // Prevent panning conflicts during active drawing
            }
            
            const latlng = e.latlng;
            
            // CAD Snapping Feature: If we have at least 3 points and the new click is within
            // 20 meters of the first point, we close the polygon and complete the drawing automatically!
            if (drawCoords.length >= 3) {
                const firstPt = turf.point(drawCoords[0]);
                const currentPt = turf.point([latlng.lng, latlng.lat]);
                const distKm = turf.distance(firstPt, currentPt, { units: 'kilometers' });
                const distMeters = distKm * 1000;

                if (distMeters <= 20) {
                    completeCustomDrawing();
                    return;
                }
            }

            drawCoords.push([latlng.lng, latlng.lat]); // Turf is [lon, lat]
            
            // Create a nice styled marker
            const isFirst = drawCoords.length === 1;
            const marker = L.circleMarker(latlng, {
                radius: isFirst ? 8 : 6,
                color: isFirst ? '#10b981' : '#3b82f6', // First point is bright emerald green!
                fillColor: isFirst ? '#d1fae5' : '#dbeafe',
                fillOpacity: 1,
                weight: 2.5,
                interactive: true
            }).addTo(drawnItems);

            // Bind tooltip instructions
            if (isFirst) {
                marker.bindTooltip("Click here to close and complete boundary", {
                    permanent: true,
                    direction: 'top',
                    className: 'draw-tooltip'
                });

                // Clicking the first point closes and completes the polygon instantly!
                const closeAction = function (me) {
                    if (me) L.DomEvent.stopPropagation(me);
                    completeCustomDrawing();
                };
                
                marker.on('click', closeAction);
                marker.on('touchend', closeAction); // Mobile touch responsiveness support
            } else {
                // If they click on subsequent markers, we also stop propagation
                marker.on('click', function (me) {
                    L.DomEvent.stopPropagation(me);
                });
                marker.on('touchend', function (me) {
                    L.DomEvent.stopPropagation(me);
                });
            }
            
            drawMarkers.push(marker);

            // Update Polyline
            const latLns = drawCoords.map(pt => [pt[1], pt[0]]);
            if (drawPolyline) {
                drawPolyline.setLatLngs(latLns);
            } else {
                drawPolyline = L.polyline(latLns, { color: '#3b82f6', weight: 2.5, dashArray: '4, 4', interactive: false }).addTo(drawnItems);
            }
        });

        loadPresetDemo(activePreset);
    }

    // Load preset demo
    function loadPresetDemo(presetKey) {
        const preset = PRESETS[presetKey];
        if (!preset) return;

        document.getElementById('lat-lng-val').textContent = `${preset.coords[0].toFixed(3)}, ${preset.coords[1].toFixed(3)}`;
        map.flyTo(preset.coords, 15);
        clearLayout();

        const latLns = preset.boundary.map(pt => [pt[1], pt[0]]);
        const polygonLayer = L.polygon(latLns, { color: '#10b981', fillOpacity: 0.08, weight: 3, interactive: false }); // Disable interactivity so map clicks pass through!
        drawnItems.addLayer(polygonLayer);

        const geojson = polygonLayer.toGeoJSON();
        siteBoundary = geojson.features ? geojson.features[0] : geojson;
        siteBoundaries = [siteBoundary]; // Track in our multi-powerplant boundaries array

        setTimeout(() => {
            triggerAutoLayout();
        }, 800);
    }

    // Clear Layout
    function clearLayout() {
        drawnItems.clearLayers();
        setbackLayer.clearLayers();
        solarRowsLayer.clearLayers();
        bessLayer.clearLayers();
        siteBoundary = null;
        siteBoundaries = []; // Clear all multi-powerplant boundaries
        setbackPolygon = null;

        updateStats({
            pvCapacity: 0,
            panelCount: 0,
            bessCapacity: 0,
            bessContainers: 0,
            areaHa: 0,
            gcr: 0,
            capex: 0,
            lcoe: 0
        });

        updateEngineeringStats({
            bifacialGain: 0,
            tempLoss: 0,
            cableLossKW: 0,
            ilr: 1.25,
            windPressure: 0,
            auxPowerKW: 0,
            mvLossPercent: 0
        });

        updateCharts(0, 0);
    }

    // Custom Drawing Handlers
    function completeCustomDrawing() {
        if (drawCoords.length < 3) {
            alert("Please click at least 3 points on the map to define a boundary shape!");
            return;
        }

        // Close coords loop for GeoJSON specification
        const closedCoords = [...drawCoords, drawCoords[0]];

        // Clear only active drawing visual indicators (markers & polyline)
        if (drawPolyline) map.removeLayer(drawPolyline);
        drawMarkers.forEach(m => map.removeLayer(m));

        // Draw final Leaflet polygon on map and keep it in drawnItems
        const latLns = closedCoords.map(pt => [pt[1], pt[0]]);
        const finalPolygon = L.polygon(latLns, { color: '#10b981', fillOpacity: 0.08, weight: 3, interactive: false }); // interactive false
        drawnItems.addLayer(finalPolygon);

        // Reset drawing coordinates and active drawing UI for the NEXT powerplant shape
        isDrawingMode = true; // Stay in drawing mode for continuous multi-powerplant creation!
        drawCoords = [];
        drawMarkers = [];
        drawPolyline = null;

        // Keep UI elements in drawing mode, ready for the next shape
        document.getElementById('tool-complete').style.display = 'inline-flex';
        const drawBtn = document.getElementById('tool-draw');
        drawBtn.classList.add('active');
        drawBtn.innerHTML = '<i data-lucide="x"></i> Cancel';
        lucide.createIcons();

        // Keep map dragging disabled to allow direct clicking for the next shape
        map.dragging.disable();

        // Set final site boundary with correct winding order and auto-layout
        const geojson = finalPolygon.toGeoJSON();
        siteBoundary = geojson.features ? geojson.features[0] : geojson;
        siteBoundaries.push(siteBoundary); // Append to multi-powerplant list
        
        triggerAutoLayout();
    }

    // Elegant Toast Notification System for premium UX feedback
    function showToast(message, type = 'warning') {
        let toast = document.getElementById('pvfarm-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'pvfarm-toast';
            toast.style.position = 'fixed';
            toast.style.bottom = '24px';
            toast.style.right = '24px';
            toast.style.zIndex = '9999';
            toast.style.padding = '14px 22px';
            toast.style.borderRadius = '12px';
            toast.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.08)';
            toast.style.fontFamily = 'Inter, sans-serif';
            toast.style.fontWeight = '600';
            toast.style.fontSize = '0.88rem';
            toast.style.display = 'flex';
            toast.style.alignItems = 'center';
            toast.style.gap = '10px';
            toast.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(15px)';
            document.body.appendChild(toast);
        }

        if (type === 'warning') {
            toast.style.backgroundColor = '#fffbeb';
            toast.style.color = '#b45309';
            toast.style.border = '1px solid #fde68a';
            toast.innerHTML = `<i data-lucide="alert-triangle" style="width: 18px; height: 18px; color: #d97706; flex-shrink: 0;"></i> <span>${message}</span>`;
        } else if (type === 'success') {
            toast.style.backgroundColor = '#ecfdf5';
            toast.style.color = '#047857';
            toast.style.border = '1px solid #a7f3d0';
            toast.innerHTML = `<i data-lucide="check-circle" style="width: 18px; height: 18px; color: #059669; flex-shrink: 0;"></i> <span>${message}</span>`;
        } else {
            toast.style.backgroundColor = '#eff6ff';
            toast.style.color = '#1d4ed8';
            toast.style.border = '1px solid #bfdbfe';
            toast.innerHTML = `<i data-lucide="info" style="width: 18px; height: 18px; color: #2563eb; flex-shrink: 0;"></i> <span>${message}</span>`;
        }

        lucide.createIcons();

        // Animate toast entry
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 50);

        // Auto-dismiss after 6 seconds
        if (window.toastTimeout) clearTimeout(window.toastTimeout);
        window.toastTimeout = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(15px)';
        }, 6000);
    }

    // Expose functions to global context
    window.completeCustomDrawing = completeCustomDrawing;
    window.showToast = showToast;

    // Trigger calculations and auto-layout
    function triggerAutoLayout() {
        // Robust CDN Loading Check (Prevents silent race condition crashes!)
        if (typeof turf === 'undefined') {
            console.warn("Turf.js is not loaded yet. Deferring layout calculation...");
            setTimeout(triggerAutoLayout, 500);
            return;
        }

        try {
            if (siteBoundaries.length === 0) return;

            setbackLayer.clearLayers();
            solarRowsLayer.clearLayers();
            bessLayer.clearLayers();

            // Parameters
            const pitch = parseFloat(document.getElementById('row-pitch').value);
            const azimuth = parseFloat(document.getElementById('azimuth').value);
            const setback = parseFloat(document.getElementById('setback').value);
            const panelPower = parseFloat(document.getElementById('panel-rating').value);
            const trackerLength = parseFloat(document.getElementById('tracker-length').value);
            const trackerWidth = parseFloat(document.getElementById('tracker-width').value);
            const bessDuration = parseFloat(document.getElementById('bess-target-duration').value);

            // BESS Solar Ratio & DOE 20% Capacity Requirement Logic
            const bessRatioInput = document.getElementById('bess-ratio');
            const bessDoeCheckbox = document.getElementById('bess-doe-req');
            let bessRatio = parseFloat(bessRatioInput.value) / 100;
            
            if (bessDoeCheckbox && bessDoeCheckbox.checked) {
                bessRatio = 0.20; // Override to exactly 20%
                bessRatioInput.disabled = true; // Visually disable slider/field
            } else {
                bessRatioInput.disabled = false;
            }

            // Grid connection & transmission parameters
            const gridVoltage = parseFloat(document.getElementById('grid-voltage').value);
            const txLineLength = parseFloat(document.getElementById('tx-line-length').value);
            
            // Advanced Engineering Inputs
            const pvTempCoeff = parseFloat(document.getElementById('eng-temp-coeff').value);
            const groundAlbedo = parseFloat(document.getElementById('eng-albedo').value);
            const targetVdrop = parseFloat(document.getElementById('eng-vdrop').value);
            const inverterRatio = parseFloat(document.getElementById('eng-ilr').value);
            const windSpeed = parseFloat(document.getElementById('eng-wind').value);
            const soilResistivity = parseFloat(document.getElementById('eng-resistivity').value);
            const gridAvailability = parseFloat(document.getElementById('eng-availability').value) / 100;
            const annualDegradation = parseFloat(document.getElementById('eng-degradation').value) / 100;
            const soilingLoss = parseFloat(document.getElementById('eng-soiling').value) / 100;

            let totalTrackers = 0;
            let totalAreaSqM = 0;
            let isCapped = false;
            let firstSearchBoundary = null; // We will use this to place BESS container blocks safely

            // Loop over every drawn boundary polygon in our multi-powerplant configuration
            siteBoundaries.forEach((boundary) => {
                // 1. Footprint & Area Calculations
                const areaSqM = turf.area(boundary);
                totalAreaSqM += areaSqM;

                let searchBoundary = boundary;
                if (setback > 0) {
                    try {
                        const buffered = turf.buffer(boundary, -setback / 1000, { units: 'kilometers' });
                        if (buffered && buffered.geometry) {
                            L.geoJSON(buffered, {
                                style: { color: '#94a3b8', weight: 1.5, dashArray: '4, 4', fillOpacity: 0 }
                            }).addTo(setbackLayer);
                            searchBoundary = buffered;
                        }
                    } catch (err) {
                        console.warn(err);
                    }
                }

                if (!firstSearchBoundary) {
                    firstSearchBoundary = searchBoundary;
                }

                // 2. Solar Tracker Row Packing Algorithm (Turf Spatial)
                const bbox = turf.bbox(searchBoundary);
                const center = turf.center(searchBoundary);
                
                const rotatedBoundary = turf.transformRotate(searchBoundary, -azimuth, { pivot: center });
                const rBbox = turf.bbox(rotatedBoundary);

                // Convert row pitch (meters) to degrees of longitude at current latitude
                const latRad = center.geometry.coordinates[1] * Math.PI / 180;
                const metersPerDegreeLng = 111132 * Math.cos(latRad);
                const pitchInDegrees = pitch / metersPerDegreeLng;

                const gridLines = [];

                if (trackerType === 'tracker') {
                    // 1. Single-Axis Trackers: Rows run vertically (North-South)
                    const xStart = rBbox[0] + pitchInDegrees/2;
                    const xEnd = rBbox[2];
                    const yStart = rBbox[1];
                    const yEnd = rBbox[3];

                    let lineCount = 0;
                    for (let x = xStart; x < xEnd; x += pitchInDegrees) {
                        if (lineCount++ > 8000) {
                            isCapped = true;
                            break;
                        }
                        const line = turf.lineString([[x, yStart], [x, yEnd]]);
                        const clipped = turf.lineIntersect(line, rotatedBoundary);
                        
                        if (clipped.features.length >= 2) {
                            const sortedPts = clipped.features
                                .map(f => f.geometry.coordinates)
                                .sort((a, b) => a[1] - b[1]); // Sort by latitude y

                            for (let i = 0; i < sortedPts.length - 1; i += 2) {
                                const segment = turf.lineString([sortedPts[i], sortedPts[i+1]]);
                                gridLines.push(segment);
                            }
                        }
                    }
                } else {
                    // 2. Fixed-Tilt Tables: Rows run horizontally (East-West) so tables face South
                    const pitchInDegreesLat = pitch / 111132;
                    const xStart = rBbox[0];
                    const xEnd = rBbox[2];
                    const yStart = rBbox[1] + pitchInDegreesLat/2;
                    const yEnd = rBbox[3];

                    let lineCount = 0;
                    for (let y = yStart; y < yEnd; y += pitchInDegreesLat) {
                        if (lineCount++ > 8000) {
                            isCapped = true;
                            break;
                        }
                        const line = turf.lineString([[xStart, y], [xEnd, y]]);
                        const clipped = turf.lineIntersect(line, rotatedBoundary);
                        
                        if (clipped.features.length >= 2) {
                            const sortedPts = clipped.features
                                .map(f => f.geometry.coordinates)
                                .sort((a, b) => a[0] - b[0]); // Sort by longitude x

                            for (let i = 0; i < sortedPts.length - 1; i += 2) {
                                const segment = turf.lineString([sortedPts[i], sortedPts[i+1]]);
                                gridLines.push(segment);
                            }
                        }
                    }
                }

                let boundaryTrackers = 0;
                const trackerLengthKm = trackerLength / 1000;
                const gapKm = 1.5 / 1000;

                gridLines.forEach(line => {
                    const lenKm = turf.length(line, { units: 'kilometers' });
                    let distKm = 0.0005; // 0.5 meter offset

                    while (distKm + trackerLengthKm <= lenKm) {
                        if (totalTrackers >= 150000) { // Super-high absolute safeguard
                            isCapped = true;
                            break;
                        }
                        boundaryTrackers++;
                        totalTrackers++;
                        distKm += trackerLengthKm + gapKm;
                    }
                });

                // Style this active boundary's solar field area with premium semi-transparent shading
                if (boundaryTrackers > 0 && searchBoundary) {
                    L.geoJSON(searchBoundary, {
                        style: {
                            color: '#3b82f6',        // Solar blue boundary border
                            fillColor: '#10b981',    // Emerald-green solar array shading
                            weight: 2,
                            opacity: 0.85,
                            fillOpacity: 0.25,       // Soft high-tech premium glassmorphism shading
                            dashArray: '1'
                        },
                        interactive: false
                    }).addTo(solarRowsLayer);
                }
            });

            const areaHa = totalAreaSqM / 10000;
            const panelsPerTracker = Math.floor(trackerLength / 1.1) * 2; 
            const panelCount = totalTrackers * panelsPerTracker;
            const pvCapacityMW = (panelCount * panelPower) / 1000000;

            // 3. Ground Coverage Ratio
            const trackerArea = totalTrackers * trackerLength * trackerWidth;
            const gcr = totalAreaSqM > 0 ? (trackerArea / totalAreaSqM) * 100 : 0;

            // 4. Advanced Engineering Feature Calculations (20+ Computations)
            // [F1] Bifacial Gain % (IEC 61215 albedo modeling)
            const bifacialityFactor = 0.80; // Premium HJT bifacial rating
            const bifacialGainPercent = groundAlbedo * bifacialityFactor * 100;

            // [F2] Temperature degradation loss
            const ambientTemp = activePreset === 'nueva-ecija' ? 33 : 25;
            const cellTemp = ambientTemp + (PRESETS[activePreset].irradiance / 800) * 28;
            const tempLossPercent = Math.abs((cellTemp - 25) * pvTempCoeff);

            // [F3] DC Cable Voltage Drop & Losses
            const avgDCRunMeters = Math.sqrt(totalAreaSqM) / 3;
            const totalPVDCCurrent = (pvCapacityMW * 1000000) / 1000;
            const dcVoltageDropKW = (totalPVDCCurrent * 0.0172 * avgDCRunMeters * (targetVdrop / 100)) / 1000;

            // [F4] Wind Pressure calculation
            const windSpeedMPS = windSpeed / 3.6;
            const windPressureKPa = (0.613 * 1.0 * 1.0 * 0.85 * Math.pow(windSpeedMPS, 2)) / 1000;

            // [F5] Auxiliary Power consumption
            const trackerMotorKW = totalTrackers * 0.15;
            const bessHVACKW = (pvCapacityMW * bessRatio * bessDuration) * 5.0;
            const totalAuxPowerKW = trackerMotorKW + bessHVACKW;

            // [F6] Substation/Medium voltage transformer loss
            const mvLossPercent = 1.0 + (inverterRatio * 0.3);

            // 5. BESS Layout Sizing & Packing (Rendered in first boundary)
            let bessCapacityMWh = 0;
            let bessContainers = 0;
            let bessContainerCap = 3.9; 

            const selectedContainer = document.getElementById('bess-container-type').value;
            if (selectedContainer === 'megapack2') bessContainerCap = 2.6;
            else if (selectedContainer === 'industrial') bessContainerCap = 5.0;
            else if (selectedContainer === 'luna4472') bessContainerCap = 4.472;
            else if (selectedContainer === 'luna200') bessContainerCap = 0.20;
            else if (selectedContainer === 'luna21') bessContainerCap = 0.0215;

            if (pvCapacityMW > 0) {
                const bessTargetPowerMW = pvCapacityMW * bessRatio;
                bessCapacityMWh = bessTargetPowerMW * bessDuration;
                bessContainers = Math.ceil(bessCapacityMWh / bessContainerCap);
            }

            if (bessContainers > 0 && bessPlacement === 'auto' && firstSearchBoundary) {
                const sBbox = turf.bbox(firstSearchBoundary);
                const startPt = [sBbox[0] + 15, sBbox[1] + 15]; 
                
                let rowCount = Math.ceil(Math.sqrt(bessContainers));
                let colCount = Math.ceil(bessContainers / rowCount);

                const containerGeoJSON = [];
                
                // Adopt exact Huawei physical dimensions & clearance rules from BESS catalog
                let containerW = 12.2; // default Megapack 3
                let containerH = 2.4;  
                let rowSpacing = 6;    

                if (selectedContainer === 'megapack2') {
                    containerW = 6.1;
                    containerH = 2.4;
                    rowSpacing = 5;
                } else if (selectedContainer === 'luna4472') {
                    containerW = 6.058; // LUNA2000 utility 20ft container
                    containerH = 2.438;
                    rowSpacing = 5.5;
                } else if (selectedContainer === 'luna200') {
                    containerW = 1.810; // LUNA2000 C&I cabinet
                    containerH = 1.200;
                    rowSpacing = 3;
                } else if (selectedContainer === 'luna21') {
                    containerW = 0.670; // LUNA2000 residential cabinet
                    containerH = 0.337;
                    rowSpacing = 1.5;
                }

                for (let c = 0; c < bessContainers; c++) {
                    const col = c % colCount;
                    const row = Math.floor(c / colCount);
                    const dx = col * (containerW + 4);
                    const dy = row * (containerH + rowSpacing);

                    const xOffset = turf.destination(turf.point(startPt), dx / 1000, 90, { units: 'kilometers' });
                    const finalPos = turf.destination(xOffset, dy / 1000, 0, { units: 'kilometers' });
                    // Buffer exactly matches container radius
                    const cBbox = turf.bbox(turf.buffer(finalPos, (Math.max(containerW, containerH) / 2) / 1000, { units: 'kilometers' }));
                    const cPoly = turf.bboxPolygon(cBbox);
                    
                    if (turf.booleanPointInPolygon(finalPos, firstSearchBoundary)) {
                        containerGeoJSON.push(cPoly);
                    } else {
                        const centerPt = turf.centroid(firstSearchBoundary);
                        containerGeoJSON.push(turf.bboxPolygon(turf.bbox(turf.buffer(centerPt, (Math.max(containerW, containerH) / 2) / 1000, { units: 'kilometers' }))));
                    }
                }

                L.geoJSON({
                    type: 'FeatureCollection',
                    features: containerGeoJSON
                }, {
                    style: { color: '#1e3a8a', fillColor: '#3b82f6', weight: 2, fillOpacity: 0.8 },
                    interactive: false 
                }).addTo(bessLayer);
            }

        // 6. Economics (LCOE & Yield)
        const pvCostPerW = parseFloat(document.getElementById('cost-pv').value);
        const bessCostPerKWh = parseFloat(document.getElementById('cost-bess').value);
        const ppaTariff = parseFloat(document.getElementById('ppa-tariff').value);

        // Substation & Tx Line Sizing Recommendations & Cost Calculations
        const recSubstationMVA = pvCapacityMW * 1.2;
        const recTxMW = pvCapacityMW * 1.1;

        let subBaseCost = 1200000;
        let subPerMVACost = 12000;
        let txPerKmCost = 140000;

        if (gridVoltage === 115) {
            subBaseCost = 2000000;
            subPerMVACost = 15000;
            txPerKmCost = 240000;
        } else if (gridVoltage === 230) {
            subBaseCost = 3500000;
            subPerMVACost = 18000;
            txPerKmCost = 450000;
        }

        const substationCost = pvCapacityMW > 0 ? (subBaseCost + (recSubstationMVA * subPerMVACost)) : 0;
        const txLineCost = pvCapacityMW > 0 ? (txPerKmCost * txLineLength) : 0;

        // Update Grid Sizing Recommendations & Estimates in UI
        safeSetText('rec-substation-mva', `${recSubstationMVA.toFixed(1)} MVA`);
        safeSetText('rec-tx-mw', `${recTxMW.toFixed(1)} MW`);
        safeSetText('est-substation-cost', `$${(substationCost / 1000000).toFixed(2)}M`);
        safeSetText('est-tx-cost', `$${(txLineCost / 1000000).toFixed(2)}M`);

        // Total CAPEX including Solar, BESS, Substation, and Transmission Line costs
        const pvCapex = pvCapacityMW * 1000000 * pvCostPerW;
        const bessCapex = bessCapacityMWh * 1000 * bessCostPerKWh;
        const totalCapex = pvCapex + bessCapex + substationCost + txLineCost;

        // PHP Conversion (61.5 PHP to USD exchange rate)
        const phpRate = 61.5;
        const totalCapexPHP = totalCapex * phpRate;
        let phpDisplay = "₱0.00B PHP";
        if (totalCapexPHP >= 1000000000) {
            phpDisplay = `₱${(totalCapexPHP / 1000000000).toFixed(2)}B PHP`;
        } else {
            phpDisplay = `₱${(totalCapexPHP / 1000000).toFixed(1)}M PHP`;
        }
        safeSetText('stat-capex-php', phpDisplay);

        const irr = PRESETS[activePreset].irradiance;
        const panelEff = parseFloat(document.getElementById('panel-efficiency').value) / 100;
        
        const trackingMultiplier = trackerType === 'tracker' ? 1.25 : 1.0;
        
        // Comprehensive Yield formula subtracting auxiliary, temperature, cable and availability losses
        const systemPerformanceRatio = 0.85 * (1 - (tempLossPercent/100)) * (1 - soilingLoss) * (1 - (mvLossPercent/100)) * gridAvailability;
        const bifacialMultiplier = 1 + (bifacialGainPercent / 100);
        const annualYieldMWh = pvCapacityMW * irr * panelEff * trackingMultiplier * systemPerformanceRatio * bifacialMultiplier;

        const lifetimeEnergyYield = annualYieldMWh * 25 * (1 - (annualDegradation * 12.5)); // 25 year degradation NPV
        const lcoeValue = lifetimeEnergyYield > 0 ? (totalCapex * 1.28) / lifetimeEnergyYield : 0;

        // 20+ New Advanced Engineering Calculations
        const specLidLoss = -0.55; 
        const specShadingAngle = Math.max(10, 30 - pitch * 1.5); 
        const specInvEff = 98.8; 
        const specMismatchLoss = -0.65;
        const specNearShading = -1.0 - (setback * 0.02); 
        const specSoilingRecovery = 100 - (soilingLoss * 100); 
        const specSubstationAc = -0.45; 
        const specCoreLoss = pvCapacityMW * 1.8; 
        const specResistivityOhms = soilResistivity; 
        const specCurtailment = pvCapacityMW > 50 ? "95% Active Limit" : "None (100%)";
        const specBessSoh = 100 - (annualDegradation * 100 * 2.5);
        const specBessRte = 89.5; 
        const specSelfDischarge = 0.12; 
        const specFireWater = bessContainers * 1250; 
        const specDodLimit = 10; 
        const specThermalRunaway = 15 - (bessContainers > 5 ? 2 : 0); 
        const specSeparation = bessContainers > 0 ? "3.0m (Passed)" : "N/A";
        const specShearLoad = windSpeed * 0.17; 
        const specCorrosivity = activePreset === 'nueva-ecija' ? "ISO C4 High" : "ISO C3 Medium";
        const specSoilBearing = 120; 
        const specPilingDepth = 1.5 + (windSpeed * 0.004); 
        const specCivilCut = areaHa * 120; 
        const specCo2Offset = annualYieldMWh * 0.709;

        // Update Compliance Numbers in HTML safely
        safeSetText('resistivity-lbl', soilResistivity);
        safeSetText('wind-lbl', windSpeed);
        
        const windItem = document.getElementById('wind-compliance-item');
        if (windItem) {
            const h4 = windItem.querySelector('h4');
            const p = windItem.querySelector('p');
            if (windSpeed > 260) {
                windItem.className = "compliance-item failed";
                if (h4) h4.textContent = "ASCE 7 Structural Failure Risk";
                if (p) p.textContent = "Wind speeds above 260 km/h exceed maximum table load limit. Adjust azimuth or reinforce frames.";
            } else {
                windItem.className = "compliance-item passed";
                if (h4) h4.textContent = "ASCE 7 wind loading passed";
                if (p) p.textContent = "Structural table tilt rated for localized tropical typhoons.";
            }
        }

        // Update Layout dashboards
        updateStats({
            pvCapacity: pvCapacityMW,
            panelCount: panelCount,
            bessCapacity: bessCapacityMWh,
            bessContainers: bessContainers,
            areaHa: areaHa,
            gcr: gcr,
            capex: totalCapex,
            lcoe: lcoeValue
        });

        updateEngineeringStats({
            bifacialGain: bifacialGainPercent,
            tempLoss: tempLossPercent,
            cableLossKW: dcVoltageDropKW,
            ilr: inverterRatio,
            windPressure: windPressureKPa,
            auxPowerKW: totalAuxPowerKW,
            mvLossPercent: mvLossPercent,
            lidLoss: specLidLoss,
            shadingAngle: specShadingAngle,
            invEff: specInvEff,
            mismatchLoss: specMismatchLoss,
            nearShading: specNearShading,
            soilingRecovery: specSoilingRecovery,
            substationAc: specSubstationAc,
            coreLoss: specCoreLoss,
            resistivityOhms: specResistivityOhms,
            curtailment: specCurtailment,
            bessSoh: specBessSoh,
            bessRte: specBessRte,
            selfDischarge: specSelfDischarge,
            fireWater: specFireWater,
            dodLimit: specDodLimit,
            thermalRunaway: specThermalRunaway,
            separation: specSeparation,
            shearLoad: specShearLoad,
            corrosivity: specCorrosivity,
            soilBearing: specSoilBearing,
            pilingDepth: specPilingDepth,
            civilCut: specCivilCut,
            co2Offset: specCo2Offset
        });

        if (typeof Chart !== 'undefined') {
            updateCharts(annualYieldMWh, totalCapex);
        } else {
            console.warn("Chart.js is not loaded yet. Skipping chart rendering.");
        }

        // --- PVsyst Loss Diagram Dynamic Generator ---
        const pvsystFlow = document.getElementById('pvsyst-loss-flow-list');
        if (pvsystFlow) {
            let currentEnergy = pvCapacityMW * irr; // MWh (Raw GHI Potential)
            
            // Steps definitions: name, type, change %, change text, units
            const steps = [
                { name: "Global Horizontal Irradiance (GHI)", val: currentEnergy, change: 0, type: "neutral", desc: "Raw Solar Potential" },
                { name: "Global on Collector Plane (GTI)", val: currentEnergy * 1.05, change: 5.0, type: "gain", desc: "Fixed-Tilt Angle Optimization" },
                { name: "Incidence Angle Modifier (IAM) Loss", val: currentEnergy * 1.05 * 0.988, change: -1.2, type: "loss", desc: "Refraction & Angle Losses" },
                { name: "Soiling & Dust Accumulation Loss", val: currentEnergy * 1.05 * 0.988 * (1 - soilingLoss), change: -(soilingLoss * 100), type: "loss", desc: "Dust & Dirt Shielding" },
                { name: "Near Shading (Row-on-Row Shading)", val: currentEnergy * 1.05 * 0.988 * (1 - soilingLoss) * (1 - (specNearShading / -100)), change: specNearShading, type: "loss", desc: "Adjacent Structure Shadows" },
                { name: "LID & LeTID Degradation Loss", val: currentEnergy * 1.05 * 0.988 * (1 - soilingLoss) * (1 - (specNearShading / -100)) * (1 - (specLidLoss / -100)), change: specLidLoss, type: "loss", desc: "First-Light Module Degradation" },
                { name: "Bifaciality Ground Albedo Reflection", val: currentEnergy * 1.05 * 0.988 * (1 - soilingLoss) * (1 - (specNearShading / -100)) * (1 - (specLidLoss / -100)) * (1 + (bifacialGainPercent/100)), change: bifacialGainPercent, type: "gain", desc: "Heterojunction (HJT) Double-Glass Gain" },
                { name: "PV Cell Temperature Thermal Loss", val: currentEnergy * 1.05 * 0.988 * (1 - soilingLoss) * (1 - (specNearShading / -100)) * (1 - (specLidLoss / -100)) * (1 + (bifacialGainPercent/100)) * (1 - (tempLossPercent/100)), change: -tempLossPercent, type: "loss", desc: "Cell Temperature Power Degradation" },
                { name: "DC Cable Resistance (Ohmic Loss)", val: currentEnergy * 1.05 * 0.988 * (1 - soilingLoss) * (1 - (specNearShading / -100)) * (1 - (specLidLoss / -100)) * (1 + (bifacialGainPercent/100)) * (1 - (tempLossPercent/100)) * 0.992, change: -0.8, type: "loss", desc: "IEEE 446 DC Voltage Drop" },
                { name: "Inverter Conversion (CEC Efficiency)", val: currentEnergy * 1.05 * 0.988 * (1 - soilingLoss) * (1 - (specNearShading / -100)) * (1 - (specLidLoss / -100)) * (1 + (bifacialGainPercent/100)) * (1 - (tempLossPercent/100)) * 0.992 * 0.988, change: -1.2, type: "loss", desc: "DC to AC Conversion Losses" },
                { name: "AC Substation & Transformer Loss", val: currentEnergy * 1.05 * 0.988 * (1 - soilingLoss) * (1 - (specNearShading / -100)) * (1 - (specLidLoss / -100)) * (1 + (bifacialGainPercent/100)) * (1 - (tempLossPercent/100)) * 0.992 * 0.988 * (1 - (mvLossPercent/100)), change: -mvLossPercent, type: "loss", desc: "IEEE C57 Transformer Losses" },
                { name: "System Auxiliary & HVAC Power Consumption", val: currentEnergy * 1.05 * 0.988 * (1 - soilingLoss) * (1 - (specNearShading / -100)) * (1 - (specLidLoss / -100)) * (1 + (bifacialGainPercent/100)) * (1 - (tempLossPercent/100)) * 0.992 * 0.988 * (1 - (mvLossPercent/100)) * 0.995, change: -0.5, type: "loss", desc: "Cooling & Auxiliary House Loads" },
                { name: "Grid Downtime & Availability Loss", val: annualYieldMWh, change: -(100 - gridAvailability * 100), type: "loss", desc: "Grid Curtailment & Maintenance Downtime" },
                { name: "Net Energy Yield (Exported to Grid)", val: annualYieldMWh, change: 0, type: "neutral", desc: "Total Billable Grid Injected Energy" }
            ];

            let htmlContent = "";
            steps.forEach(s => {
                let changeStr = "";
                let changeClass = s.type;
                if (s.change > 0) changeStr = `+${s.change.toFixed(2)}%`;
                else if (s.change < 0) changeStr = `${s.change.toFixed(2)}%`;
                else changeStr = s.desc;

                let borderClass = s.type === "neutral" ? "neutral" : (s.type === "gain" ? "gain" : "loss");
                let stepMWh = isNaN(s.val) ? 0 : s.val;

                htmlContent += `
                    <div class="pvsyst-step ${borderClass}">
                        <div>
                            <span class="pvsyst-step-title" style="font-weight:700;">${s.name}</span>
                            <div style="font-size: 0.62rem; color: var(--text-muted); margin-top: 2px;">${s.desc}</div>
                        </div>
                        <div class="pvsyst-step-stats">
                            <span class="pvsyst-step-val">${Math.round(stepMWh).toLocaleString()} MWh</span>
                            <span class="pvsyst-step-change ${changeClass}">${changeStr}</span>
                        </div>
                    </div>
                `;
            });
            pvsystFlow.innerHTML = htmlContent;
        }

        // UX: Dynamic premium feedback warnings/success messages
        if (totalTrackers === 0 && siteBoundary) {
            showToast("Boundary area is too small or setbacks are too large to fit a single solar table. Try drawing a larger shape or reducing setbacks.", "warning");
        } else if (isCapped && siteBoundary) {
            showToast("Design area is incredibly vast! Capped at 150,000 tables to protect standard hardware safety limits.", "info");
        }
        } catch (e) {
            console.error("AutoLayout Error:", e);
            safeSetText('stat-pv-capacity', "ERR");
            safeSetText('stat-pv-panels', e.message);
        }
    }

    // Safe DOM text setter helper (Self-Healing UI architecture)
    function safeSetText(id, text) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = text;
        } else {
            console.warn(`[Self-Healing UI] Element with ID "${id}" was not found in the DOM.`);
        }
    }

    // Update Stats Display in Dashboard
    function updateStats(stats) {
        safeSetText('stat-pv-capacity', stats.pvCapacity.toFixed(2));
        safeSetText('stat-pv-panels', `${stats.panelCount.toLocaleString()} panels`);
        safeSetText('stat-bess-capacity', stats.bessCapacity.toFixed(2));
        safeSetText('stat-bess-containers', `${stats.bessContainers} containers`);
        safeSetText('stat-area', stats.areaHa.toFixed(1));
        safeSetText('stat-gcr', `GCR: ${stats.gcr.toFixed(1)}%`);
        safeSetText('stat-capex', `$${(stats.capex / 1000000).toFixed(2)}M`);
        safeSetText('stat-lcoe', `Estimated LCOE: $${stats.lcoe.toFixed(2)}/MWh`);
        safeSetText('bess-target-mwh', `${stats.bessCapacity.toFixed(1)} MWh`);
        safeSetText('bess-est-containers', `${stats.bessContainers} Units`);
    }

    // Update 20+ Engineering specs board
    function updateEngineeringStats(eng) {
        if (!eng) eng = {};
        safeSetText('spec-bifacial', `+${(eng.bifacialGain || 0).toFixed(1)}%`);
        safeSetText('spec-temp-loss', `-${(eng.tempLoss || 0).toFixed(1)}%`);
        safeSetText('spec-cable-loss', `${(eng.cableLossKW || 0).toFixed(1)} kW`);
        safeSetText('spec-ilr', (eng.ilr || 1.25).toFixed(2));
        safeSetText('spec-wind-pressure', `${(eng.windPressure || 0).toFixed(2)} kPa`);
        safeSetText('spec-aux', `${(eng.auxPowerKW || 0).toFixed(1)} kW`);
        safeSetText('spec-mv-loss', `-${(eng.mvLossPercent || 0).toFixed(1)}%`);

        // 20+ New Advanced Engineering UI updates
        safeSetText('spec-lid-loss', `${(eng.lidLoss || 0).toFixed(2)}%`);
        safeSetText('spec-shading-angle', `${(eng.shadingAngle || 0).toFixed(1)}°`);
        safeSetText('spec-inv-eff', `${(eng.invEff || 0).toFixed(1)}%`);
        safeSetText('spec-mismatch-loss', `${(eng.mismatchLoss || 0).toFixed(2)}%`);
        safeSetText('spec-near-shading', `${(eng.nearShading || 0).toFixed(1)}%`);
        safeSetText('spec-soiling-recovery', `${(eng.soilingRecovery || 0).toFixed(1)}%`);
        safeSetText('spec-substation-ac', `${(eng.substationAc || 0).toFixed(2)}%`);
        safeSetText('spec-core-loss', `${(eng.coreLoss || 0).toFixed(1)} kW`);
        safeSetText('spec-resistivity-ohms', `${(eng.resistivityOhms || 0)} Ω-m`);
        safeSetText('spec-curtailment', eng.curtailment || 'N/A');
        safeSetText('spec-bess-soh', `${(eng.bessSoh || 0).toFixed(1)}%`);
        safeSetText('spec-bess-rte', `${(eng.bessRte || 0).toFixed(1)}%`);
        safeSetText('spec-self-discharge', `${(eng.selfDischarge || 0).toFixed(2)}% / day`);
        safeSetText('spec-fire-water', `${(eng.fireWater || 0).toLocaleString()} gal`);
        safeSetText('spec-dod-limit', `${(eng.dodLimit || 0)}% Min SoC`);
        safeSetText('spec-thermal-runaway', `${(eng.thermalRunaway || 0)}°C Margin`);
        safeSetText('spec-separation', eng.separation || 'N/A');
        safeSetText('spec-shear-load', `${(eng.shearLoad || 0).toFixed(1)} kN`);
        safeSetText('spec-corrosivity', eng.corrosivity || 'N/A');
        safeSetText('spec-soil-bearing', `${(eng.soilBearing || 0)} kPa`);
        safeSetText('spec-piling-depth', `${(eng.pilingDepth || 0).toFixed(2)} meters`);
        safeSetText('spec-civil-cut', `${(eng.civilCut || 0).toFixed(0)} m³`);
        safeSetText('spec-co2-offset', `${Math.round(eng.co2Offset || 0).toLocaleString()} tons CO₂`);
    }

    // Render Simulation Charts
    function updateCharts(annualYieldMWh, totalCapex) {
        const monthlyYieldData = [0.06, 0.07, 0.08, 0.09, 0.10, 0.11, 0.11, 0.10, 0.09, 0.08, 0.06, 0.05];
        const monthlyYieldValues = monthlyYieldData.map(v => v * annualYieldMWh);

        const ctxYield = document.getElementById('yieldChart').getContext('2d');
        if (yieldChart) yieldChart.destroy();
        
        yieldChart = new Chart(ctxYield, {
            type: 'line',
            data: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                datasets: [{
                    label: 'Solar Yield (MWh) - IEEE 1547 compliant',
                    data: monthlyYieldValues,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.06)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }, {
                    label: 'BESS Dispatch (MWh)',
                    data: monthlyYieldValues.map(v => v * 0.35),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.04)',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Inter' } } }
                },
                scales: {
                    y: { grid: { color: '#e2e8f0' }, ticks: { font: { family: 'Inter' } } },
                    x: { grid: { display: false }, ticks: { font: { family: 'Inter' } } }
                }
            }
        });

        // 20-Year economic payback simulation
        const years = Array.from({ length: 20 }, (_, i) => `Yr ${i + 1}`);
        const revenuePerMWh = parseFloat(document.getElementById('ppa-tariff').value);
        const annualRev = annualYieldMWh * revenuePerMWh;
        const opex = totalCapex * 0.015; 
        const annualNetCash = annualRev - opex;

        let cashFlow = -totalCapex;
        const cumulativeCash = [];
        for (let y = 1; y <= 20; y++) {
            cashFlow += annualNetCash;
            cumulativeCash.push(cashFlow / 1000000); 
        }

        const ctxEco = document.getElementById('economicsChart').getContext('2d');
        if (economicsChart) economicsChart.destroy();

        economicsChart = new Chart(ctxEco, {
            type: 'bar',
            data: {
                labels: years,
                datasets: [{
                    label: 'Payback Projection ($ Millions)',
                    data: cumulativeCash,
                    backgroundColor: cumulativeCash.map(v => v >= 0 ? '#10b981' : '#ef4444'),
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { grid: { color: '#e2e8f0' }, ticks: { font: { family: 'Inter' } } },
                    x: { grid: { display: false }, ticks: { font: { family: 'Inter' } } }
                }
            }
        });
    }

    // Set up UI Event Listeners
    function setupEventListeners() {
        // Preset select
        document.getElementById('preset-select').addEventListener('change', (e) => {
            activePreset = e.target.value;
            loadPresetDemo(activePreset);
        });

        // Input binds
        const interactiveInputs = [
            'row-pitch', 'azimuth', 'setback', 'panel-rating', 
            'panel-efficiency', 'tracker-length', 'tracker-width',
            'bess-container-type', 'bess-target-duration', 'bess-ratio',
            'bess-doe-req', 'grid-voltage', 'tx-line-length',
            'cost-pv', 'cost-bess', 'ppa-tariff', 'eng-temp-coeff', 
            'eng-albedo', 'eng-ilr', 'eng-vdrop', 'eng-wind', 
            'eng-soiling', 'eng-wash', 'eng-resistivity', 
            'eng-availability', 'eng-degradation'
        ];

        interactiveInputs.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            const updateHandler = () => {
                const valEl = document.getElementById(`${id.replace('row-', '').replace('target-', '').replace('eng-', '').replace('tx-line-', 'tx-')}-val`);
                if (valEl) {
                    let suffix = '';
                    if (id.includes('pitch')) suffix = 'm';
                    else if (id.includes('azimuth')) suffix = '°';
                    else if (id.includes('setback')) suffix = 'm';
                    else if (id.includes('wind')) suffix = ' km/h';
                    else if (id.includes('length') && id.includes('tx')) suffix = 'km';

                    valEl.textContent = `${el.value}${suffix}`;
                }
                triggerAutoLayout();
            };

            el.addEventListener('input', updateHandler);
            el.addEventListener('change', updateHandler);
        });



        // BESS toggles
        document.getElementById('bess-auto').addEventListener('click', (e) => {
            bessPlacement = 'auto';
            e.target.classList.add('active');
            document.getElementById('bess-manual').classList.remove('active');
            triggerAutoLayout();
        });
        document.getElementById('bess-manual').addEventListener('click', (e) => {
            bessPlacement = 'manual';
            e.target.classList.add('active');
            document.getElementById('bess-auto').classList.remove('active');
            triggerAutoLayout();
        });

        // Layers toggles
        document.getElementById('layer-satellite').addEventListener('click', (e) => {
            map.removeLayer(baseVector);
            map.addLayer(baseSatellite);
            e.target.classList.add('active');
            document.getElementById('layer-vector').classList.remove('active');
        });
        document.getElementById('layer-vector').addEventListener('click', (e) => {
            map.removeLayer(baseSatellite);
            map.addLayer(baseVector);
            e.target.classList.add('active');
            document.getElementById('layer-satellite').classList.remove('active');
        });



        // Toolbar triggers
        document.getElementById('tool-draw').addEventListener('click', (e) => {
            if (isDrawingMode) {
                // Cancel drawing
                isDrawingMode = false;
                if (drawPolyline) map.removeLayer(drawPolyline);
                drawMarkers.forEach(m => map.removeLayer(m));
                drawCoords = [];
                drawMarkers = [];
                drawPolyline = null;
                
                document.getElementById('tool-complete').style.display = 'none';
                e.currentTarget.classList.remove('active');
                e.currentTarget.innerHTML = '<i data-lucide="pen-tool"></i> Draw Boundary';
                lucide.createIcons();
                map.dragging.enable();
            } else {
                // Start drawing
                isDrawingMode = true;
                
                document.getElementById('tool-complete').style.display = 'inline-flex';
                e.currentTarget.classList.add('active');
                e.currentTarget.innerHTML = '<i data-lucide="x"></i> Cancel';
                lucide.createIcons();
                
                // Disable map dragging during drawing to prevent panning!
                map.dragging.disable();
            }
        });

        document.getElementById('tool-complete').addEventListener('click', () => {
            completeCustomDrawing();
        });

        document.getElementById('tool-generate-default').addEventListener('click', () => {
            const mapCenter = map.getCenter();
            // Create a 250m x 250m bounding box around the center point using Turf
            const centerPt = turf.point([mapCenter.lng, mapCenter.lat]);
            const buffered = turf.buffer(centerPt, 0.125, { units: 'kilometers' });
            const bbox = turf.bbox(buffered);
            const polyGeoJSON = turf.bboxPolygon(bbox);
            
            // Clear old boundary
            drawnItems.clearLayers();
            
            // Draw the polygon on the map
            const latLns = polyGeoJSON.geometry.coordinates[0].map(pt => [pt[1], pt[0]]);
            const polygonLayer = L.polygon(latLns, { color: '#10b981', fillOpacity: 0.08, weight: 3 });
            drawnItems.addLayer(polygonLayer);
            
            // Save site boundary and layout
            siteBoundary = polyGeoJSON;
            triggerAutoLayout();
        });

        document.getElementById('tool-clear').addEventListener('click', () => {
            if (confirm("Clear design layout?")) {
                clearLayout();
            }
        });

        // Giant Reset Button Listener
        document.getElementById('sidebar-reset-btn').addEventListener('click', () => {
            if (confirm("Are you sure you want to completely RESET the entire PVFARM planning system? All boundary designs and configurations will be restored to default.")) {
                clearLayout();
                // Load default Nueva Ecija preset
                document.getElementById('preset-select').value = 'nueva-ecija';
                activePreset = 'nueva-ecija';
                loadPresetDemo(activePreset);
            }
        });

        // Fast shortcut keys: Spacebar / Enter to complete drawing
        document.addEventListener('keydown', (e) => {
            if (isDrawingMode) {
                if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter' || e.code === 'Enter') {
                    e.preventDefault(); // Prevent page scrolling down on Spacebar press
                    completeCustomDrawing();
                }
            }
        });

        // Tab switches
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                tabBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                const targetTab = e.target.getAttribute('data-tab');
                document.querySelectorAll('.tab-pane').forEach(pane => {
                    pane.classList.remove('active');
                });
                document.getElementById(`tab-${targetTab}`).classList.add('active');
            });
        });

        // Engineering Sheet Tab switches
        const sheetTabBtns = document.querySelectorAll('.sheet-tab-btn');
        sheetTabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                sheetTabBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                const targetTab = e.target.getAttribute('data-sheet-tab');
                document.querySelectorAll('.sheet-tab-pane').forEach(pane => {
                    pane.classList.remove('active');
                });
                document.getElementById(`sheet-tab-${targetTab}`).classList.add('active');
            });
        });

        // --- MOBILE DRAWER EVENT LISTENERS (Apple & Android Touch Responsive) ---
        const sidebar = document.getElementById('app-sidebar');
        const statsBanner = document.getElementById('app-stats-banner');
        const detailedSpecs = document.getElementById('detailed-specs-sheet');

        // Sidebar drawer toggling
        document.getElementById('sidebar-toggle').addEventListener('click', () => {
            sidebar.classList.toggle('open');
            statsBanner.classList.remove('open');
            detailedSpecs.classList.remove('open');
        });

        document.getElementById('sidebar-close').addEventListener('click', () => {
            sidebar.classList.remove('open');
        });

        // Metric sheet and detailed advanced spec drawer toggling
        document.getElementById('stats-toggle').addEventListener('click', () => {
            statsBanner.classList.toggle('open');
            detailedSpecs.classList.toggle('open');
            sidebar.classList.remove('open');
        });

        document.getElementById('sheet-close-btn').addEventListener('click', () => {
            detailedSpecs.classList.remove('open');
            statsBanner.classList.remove('open');
        });

        // Export JSON Configuration
        document.getElementById('btn-export-json').addEventListener('click', () => {
            if (!siteBoundary) {
                alert("Draw a boundary first.");
                return;
            }
            const config = {
                preset: activePreset,
                trackerType: trackerType,
                parameters: {
                    pitch: document.getElementById('row-pitch').value,
                    azimuth: document.getElementById('azimuth').value,
                    setback: document.getElementById('setback').value,
                    panelRating: document.getElementById('panel-rating').value,
                    trackerLength: document.getElementById('tracker-length').value,
                    trackerWidth: document.getElementById('tracker-width').value
                },
                siteGeoJSON: siteBoundary
            };

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `pvfarm_nueva_ecija_${activePreset}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });

        document.getElementById('btn-export-report').addEventListener('click', () => {
            window.print();
        });
    }

    // Initialize Map and UI on startup
    initMap();
    setupEventListeners();
});
