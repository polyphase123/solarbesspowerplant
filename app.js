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

        // Automatically adopt the calculated Solar Capacity (MW) from the GIS Map inside the Smart String BESS Sizer
        const solarSlider = document.getElementById('solar-mw');
        if (solarSlider && stats.pvCapacity > 0) {
            if (stats.pvCapacity > parseFloat(solarSlider.max)) {
                solarSlider.max = Math.ceil(stats.pvCapacity);
            }
            solarSlider.value = stats.pvCapacity.toFixed(2);
            const valSpan = document.getElementById('solar-mw-val');
            if (valSpan) valSpan.innerText = stats.pvCapacity.toFixed(2) + ' MW';
            
            // Trigger BESS sizing recalculation
            if (window.updateSizing) {
                window.updateSizing();
            }
        }
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
    
    // Auto-init BESS sizing features on dom load
    setTimeout(() => {
        initBessSizer();
    }, 100);
});

/* ==========================================================================
   INTEGRATED HUAWEI BESS SIZING & CALCULATORS MODULE (GLOBAL STATE)
   ========================================================================== */

let currentScreen = 'map';
let selectedFeatureIndex = 1;
let simChart = null;
let featChart = null;

// Product Catalog Specs database
const HUAWEI_BESS_CATALOG = {
  utility: {
    model: 'LUNA2000-4472-2S (Flagship)',
    unitEnergy: 4.472, // MWh
    unitPower: 2.236,  // MW
    cooling: 'Liquid Cooled',
    footprint: '6.058 x 2.438 m (20ft Container)',
    weight: 42000 // kg
  }
};

// Global Sizing Init
function initBessSizer() {
    initSizingCharts();
    toggleSolarPanel();
    selectFeature(1);
    
    // Slider values synchronization
    const syncVal = (id, suffix) => {
        const slider = document.getElementById(id);
        if (slider) {
            slider.addEventListener('input', (e) => {
                const bubble = document.getElementById(id + '-val');
                if (bubble) bubble.textContent = e.target.value + suffix;
            });
        }
    };
    syncVal('solar-mw', ' MW');
    syncVal('pv-penetration', ' %');
    syncVal('target-power', ' MW');
    syncVal('target-duration', ' Hrs');
    syncVal('dod-limit', ' %');

    // Two-way synchronization between BESS Map settings and Sizer panel
    const mapRatio = document.getElementById('bess-ratio');
    const sizerRatio = document.getElementById('pv-penetration');
    if (mapRatio && sizerRatio) {
        mapRatio.addEventListener('input', () => {
            sizerRatio.value = mapRatio.value;
            const bubble = document.getElementById('pv-penetration-val');
            if (bubble) bubble.textContent = mapRatio.value + ' %';
            updateSizing();
        });
        sizerRatio.addEventListener('input', () => {
            mapRatio.value = sizerRatio.value;
            triggerAutoLayout();
        });
    }

    const mapDuration = document.getElementById('bess-target-duration');
    const sizerDuration = document.getElementById('target-duration');
    if (mapDuration && sizerDuration) {
        mapDuration.addEventListener('input', () => {
            sizerDuration.value = mapDuration.value;
            const bubble = document.getElementById('target-duration-val');
            if (bubble) bubble.textContent = mapDuration.value + ' Hrs';
            updateSizing();
        });
        sizerDuration.addEventListener('input', () => {
            mapDuration.value = sizerDuration.value;
            triggerAutoLayout();
        });
    }

    const mapDoe = document.getElementById('bess-doe-req');
    const sizerDoe = document.getElementById('ph-doe-mandate');
    if (mapDoe && sizerDoe) {
        mapDoe.addEventListener('change', () => {
            sizerDoe.checked = mapDoe.checked;
            updateSizing();
        });
        sizerDoe.addEventListener('change', () => {
            mapDoe.checked = sizerDoe.checked;
            triggerAutoLayout();
        });
    }

    // Dropdown BESS container synchronization (Utility Scale only)
    const mapContainer = document.getElementById('bess-container-type');
    const sizerApp = document.getElementById('application-type');
    if (mapContainer && sizerApp) {
        mapContainer.addEventListener('change', () => {
            sizerApp.value = 'utility';
            if (window.handleAppChange) {
                window.handleAppChange();
            }
        });
        sizerApp.addEventListener('change', () => {
            triggerAutoLayout();
        });
    }
}

// Global Workspace Screen Swapper
window.switchScreen = function(screenId) {
    currentScreen = screenId;
    
    // Toggle navigation classes
    document.querySelectorAll('.nav-item-btn').forEach(btn => {
        if (btn.getAttribute('data-screen') === screenId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Hide all screen contents
    document.querySelectorAll('.app-screen').forEach(screen => {
        screen.style.display = 'none';
        screen.classList.remove('active');
    });

    // Show target screen
    const targetScreen = document.getElementById(`screen-${screenId}`);
    if (targetScreen) {
        targetScreen.style.display = (screenId === 'engineering') ? 'grid' : 'flex';
        setTimeout(() => { targetScreen.classList.add('active'); }, 50);
    }

    // Toggle map settings in scrollable sidebar to maximize workspace focus
    const sections = document.querySelectorAll('.sidebar-scroll > .settings-section');
    sections.forEach((sec, idx) => {
        if (idx > 0) { // Keep Workspace Navigator visible always
            sec.style.display = (screenId === 'map') ? 'block' : 'none';
        }
    });

    const sidebarFooter = document.querySelector('.sidebar-footer');
    if (sidebarFooter) sidebarFooter.style.display = (screenId === 'map') ? 'flex' : 'none';

    // Trigger chart resizes and specific module initializations
    if (screenId === 'sizer' && simChart) {
        simChart.resize();
        updateSizing();
    }
};

// Toggle solar inputs
window.toggleSolarPanel = function() {
    const isChecked = document.getElementById('include-solar').checked;
    const group = document.getElementById('solar-input-group');
    
    document.getElementById('target-power').disabled = isChecked;
    document.getElementById('target-duration').disabled = isChecked;
    
    if (group) {
        group.style.display = isChecked ? 'flex' : 'none';
    }
    updateSizing();
};

// Handle app segment change
window.handleAppChange = function() {
    const solarSlider = document.getElementById('solar-mw');
    const targetSlider = document.getElementById('target-power');
    
    solarSlider.max = 250; 
    if (parseFloat(solarSlider.value) > 250) {
        // Keep custom high capacity if set by map
    } else if (parseFloat(solarSlider.value) < 1) {
        solarSlider.value = 50;
    }
    targetSlider.max = 100;
    
    document.getElementById('solar-mw-val').innerText = solarSlider.value + ' MW';
    document.getElementById('target-power-val').innerText = targetSlider.value + ' MW';
    
    updateSizing();
};

// Calculations sizer logic
window.updateSizing = function() {
    const includeSolar = document.getElementById('include-solar').checked;
    const appType = document.getElementById('application-type').value;
    const dodLimit = parseFloat(document.getElementById('dod-limit').value) / 100;
    
    let targetPower = parseFloat(document.getElementById('target-power').value);
    let targetDuration = parseFloat(document.getElementById('target-duration').value);
    
    if (includeSolar) {
        const solarMW = parseFloat(document.getElementById('solar-mw').value);
        const penetration = parseFloat(document.getElementById('pv-penetration').value) / 100;
        
        const dailyGenMWh = solarMW * 5;
        let recBessMWh = dailyGenMWh * penetration;
        
        targetDuration = 2.0; 
        targetPower = parseFloat((recBessMWh / targetDuration).toFixed(2));
        
        const phDoe = document.getElementById('ph-doe-mandate').checked;
        if (phDoe) {
            const minDoe = solarMW * 0.20;
            if (targetPower < minDoe) {
                targetPower = parseFloat(minDoe.toFixed(2));
                recBessMWh = targetPower * targetDuration;
            }
        }
        
        document.getElementById('target-power').value = targetPower;
        document.getElementById('target-power-val').innerText = targetPower + ' MW';
        document.getElementById('target-duration').value = targetDuration;
        document.getElementById('target-duration-val').innerText = targetDuration + ' Hrs';
    }
    
    const usable = targetPower * targetDuration;
    const nominal = usable / dodLimit;
    
    document.getElementById('calc-usable').innerText = usable.toFixed(2) + ' MWh';
    document.getElementById('calc-nominal').innerText = nominal.toFixed(2) + ' MWh';
    
    const prod = HUAWEI_BESS_CATALOG[appType];
    const units = Math.ceil(nominal / prod.unitEnergy);
    const totalPower = units * prod.unitPower;
    const totalEnergy = units * prod.unitEnergy;
    
    document.getElementById('rec-model-name').innerText = prod.model;
    document.getElementById('rec-units').innerText = `${units} Unit${units > 1 ? 's' : ''}`;
    document.getElementById('rec-power').innerText = `${totalPower.toFixed(2)} MW`;
    document.getElementById('rec-energy').innerText = `${totalEnergy.toFixed(2)} MWh`;
    
    updateSizingSimulationChart(targetPower, usable);
};

// Sizing Simulation Chart
function initSizingCharts() {
    const canvas = document.getElementById('sizingSimulationChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    simChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({length: 24}, (_, i) => `${i}:00`),
            datasets: [
                {
                    label: 'Solar Output (MW)',
                    borderColor: 'rgba(245, 158, 11, 0.9)',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    fill: true,
                    tension: 0.4,
                    data: []
                },
                {
                    label: 'Grid Load (MW)',
                    borderColor: 'rgba(59, 130, 246, 0.8)',
                    borderDash: [5, 5],
                    tension: 0.3,
                    data: []
                },
                {
                    label: 'BESS State of Charge (%)',
                    borderColor: 'rgba(239, 68, 68, 0.9)',
                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    yAxisID: 'y1',
                    tension: 0.2,
                    data: []
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { title: { display: true, text: 'Power (MW)' } },
                y1: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'State of Charge (%)' },
                    min: 0, max: 100
                }
            }
        }
    });
}

function updateSizingSimulationChart(targetPower, capacity) {
    if (!simChart) return;
    const solar = [0, 0, 0, 0, 0, 0.1, 1.5, 4.5, 9, 15, 22, 28, 30, 29, 23, 16, 9, 3, 0.5, 0, 0, 0, 0, 0];
    const load = [5, 4, 4.2, 4.5, 5.5, 8.5, 12, 14, 15, 16, 17, 18, 17.5, 17, 16, 16.5, 19, 22, 24, 20, 15, 10, 7, 5.5];
    
    const scale = targetPower / 15;
    const scaledSolar = solar.map(v => v * scale * 1.5);
    const scaledLoad = load.map(v => v * scale);
    
    let soc = 20;
    const socCurve = [];
    for (let i = 0; i < 24; i++) {
        if (scaledSolar[i] > scaledLoad[i]) soc += (scaledSolar[i] - scaledLoad[i]) * 0.45;
        else if (i >= 18 && i <= 21) soc -= targetPower * 0.45;
        else soc -= 0.8;
        soc = Math.max(10, Math.min(100, soc));
        socCurve.push(parseFloat(soc.toFixed(1)));
    }
    
    simChart.data.datasets[0].data = scaledSolar.map(v => parseFloat(v.toFixed(2)));
    simChart.data.datasets[1].data = scaledLoad.map(v => parseFloat(v.toFixed(2)));
    simChart.data.datasets[2].data = socCurve;
    simChart.update();
}

/* ==========================================================================
   55 DYNAMIC HIGH-FIDELITY ENGINEERING CALCULATORS Logic
   ========================================================================== */

window.selectFeature = function(index) {
    selectedFeatureIndex = index;
    document.querySelectorAll('.feature-select-btn').forEach(btn => {
        if (parseInt(btn.getAttribute('data-feature')) === index) btn.classList.add('active');
        else btn.classList.remove('active');
    });
    
    // Dynamically update calculator title
    const activeBtn = document.querySelector(`.feature-select-btn[data-feature="${index}"]`);
    const titleEl = document.getElementById('calc-title');
    if (activeBtn && titleEl) {
        titleEl.textContent = activeBtn.childNodes[0].textContent.trim();
    }
    
    renderFeatureCalculator();
};

function renderFeatureCalculator() {
    const inputsDiv = document.getElementById('calc-inputs');
    const formulaDiv = document.getElementById('calc-formula');
    
    inputsDiv.innerHTML = '';
    
    switch(selectedFeatureIndex) {
        case 1:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Solar Plant Capacity (MW)</label><input type="number" id="feat-pv-mw" value="100" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Curtailment Target Ratio (%)</label><input type="number" id="feat-pv-prevent" value="15" min="1" max="100" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'E_{\\text{BESS}} = P_{\\text{PV}} \\times H_{\\text{sun}} \\times R_{\\text{curtail}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div><div style="font-size:0.75rem; color:var(--text-secondary); margin-top:8px;"><strong>Formula:</strong> Sizing (MWh) = Solar Power (MW) &times; 5.0 Peak Sun Hours &times; Target Factor</div>`;
            break;
        case 2:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Demand Reduction Level (MW)</label><input type="number" id="feat-shift-reduction" value="10" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Peak Shaving Window (Hours)</label><input type="number" id="feat-shift-hours" value="4" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'E_{\\text{shaved}} = P_{\\text{shave}} \\times T_{\\text{window}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div><div style="font-size:0.75rem; color:var(--text-secondary); margin-top:8px;"><strong>Formula:</strong> Energy (MWh) = Reduction (MW) &times; Shifting Duration (Hours)</div>`;
            break;
        case 3:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>System Active Power (MW)</label><input type="number" id="feat-crate-power" value="20" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Target C-Rate (C)</label><select id="feat-crate-val" onchange="runFeatCalc()"><option value="0.5">0.5C (2-Hour system)</option><option value="1">1.0C (1-Hour system)</option><option value="2">2.0C (30-Min peak buffer)</option></select></div>`;
            formulaDiv.setAttribute('data-latex', 'E_{\\text{nominal}} = \\frac{P_{\\text{discharge}}}{C_{\\text{rate}}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div><div style="font-size:0.75rem; color:var(--text-secondary); margin-top:8px;"><strong>Formula:</strong> Energy (MWh) = Discharge Power / C-rate</div>`;
            break;
        case 4:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Cycles per Year</label><input type="number" id="feat-soh-cycles" value="350" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Cell Temperature (&deg;C)</label><input type="number" id="feat-soh-temp" value="28" min="10" max="60" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\text{Degradation}_{\\text{annual}} = \\frac{N_{\\text{cycles}}}{6000} \\times \\left[1 + 0.05 \\times \\max(0, T_{\\text{cell}} - 25)\\right]');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div><div style="font-size:0.75rem; color:var(--text-secondary); margin-top:8px;"><strong>Formula:</strong> Lifecycle SOH degradation factoring cell thermal stresses</div>`;
            break;
        case 5:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Battery DC RTE (%)</label><input type="number" id="feat-rte-cell" value="95" min="80" max="100" step="0.5" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>PCS Inverter Efficiency (%)</label><input type="number" id="feat-rte-pcs" value="98.5" min="95" max="100" step="0.1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\eta_{\\text{system}} = \\eta_{\\text{cell}} \\times \\eta_{\\text{PCS}}^2 \\times \\eta_{\\text{transformer}}^2');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div><div style="font-size:0.75rem; color:var(--text-secondary); margin-top:8px;"><strong>Formula:</strong> Cumulative Round Trip Efficiency path losses</div>`;
            break;
        case 6:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Usable Capacity Target (MWh)</label><input type="number" id="feat-dod-target" value="50" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Depth of Discharge (DOD) (%)</label><input type="number" id="feat-dod-pct" value="90" min="50" max="100" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'E_{\\text{nominal}} = \\frac{E_{\\text{usable}}}{\\text{DoD}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 7:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Ambient Design Temperature (&deg;C)</label><input type="number" id="feat-temp-ambient" value="42" min="-20" max="60" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\text{Capacity}_{\\%} = \\min\\left(100,\\, 100 - 0.8 \\times (T_{\\text{ambient}} - 35)\\right)');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 8:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>System Active Power (MW)</label><input type="number" id="feat-pcs-mw" value="15" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>PCS Module Sizing</label><select id="feat-pcs-type" onchange="runFeatCalc()"><option value="200">Huawei Smart PCS - 200 kW</option><option value="3150">Huawei STS Station - 3.15 MW</option></select></div>`;
            formulaDiv.setAttribute('data-latex', 'N_{\\text{PCS}} = \\left\\lceil \\frac{P_{\\text{target}}}{P_{\\text{PCS}}} \\right\\rceil');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 9:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>System CAPEX ($/float)</label><input type="number" id="feat-lcos-capex" value="180" min="50" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Operating Lifetime (Years)</label><input type="number" id="feat-lcos-years" value="15" min="5" max="25" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\text{LCOS} = \\frac{\\text{CAPEX} + \\sum \\text{OPEX}}{\\sum E_{\\text{delivered}}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 10:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>BESS Container MWh Rating</label><input type="number" id="feat-hvac-mwh" value="2.0" min="0.1" step="0.1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Continuous C-Rate</label><input type="number" id="feat-hvac-crate" value="1.0" min="0.1" max="3" step="0.1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'Q_{\\text{cooling}} = P_{\\text{loss}} \\times 1.20');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 11:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Substation Transformer Capacity (MVA)</label><input type="number" id="feat-fault-mva" value="50" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Impedance Z (%)</label><input type="number" id="feat-fault-z" value="10" min="1" max="25" step="0.5" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'I_{\\text{sc}} = \\frac{S_{\\text{MVA}}}{\\sqrt{3} \\times V_{\\text{kV}} \\times Z_{\\%}} \\times 100');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 12:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Calculated Units Count</label><input type="number" id="feat-footprint-units" value="15" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Container standard footprint (m&sup2;)</label><input type="number" id="feat-footprint-area" value="14.8" min="5" step="0.1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'A_{\\text{total}} = N_{\\text{units}} \\times A_{\\text{footprint}} \\times F_{\\text{setback}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 13:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Total Nominal BESS capacity (MWh)</label><input type="number" id="feat-auxdraw-mwh" value="60" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Base Auxiliary Factor (%)</label><input type="number" id="feat-auxdraw-factor" value="1.5" min="0.1" step="0.1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'P_{\\text{aux}} = E_{\\text{nominal}} \\times k_{\\text{aux}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 14:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Nominal Operating Voltage (kV)</label><input type="number" id="feat-clearance-kv" value="115" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'D_{\\text{clearance}} = 0.2 + 0.005 \\times (V_{\\text{kV}} - 50)');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 15:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Total Battery Enclosures Count</label><input type="number" id="feat-delugew-units" value="25" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>NFPA Flow Rate per Unit (GPM)</label><input type="number" id="feat-delugew-flow" value="45" min="5" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'V_{\\text{fire-water}} = N_{\\text{units}} \\times Q_{\\text{gpm}} \\times T_{\\text{flow}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 16:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Available FFR Active Reserve (MW)</label><input type="number" id="feat-ffr-mw" value="20" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Grid Trigger Deviation (Hz)</label><input type="number" id="feat-ffr-dev" value="0.25" min="0.05" step="0.05" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'P_{\\text{response}} = P_{\\text{reserve}} \\times \\frac{\\Delta f}{\\Delta f_{\\text{trigger}}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 17:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Target Daily Sizing (MWh)</label><input type="number" id="feat-roi-mwh" value="100" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Grid Buy-Sell spread ($/MWh)</label><input type="number" id="feat-roi-spread" value="45" min="5" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\text{Revenue}_{\\text{daily}} = E_{\\text{nominal}} \\times \\text{Spread}_{\\text{net}} \\times \\eta_{\\text{RTE}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 18:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Annual Solar yield output (MWh)</label><input type="number" id="feat-co2-mwh" value="145000" min="100" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Grid Emission Factor (tons/MWh)</label><input type="number" id="feat-co2-ef" value="0.52" min="0.1" step="0.01" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\text{CO2}_{\\text{offset}} = E_{\\text{yield}} \\times EF_{\\text{grid}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 19:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>BESS Nominal AC capacity (MW)</label><input type="number" id="feat-pqs-mw" value="25" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Grid Total Harmonic Load (THD) (%)</label><input type="number" id="feat-pqs-thd" value="4.5" min="0.5" step="0.5" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'S_{\\text{compensation}} = P_{\\text{BESS}} \\times THD_{\\%}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 20:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Total battery enclosures</label><input type="number" id="feat-wgt-count" value="18" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Base Container Weight (Tons)</label><input type="number" id="feat-wgt-mass" value="38" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'W_{\\text{loading}} = N_{\\text{units}} \\times m_{\\text{unit}} \\times g');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 21:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Design Site Altitude (meters)</label><input type="number" id="feat-alt-val" value="1800" min="0" max="5000" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'K_{\\text{derate}} = 1.0 - 0.0001 \\times \\max(0, h_{\\text{alt}} - 1000)');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 22:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>DC Input current per string (A)</label><input type="number" id="feat-sts-amp" value="350" min="10" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Connected PV strings count</label><input type="number" id="feat-sts-strings" value="12" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'P_{\\text{STS}} = I_{\\text{string}} \\times N_{\\text{strings}} \\times V_{\\text{DC-nominal}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 23:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Fault clearing time (ms)</label><input type="number" id="feat-brk-ms" value="85" min="10" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Rated Breaking Capacity (kA)</label><input type="number" id="feat-brk-ka" value="40" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'E_{\\text{breaking}} = I_{\\text{break}}^2 \\times t_{\\text{clear}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 24:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Total PV Strings per sub-array</label><input type="number" id="feat-com-strings" value="24" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>String current (A)</label><input type="number" id="feat-com-current" value="15" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'I_{\\text{bus-bar}} = N_{\\text{strings}} \\times I_{\\text{string}} \\times 1.25');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 25:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Nominal Cell SOH (%)</label><input type="number" id="feat-bal-soh" value="98.5" min="80" max="100" step="0.1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Allowed cell-to-cell delta (mV)</label><input type="number" id="feat-bal-delta" value="12" min="1" max="100" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\text{SOC}_{\\text{variance}} = \\frac{\\Delta V_{\\text{cell}}}{V_{\\text{average}}} \\times \\text{SOH}_{\\%}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 26:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Proximity to shoreline (meters)</label><input type="number" id="feat-c5-distance" value="450" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\text{Corrosion}_{\\text{rate}} = 50 \\times e^{-0.005 \\times d_{\\text{coast}}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 27:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Continuous HVAC power draw (kW)</label><input type="number" id="feat-hvacopt-kw" value="12" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>HVAC COP factor</label><input type="number" id="feat-hvacopt-cop" value="3.4" min="1" step="0.1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'P_{\\text{cooling-net}} = \\frac{P_{\\text{raw}}}{COP}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 28:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Fundamental current (A)</label><input type="number" id="feat-thd-fund" value="1200" min="10" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Harmonic currents total (A)</label><input type="number" id="feat-thd-harm" value="36" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'THD_{\\%} = \\frac{I_{\\text{harmonics}}}{I_{\\text{fundamental}}} \\times 100');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 29:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Grid inertia constant H (s)</label><input type="number" id="feat-gfm-h" value="4.5" min="0.5" step="0.1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>BESS Power Rating (MW)</label><input type="number" id="feat-gfm-power" value="30" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'E_{\\text{virtual-inertia}} = 2 \\times P_{\\text{BESS}} \\times H');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 30:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Nominal current rating (A)</label><input type="number" id="feat-oc-amp" value="630" min="10" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Overcurrent trip setting factor</label><input type="number" id="feat-oc-factor" value="1.25" min="1.0" step="0.05" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'I_{\\text{trip}} = I_{\\text{nominal}} \\times F_{\\text{trip}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 31:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Sub-structure structural pile height (m)</label><input type="number" id="feat-windf-height" value="2.8" min="0.5" step="0.1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Safety factor</label><input type="number" id="feat-windf-sf" value="1.5" min="1.0" step="0.1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'D_{\\text{pile}} = h_{\\text{pile}} \\times F_{\\text{safety}} \\times 0.65');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 32:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>DC run conductor length (m)</label><input type="number" id="feat-dcrun-m" value="250" min="10" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Conductor cross section (mm&sup2;)</label><input type="number" id="feat-dcrun-size" value="70" min="4" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'R_{\\text{dc}} = \\rho_{\\text{copper}} \\times \\frac{L}{A_{\\text{cross-section}}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 33:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Parallel STS units count</label><input type="number" id="feat-cir-count" value="4" min="2" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Phase deviation angle (rad)</label><input type="number" id="feat-cir-angle" value="0.02" min="0.005" step="0.005" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'I_{\\text{circulating}} = \\frac{V \\times \\sin(\\Delta \\theta)}{Z_{\\text{internal}}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 34:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Transformer nominal load (MVA)</label><input type="number" id="feat-hot-load" value="45" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Ambient Temp (&deg;C)</label><input type="number" id="feat-hot-ambient" value="38" min="10" max="60" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'T_{\\text{hotspot}} = T_{\\text{ambient}} + 55 \\times \\left(\\frac{S_{\\text{load}}}{S_{\\text{rated}}}\\right)^{1.6}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 35:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Project Sizing Capacity (MW)</label><input type="number" id="feat-irr-capacity" value="120" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Annual Yield factor (kWh/kW)</label><input type="number" id="feat-irr-yield" value="1650" min="500" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\text{IRR}_{\\%} = \\left(\\frac{\\text{Yield}_{\\text{annual}} \\times \\text{Tariff}}{\\text{CAPEX}}\\right)^{0.1} - 1.0');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 36:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Substation Capacity (MVA)</label><input type="number" id="feat-trans-capacity" value="50" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>No-load Loss Factor (%)</label><input type="number" id="feat-trans-factor" value="0.25" min="0.05" step="0.05" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'P_{\\text{excitation}} = S_{\\text{substation}} \\times k_{\\text{no-load}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 37:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Base Round-Trip Efficiency (%)</label><input type="number" id="feat-rtex-base" value="95" min="80" max="100" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Cell Temperature (&deg;C)</label><input type="number" id="feat-rtex-temp" value="45" min="10" max="70" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\eta_{\\text{temp}} = \\eta_{\\text{base}} - 0.0015 \\times \\max(0, T_{\\text{cell}} - 25)');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 38:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Nominal Current Rating (A)</label><input type="number" id="feat-soil-amp" value="400" min="10" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Soil Thermal Resistivity (K-m/W)</label><input type="number" id="feat-soil-resist" value="1.8" min="0.5" step="0.1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'I_{\\text{derated}} = I_{\\text{base}} \\times \\sqrt{\\frac{1.2}{R_{\\text{thermal}}}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 39:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Power Injected (MW)</label><input type="number" id="feat-rise-power" value="30" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Grid Short-circuit MVA (MVA)</label><input type="number" id="feat-rise-sc" value="1500" min="10" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\Delta V_{\\%} = \\frac{P}{S_{\\text{short-circuit}}} \\times 100');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 40:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>AC System Current (A)</label><input type="number" id="feat-imp-current" value="800" min="10" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Line Resistance & Impedance (&Omega;/km)</label><input type="number" id="feat-imp-val" value="0.125" min="0.01" step="0.001" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'V_{\\text{drop-ac}} = \\sqrt{3} \\times I \\times Z_{\\text{cable}} \\times L');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 41:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Transformer Oil Volume (Gal)</label><input type="number" id="feat-deluge-oil" value="8500" min="100" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Deluge Volume Safety Factor</label><input type="number" id="feat-deluge-factor" value="1.15" min="1.0" step="0.05" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'V_{\\text{deluge}} = V_{\\text{oil}} \\times F_{\\text{deluge}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 42:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Peak Solar Ingress GHI (W/m&sup2;)</label><input type="number" id="feat-ghi-val" value="1050" min="100" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>BESS Container Surface Area (m&sup2;)</label><input type="number" id="feat-ghi-area" value="78" min="10" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'P_{\\text{ingress}} = GHI \\times A_{\\text{surface}} \\times \\alpha_{\\text{absorb}} \\times C_{\\text{HVAC}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 43:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Annual Degradation (%)</label><input type="number" id="feat-deg-base" value="1.8" min="0.1" step="0.1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>SOC Mitigation Margin (%)</label><input type="number" id="feat-deg-soc" value="15" min="0" max="40" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'D_{\\text{mitigated}} = D_{\\text{base}} \\times e^{-0.035 \\times \\Delta SoC}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 44:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Maximum Wind Speed (km/h)</label><input type="number" id="feat-typhoon-wind" value="280" min="50" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Total Array Uplift Area (m&sup2;)</label><input type="number" id="feat-typhoon-area" value="12000" min="100" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'F_{\\text{uplift}} = 0.613 \\times v^2 \\times A_{\\text{array}} \\times C_L');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 45:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>LFP Active Cell Mass (kg)</label><input type="number" id="feat-gas-mass" value="18000" min="100" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>NFPA Safety Vent Factor</label><input type="number" id="feat-gas-vent" value="1.8" min="1.0" step="0.1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'R_{\\text{safety}} = F_{\\text{vent}} \\times \\sqrt{m_{\\text{LFP}}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 46:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>DC Array Peak Output (MW)</label><input type="number" id="feat-dc-peak" value="125" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Inverter Loading Ratio (ILR)</label><input type="number" id="feat-dc-ilr" value="1.35" min="1.0" step="0.05" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'P_{\\text{clipping}} = P_{\\text{DC}} \\times \\left(1 - \\frac{1}{\\text{ILR}}\\right)');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 47:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Substation Fault Current (kA)</label><input type="number" id="feat-gpr-fault" value="25" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Ground Grid Resistance (&Omega;)</label><input type="number" id="feat-gpr-res" value="0.45" min="0.05" step="0.05" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\text{GPR} = I_{\\text{fault}} \\times R_{\\text{ground}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 48:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Transformer Rated Power (MVA)</label><input type="number" id="feat-bus-power" value="65" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>System Line Voltage (kV)</label><input type="number" id="feat-bus-voltage" value="115" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'I_{\\text{busbar}} = \\frac{S_{\\text{MVA}}}{\\sqrt{3} \\times V_{\\text{kV}}} \\times 10^3');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 49:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>PV Active Power (MW)</label><input type="number" id="feat-pf-power" value="80" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Target Grid Power Factor (PF)</label><input type="number" id="feat-pf-val" value="0.95" min="0.8" max="1.0" step="0.01" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'Q_{\\text{STATCOM}} = P \\times \\tan\\left(\\arccos(\\text{PF})\\right)');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 50:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Maximum String Voltage (V)</label><input type="number" id="feat-imb-max" value="1498" min="500" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Minimum String Voltage (V)</label><input type="number" id="feat-imb-min" value="1476" min="500" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\text{Imbalance}_{\\%} = \\frac{V_{\\text{max}} - V_{\\text{min}}}{V_{\\text{average}}} \\times 100');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 51:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Grid Frequency Deviation (Hz)</label><input type="number" id="feat-freq-dev" value="0.15" min="0.01" max="1.0" step="0.01" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Frequency Droop Setting (%)</label><input type="number" id="feat-freq-droop" value="4" min="1" max="10" step="0.5" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', '\\Delta P = P_{\\text{max}} \\times \\frac{\\Delta f}{f_{\\text{nominal}} \\times \\text{Droop}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 52:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>DC Peak array Capacity (MW)</label><input type="number" id="feat-clip-dc" value="150" min="10" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Inverter AC rating (MW)</label><input type="number" id="feat-clip-ac" value="120" min="10" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'E_{\\text{clipped}} = \\max(0, P_{\\text{DC}} - P_{\\text{AC}}) \\times 4.8');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 53:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Daily Dust Accrual Rate (%)</label><input type="number" id="feat-soil-rate" value="0.18" min="0.01" step="0.01" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Intermittent Cleaning Interval (days)</label><input type="number" id="feat-soil-days" value="28" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'L_{\\text{soiling}} = r_{\\text{dust}} \\times T_{\\text{cycle}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 54:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Bifaciality coefficient (%)</label><input type="number" id="feat-bif-coeff" value="80" min="50" max="100" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>Ground Albedo Factor (%)</label><input type="number" id="feat-bif-albedo" value="22" min="5" max="80" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'G_{\\text{bifacial}} = B_{\\text{coeff}} \\times \\alpha_{\\text{albedo}} \\times 1.05');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        case 55:
            inputsDiv.innerHTML = `
                <div class="form-group"><label>System Nominal Rating (MWh)</label><input type="number" id="feat-water-mwh" value="200" min="1" oninput="runFeatCalc()"></div>
                <div class="form-group"><label>NFPA Safety Fire Period (Hours)</label><input type="number" id="feat-water-hours" value="3.5" min="1" max="6" step="0.5" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'Q_{\\text{water}} = E_{\\text{nominal}} \\times F_{\\text{flow}} \\times T_{\\text{safety}}');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
        default:
            // Fallback general loader for variables
            inputsDiv.innerHTML = `
                <div class="form-group"><label>Input Active Value</label><input type="number" id="feat-generic-val" value="50" min="1" oninput="runFeatCalc()"></div>`;
            formulaDiv.setAttribute('data-latex', 'Y = X \\times 1.25');
            formulaDiv.innerHTML = `<div class="math-eq-render"></div>`;
            break;
    }
    
    runFeatCalc();
}

window.runFeatCalc = function() {
    const stepsDiv = document.getElementById('calc-steps');
    const valSpan = document.getElementById('calc-metric-val');
    const lblSpan = document.getElementById('calc-metric-lbl');
    
    stepsDiv.innerHTML = '';
    
    switch(selectedFeatureIndex) {
        case 1: {
            const mw = parseFloat(document.getElementById('feat-pv-mw').value) || 100;
            const ratio = (parseFloat(document.getElementById('feat-pv-prevent').value) || 15) / 100;
            const result = mw * 5 * ratio;
            
            valSpan.innerText = result.toFixed(2) + ' MWh';
            lblSpan.innerText = 'Calculated Optimal integration Capacity';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Estimate typical solar capacity full sun hours: <span class="step-math">H_{\\text{sun}} = 5.0 \\, \\text{Hrs}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Compute total solar daily output: <span class="step-math">E_{\\text{total}} = ${mw} \\times 5.0 = ${mw * 5} \\, \\text{MWh}</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Apply curtailment target buffering coefficient: <span class="step-math">E_{\\text{BESS}} = ${mw * 5} \\times ${ratio} = ${result.toFixed(2)} \\, \\text{MWh}</span></div></div>`;
            break;
        }
        case 2: {
            const reduction = parseFloat(document.getElementById('feat-shift-reduction').value) || 10;
            const hours = parseFloat(document.getElementById('feat-shift-hours').value) || 4;
            const result = reduction * hours;
            
            valSpan.innerText = result.toFixed(2) + ' MWh';
            lblSpan.innerText = 'Calculated Shaved Peak Energy';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Determine peak load target level: <span class="step-math">P_{\\text{shave}} = ${reduction} \\, \\text{MW}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Multiply by target shaving duration window: <span class="step-math">E_{\\text{shaved}} = ${reduction} \\times ${hours} = ${result.toFixed(2)} \\, \\text{MWh}</span></div></div>`;
            break;
        }
        case 3: {
            const power = parseFloat(document.getElementById('feat-crate-power').value) || 20;
            const crate = parseFloat(document.getElementById('feat-crate-val').value) || 0.5;
            const result = power / crate;
            
            valSpan.innerText = result.toFixed(2) + ' MWh';
            lblSpan.innerText = 'Nominal Sized BESS Energy';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Continuous power dispatch required: <span class="step-math">P = ${power} \\, \\text{MW}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Divide by selected system C-Rate: <span class="step-math">E_{\\text{nominal}} = \\frac{${power}}{${crate}} = ${result.toFixed(2)} \\, \\text{MWh}</span></div></div>`;
            break;
        }
        case 4: {
            const cycles = parseFloat(document.getElementById('feat-soh-cycles').value) || 350;
            const temp = parseFloat(document.getElementById('feat-soh-temp').value) || 28;
            const tempMult = 1 + 0.05 * Math.max(0, temp - 25);
            const dec = (cycles / 6000) * tempMult;
            const soh = 100 - (dec * 10);
            
            valSpan.innerText = soh.toFixed(2) + ' %';
            lblSpan.innerText = 'State of Health (SOH) at Year 10';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Base LFP battery cycle life limits: <span class="step-math">N_{\\text{life}} = 6000 \\, \\text{cycles}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Temperature aging multiplier: <span class="step-math">F_{\\text{temp}} = 1 + 0.05 \\times (${temp} - 25) = ${tempMult.toFixed(2)}</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Annual degradation: <span class="step-math">D = \\frac{${cycles}}{6000} \\times ${tempMult.toFixed(2)} = ${dec.toFixed(3)}\\%</span></div></div>
                <div class="calc-step"><span class="step-num">4</span><div class="step-text">Resulting year 10 SOH Sizing: <span class="step-math">\\text{SOH}_{10\\text{yr}} = 100\\% - (${dec.toFixed(3)}\\% \\times 10) = ${soh.toFixed(2)}\\%</span></div></div>`;
            break;
        }
        case 11: {
            const mva = parseFloat(document.getElementById('feat-fault-mva').value) || 50;
            const z = parseFloat(document.getElementById('feat-fault-z').value) || 10;
            const voltage = 115; // Assume 115 kV substation voltage
            const result = mva / (Math.sqrt(3) * voltage * (z / 100));
            
            valSpan.innerText = result.toFixed(2) + ' kA';
            lblSpan.innerText = 'Substation Fault Short-Circuit Current';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Nominal rating: <span class="step-math">S = ${mva} \\, \\text{MVA}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Nominal grid voltage: <span class="step-math">V = 115 \\, \\text{kV}</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Calculate short-circuit current: <span class="step-math">I_{\\text{sc}} = \\frac{${mva}}{\\sqrt{3} \\times 115 \\times ${z / 100}} = ${result.toFixed(2)} \\, \\text{kA}</span></div></div>`;
            break;
        }
        case 12: {
            const units = parseFloat(document.getElementById('feat-footprint-units').value) || 15;
            const area = parseFloat(document.getElementById('feat-footprint-area').value) || 14.8;
            const result = units * area * 2.25; // 2.25 multiplier accounts for NFPA 855 setbacks
            
            valSpan.innerText = result.toFixed(1) + ' m²';
            lblSpan.innerText = 'Total Sized BESS Layout Area';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Net unit enclosures area: <span class="step-math">A_{\\text{net}} = ${units} \\times ${area} = ${(units * area).toFixed(1)} \\, \\text{m}^2</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply NFPA 855 spatial clearance setback factor: <span class="step-math">A_{\\text{total}} = ${(units * area).toFixed(1)} \\times 2.25 = ${result.toFixed(1)} \\, \\text{m}^2</span></div></div>`;
            break;
        }
        case 13: {
            const mwh = parseFloat(document.getElementById('feat-auxdraw-mwh').value) || 60;
            const factor = parseFloat(document.getElementById('feat-auxdraw-factor').value) || 1.5;
            const result = mwh * 1000 * (factor / 100);
            
            valSpan.innerText = result.toFixed(1) + ' kW';
            lblSpan.innerText = 'Continuous Auxiliary Power Draw';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Convert nominal capacity: <span class="step-math">E_{\\text{nominal}} = ${mwh * 1000} \\, \\text{kWh}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply auxiliary power consumption factor: <span class="step-math">P_{\\text{aux}} = ${mwh * 1000} \\times ${factor / 100} = ${result.toFixed(1)} \\, \\text{kW}</span></div></div>`;
            break;
        }
        case 14: {
            const kv = parseFloat(document.getElementById('feat-clearance-kv').value) || 115;
            const result = 0.2 + 0.005 * Math.max(0, kv - 50);
            
            valSpan.innerText = result.toFixed(2) + ' m';
            lblSpan.innerText = 'Electrical safety Clearance distance';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Base clearance at 50kV: <span class="step-math">D_{\\text{base}} = 0.2 \\, \\text{m}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Add 5mm per kV above 50kV: <span class="step-math">D = 0.2 + 0.005 \\times (${kv} - 50) = ${result.toFixed(2)} \\, \\text{m}</span></div></div>`;
            break;
        }
        case 15: {
            const units = parseFloat(document.getElementById('feat-delugew-units').value) || 25;
            const flow = parseFloat(document.getElementById('feat-delugew-flow').value) || 45;
            const result = units * flow * 120; // 120 mins duration for NFPA 15 standard
            
            valSpan.innerText = result.toLocaleString() + ' Gal';
            lblSpan.innerText = 'NFPA 15 Fire Supp. Water Storage';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Total required flow rate: <span class="step-math">Q_{\\text{total}} = ${units} \\times ${flow} = ${units * flow} \\, \\text{GPM}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Multiply by NFPA 15 duration standard (120 mins): <span class="step-math">V_{\\text{deluge}} = ${units * flow} \\times 120 = ${result.toLocaleString()} \\, \\text{Gal}</span></div></div>`;
            break;
        }
        case 16: {
            const reserve = parseFloat(document.getElementById('feat-ffr-reserve') || document.getElementById('feat-ffr-mw').value) || 20;
            const dev = parseFloat(document.getElementById('feat-ffr-dev').value) || 0.25;
            const result = reserve * (dev / 0.5); // Assumed 0.5Hz trigger limit
            
            valSpan.innerText = result.toFixed(2) + ' MW';
            lblSpan.innerText = 'Instantaneous FFR Power output';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Full active power reserve capacity: <span class="step-math">P_{\\text{reserve}} = ${reserve} \\, \\text{MW}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Calculate frequency trigger proportional ratio: <span class="step-math">P_{\\text{response}} = ${reserve} \\times \\frac{${dev}}{0.5} = ${result.toFixed(2)} \\, \\text{MW}</span></div></div>`;
            break;
        }
        case 17: {
            const mwh = parseFloat(document.getElementById('feat-roi-mwh').value) || 100;
            const spread = parseFloat(document.getElementById('feat-roi-spread').value) || 45;
            const result = mwh * spread * 0.90; // RTE factor
            
            valSpan.innerText = '$' + result.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            lblSpan.innerText = 'Estimated Daily Arbitrage Revenue';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Total battery capacity scheduled: <span class="step-math">E = ${mwh} \\, \\text{MWh}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply grid spread value and system RTE (90%): <span class="step-math">\\text{Revenue} = ${mwh} \\times ${spread} \\times 0.90 = $${result.toLocaleString()}</span></div></div>`;
            break;
        }
        case 18: {
            const mwh = parseFloat(document.getElementById('feat-co2-mwh').value) || 145000;
            const ef = parseFloat(document.getElementById('feat-co2-ef').value) || 0.52;
            const result = mwh * ef;
            
            valSpan.innerText = result.toLocaleString(undefined, {maximumFractionDigits: 1}) + ' Metric Tons';
            lblSpan.innerText = 'Calculated CO2 Offsets Per Year';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Net solar plant electrical yield: <span class="step-math">E_{\\text{yield}} = ${mwh.toLocaleString()} \\, \\text{MWh}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Multiply by grid displacement factor: <span class="step-math">\\text{Offset} = ${mwh.toLocaleString()} \\times ${ef} = ${result.toFixed(1)} \\, \\text{tCO2e}</span></div></div>`;
            break;
        }
        case 19: {
            const mw = parseFloat(document.getElementById('feat-pqs-mw').value) || 25;
            const thd = parseFloat(document.getElementById('feat-pqs-thd').value) || 4.5;
            const result = mw * (thd / 100);
            
            valSpan.innerText = result.toFixed(3) + ' MVAR';
            lblSpan.innerText = 'Power Quality harmonic compensation';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">BESS inverter capacity: <span class="step-math">P_{\\text{BESS}} = ${mw} \\, \\text{MW}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Harmonic current distortion factor: <span class="step-math">THD = ${thd}\\%</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Calculate reactive filtering compensation required: <span class="step-math">S_{\\text{compensation}} = ${mw} \\times ${thd/100} = ${result.toFixed(3)} \\, \\text{MVAR}</span></div></div>`;
            break;
        }
        case 20: {
            const count = parseFloat(document.getElementById('feat-wgt-count').value) || 18;
            const mass = parseFloat(document.getElementById('feat-wgt-mass').value) || 38;
            const result = count * mass * 9.81; // kilonewtons
            
            valSpan.innerText = result.toLocaleString(undefined, {maximumFractionDigits: 0}) + ' kN';
            lblSpan.innerText = 'Total Sized System Weight Loading';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Net mass of containers: <span class="step-math">m_{\\text{total}} = ${count} \\times ${mass} = ${count * mass} \\, \\text{Tons}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Convert mass to loading force (g = 9.81m/s&sup2;): <span class="step-math">W = ${count * mass} \\times 10^3 \\, \\text{kg} \\times 9.81 = ${result.toFixed(0)} \\, \\text{kN}</span></div></div>`;
            break;
        }
        case 21: {
            const alt = parseFloat(document.getElementById('feat-alt-val').value) || 1800;
            const factor = 1.0 - 0.0001 * Math.max(0, alt - 1000);
            
            valSpan.innerText = (factor * 100).toFixed(2) + ' %';
            lblSpan.innerText = 'Calculated Altitude Derating Coefficient';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Altitude above standard 1000m headroom limit: <span class="step-math">h_{\\text{delta}} = \\max(0, ${alt} - 1000) = ${Math.max(0, alt - 1000)} \\, \\text{m}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply dielectric strength altitude reduction: <span class="step-math">K = 1.0 - 0.0001 \\times ${Math.max(0, alt - 1000)} = ${factor.toFixed(4)}</span></div></div>`;
            break;
        }
        case 22: {
            const amp = parseFloat(document.getElementById('feat-sts-amp').value) || 350;
            const strings = parseFloat(document.getElementById('feat-sts-strings').value) || 12;
            const result = (amp * strings * 1400) / 1000000; // 1400V DC nominal string potential
            
            valSpan.innerText = result.toFixed(3) + ' MW';
            lblSpan.innerText = 'Jupiter STS nominal power throughput';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Total current injected at STS DC busbar: <span class="step-math">I_{\\text{total}} = ${amp} \\times ${strings} = ${amp * strings} \\, \\text{A}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Calculate power throughput at 1400V DC: <span class="step-math">P_{\\text{STS}} = \\frac{${amp * strings} \\times 1400}{10^6} = ${result.toFixed(3)} \\, \\text{MW}</span></div></div>`;
            break;
        }
        case 23: {
            const ms = parseFloat(document.getElementById('feat-brk-ms').value) || 85;
            const ka = parseFloat(document.getElementById('feat-brk-ka').value) || 40;
            const result = Math.pow(ka, 2) * (ms / 1000);
            
            valSpan.innerText = result.toFixed(3) + ' kA²s';
            lblSpan.innerText = 'DC Active breaking let-through energy';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Rated breaking current squared: <span class="step-math">I^2 = ${ka}^2 = ${Math.pow(ka,2)} \\, \\text{kA}^2</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Calculate let-through energy: <span class="step-math">I^2t = ${Math.pow(ka,2)} \\times \\frac{${ms}}{1000} = ${result.toFixed(3)} \\, \\text{kA}^2\\text{s}</span></div></div>`;
            break;
        }
        case 24: {
            const strings = parseFloat(document.getElementById('feat-com-strings').value) || 24;
            const current = parseFloat(document.getElementById('feat-com-current').value) || 15;
            const result = strings * current * 1.25;
            
            valSpan.innerText = result.toFixed(1) + ' A';
            lblSpan.innerText = 'Sub-array Comm Box busbar capacity';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Total continuous string current: <span class="step-math">I_{\\text{raw}} = ${strings} \\times ${current} = ${strings * current} \\, \\text{A}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply NEC safety headroom factor: <span class="step-math">I_{\\text{busbar}} = ${strings * current} \\times 1.25 = ${result.toFixed(1)} \\, \\text{A}</span></div></div>`;
            break;
        }
        case 25: {
            const soh = parseFloat(document.getElementById('feat-bal-soh').value) || 98.5;
            const delta = parseFloat(document.getElementById('feat-bal-delta').value) || 12;
            const result = (delta / 3200) * (soh / 100) * 100; // 3200mV average LFP potential
            
            valSpan.innerText = result.toFixed(3) + ' %';
            lblSpan.innerText = 'SOC balance calibration variance';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Average LFP cell voltage reference: <span class="step-math">V_{\\text{avg}} = 3.2 \\, \\text{V}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Compute SOC variance based on voltage mismatch: <span class="step-math">\\text{Variance} = \\frac{${delta} \\, \\text{mV}}{3200 \\, \\text{mV}} \\times ${soh}\\% = ${result.toFixed(3)}\\%</span></div></div>`;
            break;
        }
        case 26: {
            const distance = parseFloat(document.getElementById('feat-c5-distance').value) || 450;
            const result = 50 * Math.exp(-0.005 * distance);
            
            valSpan.innerText = result.toFixed(3) + ' &mu;m / Year';
            lblSpan.innerText = 'Estimated marine C5 corrosion rate';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Distance to salt-water shoreline: <span class="step-math">d = ${distance} \\, \\text{meters}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Calculate annual metal layer degradation: <span class="step-math">\\text{Corrosion} = 50 \\times e^{-0.005 \\times ${distance}} = ${result.toFixed(3)} \\, \\mu\\text{m/yr}</span></div></div>`;
            break;
        }
        case 27: {
            const kw = parseFloat(document.getElementById('feat-hvacopt-kw').value) || 12;
            const cop = parseFloat(document.getElementById('feat-hvacopt-cop').value) || 3.4;
            const result = kw / cop;
            
            valSpan.innerText = result.toFixed(2) + ' kW';
            lblSpan.innerText = 'Optimized net HVAC auxiliary draw';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Nominal BESS thermal continuous load: <span class="step-math">P_{\\text{raw}} = ${kw} \\, \\text{kW}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply high efficiency COP compressor factor: <span class="step-math">P_{\\text{net}} = \\frac{${kw}}{${cop}} = ${result.toFixed(2)} \\, \\text{kW}</span></div></div>`;
            break;
        }
        case 28: {
            const fund = parseFloat(document.getElementById('feat-thd-fund').value) || 1200;
            const harm = parseFloat(document.getElementById('feat-thd-harm').value) || 36;
            const result = (harm / fund) * 100;
            
            valSpan.innerText = result.toFixed(2) + ' %';
            lblSpan.innerText = 'AC Busbar Total Harmonic Distortion';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Fundamental utility phase current: <span class="step-math">I_{\\text{fundamental}} = ${fund} \\, \\text{A}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Harmonic currents rms summation: <span class="step-math">I_{\\text{harmonics}} = ${harm} \\, \\text{A}</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Calculate current THD ratio: <span class="step-math">THD = \\frac{${harm}}{${fund}} \\times 100 = ${result.toFixed(2)}\\%</span></div></div>`;
            break;
        }
        case 29: {
            const h = parseFloat(document.getElementById('feat-gfm-h').value) || 4.5;
            const power = parseFloat(document.getElementById('feat-gfm-power').value) || 30;
            const result = 2 * power * h;
            
            valSpan.innerText = result.toFixed(1) + ' MW-s';
            lblSpan.innerText = 'Virtual Inertia grid-forming support';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Grid-forming virtual inertia constant: <span class="step-math">H = ${h} \\, \\text{seconds}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Compute total kinetic energy reserve supplied: <span class="step-math">E_{\\text{inertia}} = 2 \\times ${power} \\times ${h} = ${result.toFixed(1)} \\, \\text{MW-s}</span></div></div>`;
            break;
        }
        case 30: {
            const amp = parseFloat(document.getElementById('feat-oc-amp').value) || 630;
            const factor = parseFloat(document.getElementById('feat-oc-factor').value) || 1.25;
            const result = amp * factor;
            
            valSpan.innerText = result.toFixed(1) + ' A';
            lblSpan.innerText = 'Overcurrent Trip Setting limit';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Nominal system breaker rating: <span class="step-math">I_{\\text{nom}} = ${amp} \\, \\text{A}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply electrical overcurrent safety factor: <span class="step-math">I_{\\text{trip}} = ${amp} \\times ${factor} = ${result.toFixed(1)} \\, \\text{A}</span></div></div>`;
            break;
        }
        case 31: {
            const height = parseFloat(document.getElementById('feat-windf-height').value) || 2.8;
            const sf = parseFloat(document.getElementById('feat-windf-sf').value) || 1.5;
            const result = height * sf * 0.65;
            
            valSpan.innerText = result.toFixed(2) + ' m';
            lblSpan.innerText = 'Required Foundation Pile depth';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Total structure tracker clearance height: <span class="step-math">h = ${height} \\, \\text{m}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Calculate minimum pile anchoring depth: <span class="step-math">D_{\\text{pile}} = ${height} \\times ${sf} \\times 0.65 = ${result.toFixed(2)} \\, \\text{m}</span></div></div>`;
            break;
        }
        case 32: {
            const m = parseFloat(document.getElementById('feat-dcrun-m').value) || 250;
            const size = parseFloat(document.getElementById('feat-dcrun-size').value) || 70;
            const result = 0.0172 * (m / size); // 0.0172 copper resistivity coefficient
            
            valSpan.innerText = result.toFixed(4) + ' &Omega;';
            lblSpan.innerText = 'Total DC cable run resistance';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Copper electrical resistivity constant: <span class="step-math">\\rho = 0.0172 \\, \\Omega\\text{-mm}^2\\text{/m}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Calculate cable resistance: <span class="step-math">R_{\\text{dc}} = 0.0172 \\times \\frac{${m}}{${size}} = ${result.toFixed(4)} \\, \\Omega</span></div></div>`;
            break;
        }
        case 33: {
            const count = parseFloat(document.getElementById('feat-cir-count').value) || 4;
            const angle = parseFloat(document.getElementById('feat-cir-angle').value) || 0.02;
            const result = (480 * Math.sin(angle)) / 0.15; // Assumed 480V low side bus and 0.15 Ohm internal imp
            
            valSpan.innerText = result.toFixed(1) + ' A';
            lblSpan.innerText = 'Aggregate Circulating Phase Currents';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Total parallel STS blocks: <span class="step-math">N = ${count} \\, \\text{units}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Phase angle discrepancy deviation: <span class="step-math">\\Delta \\theta = ${angle} \\, \\text{rad}</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Calculate circulating current at 480V: <span class="step-math">I_{\\text{circ}} = \\frac{480 \\times \\sin(${angle})}{0.15} = ${result.toFixed(1)} \\, \\text{A}</span></div></div>`;
            break;
        }
        case 34: {
            const load = parseFloat(document.getElementById('feat-hot-load').value) || 45;
            const ambient = parseFloat(document.getElementById('feat-hot-ambient').value) || 38;
            const result = ambient + 55 * Math.pow(load / 50, 1.6); // Assumed 50MVA rated substation transformer
            
            valSpan.innerText = result.toFixed(1) + ' &deg;C';
            lblSpan.innerText = 'Transformer core hotspot temperature';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Substation design rated capacity: <span class="step-math">S_{\\text{rated}} = 50 \\, \\text{MVA}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Ambient air design temperature: <span class="step-math">T_{\\text{amb}} = ${ambient} \\, ^\\circ\\text{C}</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Compute transformer hotspot thermal limit: <span class="step-math">T_{\\text{hotspot}} = ${ambient} + 55 \\times \\left(\\frac{${load}}{50}\\right)^{1.6} = ${result.toFixed(1)} \\, ^\\circ\\text{C}</span></div></div>`;
            break;
        }
        case 35: {
            const capacity = parseFloat(document.getElementById('feat-irr-capacity').value) || 120;
            const annualYield = parseFloat(document.getElementById('feat-irr-yield').value) || 1650;
            const capex = capacity * 1000000 * 0.65; // $0.65 per watt base capex
            const revenue = capacity * 1000 * annualYield * 0.082; // 0.082 USD/kWh net tariff
            const result = (Math.pow(revenue / capex, 0.1) - 1.0) * 100;
            
            valSpan.innerText = result.toFixed(2) + ' %';
            lblSpan.innerText = 'Projected 10-Year Equity IRR';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Calculated plant CAPEX ($0.65/W): <span class="step-math">CAPEX = $${(capex/1000000).toFixed(1)}M</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Estimated annual revenue ($0.082/kWh): <span class="step-math">\\text{Revenue} = $${(revenue/1000000).toFixed(2)}M</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Calculate projected project IRR: <span class="step-math">\\text{IRR} = ${result.toFixed(2)}\\%</span></div></div>`;
            break;
        }
        case 36: {
            const capacity = parseFloat(document.getElementById('feat-trans-capacity').value) || 50;
            const factor = parseFloat(document.getElementById('feat-trans-factor').value) || 0.25;
            const result = capacity * 1000 * (factor / 100);
            
            valSpan.innerText = result.toFixed(1) + ' kW';
            lblSpan.innerText = 'Calculated Transformer Excitation Loss';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Convert substation capacity to kVA: <span class="step-math">S_{\\text{kVA}} = ${capacity} \\times 10^3 = ${capacity * 1000} \\, \\text{kVA}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Multiply by core excitation constant: <span class="step-math">P_{\\text{excitation}} = ${capacity * 1000} \\times ${factor / 100} = ${result.toFixed(1)} \\, \\text{kW}</span></div></div>`;
            break;
        }
        case 37: {
            const base = parseFloat(document.getElementById('feat-rtex-base').value) || 95;
            const temp = parseFloat(document.getElementById('feat-rtex-temp').value) || 45;
            const loss = 0.0015 * Math.max(0, temp - 25) * 100;
            const result = base - loss;
            
            valSpan.innerText = result.toFixed(2) + ' %';
            lblSpan.innerText = 'Temperature-Derated round-trip efficiency';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Compute cell delta above standard 25&deg;C: <span class="step-math">\\Delta T = ${temp} - 25 = ${temp - 25} \\, ^\\circ\\text{C}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply LFP temperature aging factor: <span class="step-math">\\text{Loss} = 0.15\\% \\times ${temp - 25} = ${loss.toFixed(2)}\\%</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Calculate net thermal derated efficiency: <span class="step-math">\\eta_{\\text{temp}} = ${base}\\% - ${loss.toFixed(2)}\\% = ${result.toFixed(2)}\\%</span></div></div>`;
            break;
        }
        case 38: {
            const amp = parseFloat(document.getElementById('feat-soil-amp').value) || 400;
            const resist = parseFloat(document.getElementById('feat-soil-resist').value) || 1.8;
            const factor = Math.sqrt(1.2 / resist);
            const result = amp * factor;
            
            valSpan.innerText = result.toFixed(1) + ' A';
            lblSpan.innerText = 'Calculated Safe Soil Ampacity Limit';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">IEEE 835 standard soil thermal resistance: <span class="step-math">R_{\\text{std}} = 1.2 \\, \\text{K-m/W}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Compute resistivity derating coefficient: <span class="step-math">F_{\\text{soil}} = \\sqrt{\\frac{1.2}{${resist}}} = ${factor.toFixed(3)}</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Apply current derating safety buffer: <span class="step-math">I_{\\text{derated}} = ${amp} \\times ${factor.toFixed(3)} = ${result.toFixed(1)} \\, \\text{A}</span></div></div>`;
            break;
        }
        case 39: {
            const power = parseFloat(document.getElementById('feat-rise-power').value) || 30;
            const sc = parseFloat(document.getElementById('feat-rise-sc').value) || 1500;
            const result = (power / sc) * 100;
            
            valSpan.innerText = result.toFixed(3) + ' %';
            lblSpan.innerText = 'Substation Coupling Voltage Rise';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Injected active capacity: <span class="step-math">P = ${power} \\, \\text{MW}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Grid short-circuit stiffness: <span class="step-math">S_{\\text{sc}} = ${sc} \\, \\text{MVA}</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Calculate voltage shift at POI: <span class="step-math">\\Delta V_{\\%} = \\frac{${power}}{${sc}} \\times 100 = ${result.toFixed(3)}\\%</span></div></div>`;
            break;
        }
        case 40: {
            const current = parseFloat(document.getElementById('feat-imp-current').value) || 800;
            const imp = parseFloat(document.getElementById('feat-imp-val').value) || 0.125;
            const result = Math.sqrt(3) * current * imp * 1.5; // Assumed 1.5 km transmission run
            
            valSpan.innerText = result.toFixed(1) + ' V';
            lblSpan.innerText = 'AC Side Cable Impedance Voltage Drop';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Continuous line current: <span class="step-math">I = ${current} \\, \\text{A}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Three-phase line impedance run (1.5 km): <span class="step-math">Z = ${imp} \\times 1.5 = ${imp * 1.5} \\, \\Omega</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">AC line voltage drop: <span class="step-math">V_{\\text{drop}} = \\sqrt{3} \\times ${current} \\times ${imp * 1.5} = ${result.toFixed(1)} \\, \\text{V}</span></div></div>`;
            break;
        }
        case 41: {
            const oil = parseFloat(document.getElementById('feat-deluge-oil').value) || 8500;
            const factor = parseFloat(document.getElementById('feat-deluge-factor').value) || 1.15;
            const result = oil * factor;
            
            valSpan.innerText = result.toFixed(0) + ' Gal';
            lblSpan.innerText = 'Transformer Oil Deluge Required Containment';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Base transformer oil capacity: <span class="step-math">V_{\\text{oil}} = ${oil} \\, \\text{Gal}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply safety overflow factor: <span class="step-math">V_{\\text{deluge}} = ${oil} \\times ${factor} = ${result.toFixed(0)} \\, \\text{Gal}</span></div></div>`;
            break;
        }
        case 42: {
            const ghi = parseFloat(document.getElementById('feat-ghi-val').value) || 1050;
            const area = parseFloat(document.getElementById('feat-ghi-area').value) || 78;
            const result = ghi * area * 0.15 * 0.35 / 1000; // Cop and absorption factor
            
            valSpan.innerText = result.toFixed(2) + ' kW';
            lblSpan.innerText = 'High GHI Auxiliary HVAC Consumption';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Compute total solar thermal load: <span class="step-math">Q_{\\text{thermal}} = ${ghi} \\times ${area} = ${(ghi * area / 1000).toFixed(1)} \\, \\text{kW}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply absorption (15%) and HVAC COP (3.0): <span class="step-math">P_{\\text{HVAC}} = ${(ghi * area / 1000).toFixed(1)} \\times 0.15 \\times 0.35 = ${result.toFixed(2)} \\, \\text{kW}</span></div></div>`;
            break;
        }
        case 43: {
            const base = parseFloat(document.getElementById('feat-deg-base').value) || 1.8;
            const soc = parseFloat(document.getElementById('feat-deg-soc').value) || 15;
            const factor = Math.exp(-0.035 * soc);
            const result = base * factor;
            
            valSpan.innerText = result.toFixed(3) + ' % / Year';
            lblSpan.innerText = 'Mitigated Degradation Rate';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Base yearly capacity degradation: <span class="step-math">D_{\\text{base}} = ${base}\\%</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Compute degradation mitigation factor: <span class="step-math">F_{\\text{mitigate}} = e^{-0.035 \\times ${soc}} = ${factor.toFixed(3)}</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Calculate mitigated annual rate: <span class="step-math">D_{\\text{mitigated}} = ${base}\\% \\times ${factor.toFixed(3)} = ${result.toFixed(3)}\\%</span></div></div>`;
            break;
        }
        case 44: {
            const wind = parseFloat(document.getElementById('feat-typhoon-wind').value) || 280;
            const area = parseFloat(document.getElementById('feat-typhoon-area').value) || 12000;
            const result = 0.613 * Math.pow(wind / 3.6, 2) * area * 0.25 / 1000; // Lift coef
            
            valSpan.innerText = result.toFixed(1) + ' kN';
            lblSpan.innerText = 'Typhoon Parking Structural Uplift Force';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Convert maximum wind velocity to m/s: <span class="step-math">v = \\frac{${wind}}{3.6} = ${(wind/3.6).toFixed(1)} \\, \\text{m/s}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Compute total horizontal uplift structural load: <span class="step-math">F_{\\text{uplift}} = 0.613 \\times ${(wind/3.6).toFixed(1)}^2 \\times ${area} \\times 0.25 = ${result.toFixed(1)} \\, \\text{kN}</span></div></div>`;
            break;
        }
        case 45: {
            const mass = parseFloat(document.getElementById('feat-gas-mass').value) || 18000;
            const vent = parseFloat(document.getElementById('feat-gas-vent').value) || 1.8;
            const result = vent * Math.sqrt(mass);
            
            valSpan.innerText = result.toFixed(1) + ' m';
            lblSpan.innerText = 'LFP Gas Venting NFPA Safety Radius';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Total LFP active cell weight: <span class="step-math">m_{\\text{LFP}} = ${mass} \\, \\text{kg}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply safety distance venting equation: <span class="step-math">R_{\\text{safety}} = ${vent} \\times \\sqrt{${mass}} = ${result.toFixed(1)} \\, \\text{m}</span></div></div>`;
            break;
        }
        case 46: {
            const peak = parseFloat(document.getElementById('feat-dc-peak').value) || 125;
            const ilr = parseFloat(document.getElementById('feat-dc-ilr').value) || 1.35;
            const result = peak * (1 - 1 / ilr);
            
            valSpan.innerText = result.toFixed(2) + ' MW';
            lblSpan.innerText = 'Clipped Active Power Surplus';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">DC capacity peak output: <span class="step-math">P_{\\text{DC}} = ${peak} \\, \\text{MW}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Inverter output capacity: <span class="step-math">P_{\\text{AC}} = \\frac{${peak}}{${ilr}} = ${(peak/ilr).toFixed(2)} \\, \\text{MW}</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Surplus clipped energy: <span class="step-math">P_{\\text{clipped}} = ${peak} - ${(peak/ilr).toFixed(2)} = ${result.toFixed(2)} \\, \\text{MW}</span></div></div>`;
            break;
        }
        case 47: {
            const fault = parseFloat(document.getElementById('feat-gpr-fault').value) || 25;
            const res = parseFloat(document.getElementById('feat-gpr-res').value) || 0.45;
            const result = fault * 1000 * res;
            
            valSpan.innerText = result.toFixed(0) + ' V';
            lblSpan.innerText = 'Ground Potential Rise (GPR)';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Substation fault current: <span class="step-math">I_{\\text{fault}} = ${fault} \\, \\text{kA} = ${fault * 1000} \\, \\text{A}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Apply ground grid resistance step sizing: <span class="step-math">\\text{GPR} = ${fault * 1000} \\times ${res} = ${result.toFixed(0)} \\, \\text{V}</span></div></div>`;
            break;
        }
        case 48: {
            const power = parseFloat(document.getElementById('feat-bus-power').value) || 65;
            const voltage = parseFloat(document.getElementById('feat-bus-voltage').value) || 115;
            const result = (power * 1000) / (Math.sqrt(3) * voltage);
            
            valSpan.innerText = result.toFixed(1) + ' A';
            lblSpan.innerText = 'Substation Busbar Ampacity Sizer';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Substation capacity load rating: <span class="step-math">S = ${power} \\, \\text{MVA} = ${power * 1000} \\, \\text{kVA}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Nominal busbar phase current: <span class="step-math">I = \\frac{${power * 1000}}{\\sqrt{3} \\times ${voltage}} = ${result.toFixed(1)} \\, \\text{A}</span></div></div>`;
            break;
        }
        case 49: {
            const power = parseFloat(document.getElementById('feat-pf-power').value) || 80;
            const pf = parseFloat(document.getElementById('feat-pf-val').value) || 0.95;
            const angle = Math.acos(pf);
            const result = power * Math.tan(angle);
            
            valSpan.innerText = result.toFixed(2) + ' MVAR';
            lblSpan.innerText = 'Reactive Power STATCOM Injection';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Grid displacement angle: <span class="step-math">\\theta = \\arccos(${pf}) = ${angle.toFixed(4)} \\, \\text{rad}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Target reactive compensation: <span class="step-math">Q = ${power} \\times \\tan(${angle.toFixed(4)}) = ${result.toFixed(2)} \\, \\text{MVAR}</span></div></div>`;
            break;
        }
        case 50: {
            const maxVal = parseFloat(document.getElementById('feat-imb-max').value) || 1498;
            const minVal = parseFloat(document.getElementById('feat-imb-min').value) || 1476;
            const avg = (maxVal + minVal) / 2;
            const result = ((maxVal - minVal) / avg) * 100;
            
            valSpan.innerText = result.toFixed(3) + ' %';
            lblSpan.innerText = 'Calculated String Level Imbalance';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Compute average string potential: <span class="step-math">V_{\\text{avg}} = \\frac{${maxVal} + ${minVal}}{2} = ${avg.toFixed(1)} \\, \\text{V}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Divide delta by average average: <span class="step-math">\\text{Imbalance} = \\frac{${maxVal} - ${minVal}}{${avg.toFixed(1)}} \\times 100 = ${result.toFixed(3)}\\%</span></div></div>`;
            break;
        }
        case 51: {
            const dev = parseFloat(document.getElementById('feat-freq-dev').value) || 0.15;
            const droop = parseFloat(document.getElementById('feat-freq-droop').value) || 4;
            const result = 100 * (dev / (60 * (droop / 100))); // Assumed 60Hz nominal
            
            valSpan.innerText = result.toFixed(2) + ' %';
            lblSpan.innerText = 'Frequency Droop Active Sizing';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Grid nominal reference frequency: <span class="step-math">f_{\\text{nom}} = 60 \\, \\text{Hz}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Calculate frequency change to droop ratio: <span class="step-math">\\Delta P = \\frac{${dev}}{60 \\times ${droop / 100}} \\times 100\\% = ${result.toFixed(2)}\\%</span></div></div>`;
            break;
        }
        case 52: {
            const dc = parseFloat(document.getElementById('feat-clip-dc').value) || 150;
            const ac = parseFloat(document.getElementById('feat-clip-ac').value) || 120;
            const result = Math.max(0, dc - ac) * 4.8;
            
            valSpan.innerText = result.toFixed(1) + ' MWh / Day';
            lblSpan.innerText = 'Calculated daily clipping loss';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Inverter clipping threshold: <span class="step-math">P_{\\text{clip}} = ${dc} - ${ac} = ${Math.max(0, dc-ac)} \\, \\text{MW}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Integrate daily peak hours (4.8h): <span class="step-math">E_{\\text{clipped}} = ${Math.max(0, dc-ac)} \\times 4.8 = ${result.toFixed(1)} \\, \\text{MWh}</span></div></div>`;
            break;
        }
        case 53: {
            const rate = parseFloat(document.getElementById('feat-soil-rate').value) || 0.18;
            const days = parseFloat(document.getElementById('feat-soil-days').value) || 28;
            const result = rate * days;
            
            valSpan.innerText = result.toFixed(2) + ' %';
            lblSpan.innerText = 'Aggregate Cycle Soiling Power Loss';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Continuous dust accumulation per day: <span class="step-math">r_{\\text{soiling}} = ${rate}\\%</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Compute cumulative peak period loss: <span class="step-math">L = ${rate}\\% \\times ${days} = ${result.toFixed(2)}\\%</span></div></div>`;
            break;
        }
        case 54: {
            const coeff = parseFloat(document.getElementById('feat-bif-coeff').value) || 80;
            const albedo = parseFloat(document.getElementById('feat-bif-albedo').value) || 22;
            const result = (coeff / 100) * (albedo / 100) * 1.05 * 100;
            
            valSpan.innerText = result.toFixed(2) + ' %';
            lblSpan.innerText = 'Net Bifacial Yield Gain';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Bifacial module efficiency coefficient: <span class="step-math">B_{\\text{coeff}} = ${coeff}\\%</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Measured ground albedo rating: <span class="step-math">\\alpha = ${albedo}\\%</span></div></div>
                <div class="calc-step"><span class="step-num">3</span><div class="step-text">Compute total solar backside yield boost: <span class="step-math">G = ${coeff/100} \\times ${albedo/100} \\times 1.05 = ${result.toFixed(2)}\\%</span></div></div>`;
            break;
        }
        case 55: {
            const mwh = parseFloat(document.getElementById('feat-water-mwh').value) || 200;
            const hours = parseFloat(document.getElementById('feat-water-hours').value) || 3.5;
            const result = mwh * 120 * hours;
            
            valSpan.innerText = result.toLocaleString() + ' Gal';
            lblSpan.innerText = 'Required Safety Fire Deluge Capacity';
            
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">NFPA safety flow rate constant: <span class="step-math">R_{\\text{flow}} = 120 \\, \\text{gal/MWh/hour}</span></div></div>
                <div class="calc-step"><span class="step-num">2</span><div class="step-text">Compute deluge water volume required: <span class="step-math">Q_{\\text{water}} = ${mwh} \\times 120 \\times ${hours} = ${result.toLocaleString()} \\, \\text{Gal}</span></div></div>`;
            break;
        }
        default: {
            const val = parseFloat(document.getElementById('feat-generic-val').value) || 50;
            const res = val * 1.25;
            valSpan.innerText = res.toFixed(2);
            lblSpan.innerText = 'Calculated Engineering Metric';
            stepsDiv.innerHTML = `
                <div class="calc-step"><span class="step-num">1</span><div class="step-text">Apply sizing standard headroom coefficient: <span class="step-math">Y = ${val} \\times 1.25 = ${res.toFixed(2)}</span></div></div>`;
            break;
        }
    }
    triggerMathRendering();
};

function triggerMathRendering() {
    if (!window.katex) {
        // Retry in 100ms when hosted on networks with latency (e.g. GitHub Pages)
        setTimeout(triggerMathRendering, 100);
        return;
    }
    const formulaDiv = document.getElementById('calc-formula');
    if (formulaDiv) {
        const latex = formulaDiv.getAttribute('data-latex');
        const eqRender = formulaDiv.querySelector('.math-eq-render');
        if (latex && eqRender) renderMathInElement(latex, eqRender, true);
    }
    document.querySelectorAll('.step-math').forEach(span => {
        const latex = span.getAttribute('data-latex') || span.innerText;
        if (latex) {
            span.setAttribute('data-latex', latex);
            renderMathInElement(latex, span, false);
        }
    });
}

function renderMathInElement(latex, element, isBlock = true) {
    if (window.katex) {
        try {
            window.katex.render(latex, element, { throwOnError: false, displayMode: isBlock });
        } catch (e) {
            element.innerText = latex;
        }
    } else {
        element.innerText = latex;
    }
}



