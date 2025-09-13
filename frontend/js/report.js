// report.js - Improved version with better error handling and validation
document.addEventListener('DOMContentLoaded', function () {
    // Configuration
    const API_BASE_URL = 'http://127.0.0.1:8001';
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const MAX_FILES = 5;
    
    // DOM Elements
    const reportForm = document.getElementById('hazardReportForm');
    const severitySlider = document.getElementById('severity');
    const severityValue = document.getElementById('severityValue');
    const getCurrentLocationBtn = document.getElementById('getCurrentLocationBtn');
    const statusDiv = document.getElementById('reportStatus');
    const latInput = document.getElementById('latitude');
    const lngInput = document.getElementById('longitude');
    const locationNameInput = document.getElementById('locationName');
    const mediaInput = document.getElementById('mediaFiles');
    const mediaPreview = document.getElementById('mediaPreview');
    
    // State
    let map;
    let marker;
    let selectedFiles = [];
    let currentWeatherData = null;
    
    // --- Initialize Map ---
    function initializeMap() {
        const mapElement = document.getElementById('locationMap');
        if (!mapElement || typeof L === 'undefined') return;
        
        // Set map height
        mapElement.style.height = '400px';
        
        // Initialize map centered on India
        map = L.map('locationMap').setView([20.5937, 78.9629], 5);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(map);
        
        // Add search control
        addSearchControl();

    // Map click handler
        map.on('click', handleMapClick);
        
        // If the form already has coordinates (prefilled), show them
        const preLat = parseFloat(latInput.value || NaN);
        const preLng = parseFloat(lngInput.value || NaN);
        if (!Number.isNaN(preLat) && !Number.isNaN(preLng)) {
            map.setView([preLat, preLng], 13);
            updateMarker(preLat, preLng);
            fetchWeatherData(preLat, preLng).catch(() => {});
        }
    }
    
    function addSearchControl() {
        if (!map) return;
        const searchControl = L.control({ position: 'topright' });
        
        searchControl.onAdd = function(map) {
            const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control p-2');
            div.innerHTML = `
                <input type="text" id="mapSearch" placeholder="Search location..." 
                       style="padding: 5px; width: 200px;">
                <button type="button" id="searchBtn" class="btn btn-sm btn-primary ms-1">Search</button>
            `;
            
            L.DomEvent.disableClickPropagation(div);
            
            return div;
        };
        
        searchControl.addTo(map);
        
        // Add search functionality
        document.getElementById('searchBtn').addEventListener('click', searchLocation);
        document.getElementById('mapSearch').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchLocation();
        });
    }
    
    async function searchLocation() {
        const query = document.getElementById('mapSearch').value;
        if (!query) return;
        
        try {
            // Use Nominatim for geocoding
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
            const data = await response.json();
            
            if (data && data.length > 0) {
                const result = data[0];
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);
                
                // Update map and marker
                map.setView([lat, lon], 13);
                updateMarker(lat, lon);
                
                // Update form inputs
                latInput.value = lat.toFixed(6);
                lngInput.value = lon.toFixed(6);
                locationNameInput.value = result.display_name.split(',')[0] || '';
                
                // Fetch weather
                await fetchWeatherData(lat, lon);
                
                showAlert('Location found and selected', 'success');
            } else {
                showAlert('Location not found', 'warning');
            }
        } catch (error) {
            console.error('Search error:', error);
            showAlert('Error searching location', 'danger');
        }
    }
    
    function handleMapClick(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        updateMarker(lat, lng);
        
        // Update form inputs
        latInput.value = lat.toFixed(6);
        lngInput.value = lng.toFixed(6);
        
        // Reverse geocode to get location name
        reverseGeocode(lat, lng);
        
        // Fetch weather data (don't await here to keep UI responsive)
        fetchWeatherData(lat, lng).catch(() => {});
    }
    
    function updateMarker(lat, lng) {
        if (!map) return;
        if (marker) {
            marker.setLatLng([lat, lng]);
        } else {
            marker = L.marker([lat, lng]).addTo(map);
            marker.bindPopup('Selected location').openPopup();
        }
    }
    
    async function reverseGeocode(lat, lng) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`);
            const data = await response.json();
            
            if (data && data.display_name) {
                const locationName = data.display_name.split(',')[0] || '';
                locationNameInput.value = locationName;
            }
        } catch (error) {
            console.error('Reverse geocoding error:', error);
        }
    }
    
    // --- Weather Data ---
    async function fetchWeatherData(lat, lng) {
        const weatherDiv = document.getElementById('weatherData');
        if (!weatherDiv) return;
        
        weatherDiv.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading weather...</div>';
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`);
            if (!response.ok) throw new Error('Weather data not available');
            
            const data = await response.json();
            currentWeatherData = data;
            
            renderWeatherData(data);
            
            // Store weather data in hidden field
            const weatherInput = document.getElementById('weatherConditions');
            if (weatherInput) {
                weatherInput.value = JSON.stringify(data);
            }
        } catch (error) {
            console.error('Weather fetch error:', error);
            if (weatherDiv) weatherDiv.innerHTML = '<p class="text-warning">Weather data temporarily unavailable</p>';
            currentWeatherData = null;
        }
    }
    
    function renderWeatherData(data) {
        const weatherDiv = document.getElementById('weatherData');
        if (!weatherDiv) return;
        
            weatherDiv.innerHTML = `
            <div class="row">
                <div class="col-md-6">
                    <div class="weather-item d-flex justify-content-between">
                        <div><i class="fas fa-thermometer-half"></i> Temperature</div>
                    <strong>${data.temperature}°C</strong>
                </div>
                    <div class="weather-item d-flex justify-content-between">
                        <div><i class="fas fa-wind"></i> Wind</div>
                        <strong>${data.wind_speed} m/s ${data.wind_direction || ''}</strong>
                </div>
                </div>
                <div class="col-md-6">
                    <div class="weather-item d-flex justify-content-between">
                        <div><i class="fas fa-tint"></i> Humidity</div>
                    <strong>${data.humidity}%</strong>
                </div>
                    <div class="weather-item d-flex justify-content-between">
                        <div><i class="fas fa-water"></i> Wave Height</div>
                        <strong>${(data.wave_height !== undefined) ? data.wave_height + 'm' : 'N/A'}</strong>
                    </div>
                </div>
            </div>
            <div class="text-center mt-2">
                <small class="text-muted">
                    <i class="fas fa-cloud"></i> ${data.weather_description || ''}
                </small>
            </div>
        `;
    }

    // --- Severity Slider ---
    if (severitySlider && severityValue) {
        severityValue.textContent = severitySlider.value;
        
        severitySlider.oninput = function() {
            const value = this.value;
            severityValue.textContent = value;
            
            // Update color based on severity
            if (value >= 4) {
                severityValue.className = 'text-danger fw-bold';
            } else if (value >= 3) {
                severityValue.className = 'text-warning fw-bold';
            } else {
                severityValue.className = 'text-info';
            }
        };
    }

    // --- Get Current Location ---
    if (getCurrentLocationBtn) {
        getCurrentLocationBtn.addEventListener('click', function() {
            if (!navigator.geolocation) {
                showAlert('Geolocation is not supported by your browser', 'warning');
                return;
            }
            
            // Update button state
                getCurrentLocationBtn.disabled = true;
                const originalText = getCurrentLocationBtn.innerHTML;
                getCurrentLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting location...';
                
                navigator.geolocation.getCurrentPosition(
                async (position) => {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        
                    // Validate if location is near Indian coastline
                    if (!isNearIndianCoast(lat, lng)) {
                        showAlert('Please select a location near the Indian coastline', 'warning');
                        getCurrentLocationBtn.disabled = false;
                        getCurrentLocationBtn.innerHTML = originalText;
                        return;
                    }
                    
                    // Update map and marker
                    if (map) map.setView([lat, lng], 13);
                    updateMarker(lat, lng);
                        
                    // Update form inputs
                        latInput.value = lat.toFixed(6);
                        lngInput.value = lng.toFixed(6);
                        
                    // Get location name and weather
                    await Promise.all([
                        reverseGeocode(lat, lng),
                        fetchWeatherData(lat, lng)
                    ]);
                        
                        showAlert('Location retrieved successfully', 'success');
                        getCurrentLocationBtn.disabled = false;
                        getCurrentLocationBtn.innerHTML = originalText;
                    },
                (error) => {
                        let message = 'Unable to retrieve location.';
                        if (error.code === error.PERMISSION_DENIED) {
                            message = 'Location access denied. Please enable location services.';
                    } else if (error.code === error.TIMEOUT) {
                        message = 'Location request timed out. Please try again.';
                        }
                    
                        showAlert(message, 'danger');
                        getCurrentLocationBtn.disabled = false;
                        getCurrentLocationBtn.innerHTML = originalText;
                    },
                    {
                        enableHighAccuracy: true,
                    timeout: 10000,
                        maximumAge: 0
                    }
                );
        });
    }

    // --- Media Handling ---
    if (mediaInput && mediaPreview) {
        mediaInput.addEventListener('change', handleMediaSelection);
    }
    
    function handleMediaSelection(e) {
        const files = Array.from(e.target.files);

        // Validate file count
        if (selectedFiles.length + files.length > MAX_FILES) {
            showAlert(`Maximum ${MAX_FILES} files allowed`, 'warning');
            return;
        }
        
        files.forEach(file => {
            // Validate file size
            if (file.size > MAX_FILE_SIZE) {
                showAlert(`${file.name} is too large (max 10MB)`, 'warning');
                return;
            }

            // Validate file type
            if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
                showAlert(`${file.name} is not a valid image or video file`, 'warning');
                return;
            }
            
            // Prevent duplicate file names (simple check)
            if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
                showAlert(`${file.name} already added`, 'warning');
                return;
            }

            // Add to selected files
            selectedFiles.push(file);
            
            // Create preview
            createMediaPreview(file);
        });
        
        updateFileInput();
    }
    
    function createMediaPreview(file) {
        const reader = new FileReader();
        const div = document.createElement('div');
        div.className = 'media-preview-item position-relative';
        div.style.cssText = 'display: inline-block; margin: 5px; position: relative;';
        
        reader.onload = function(e) {
            const displayName = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;
            if (file.type.startsWith('image/')) {
                div.innerHTML = `
                    <img src="${e.target.result}" alt="${file.name}" 
                         style="max-width: 150px; max-height: 150px; object-fit: cover; border-radius:4px;">
                    <button type="button" class="btn btn-sm btn-danger position-absolute top-0 end-0"
                            data-filename="${escapeHtml(file.name)}">
                        <i class="fas fa-times"></i>
                    </button>
                    <small class="d-block text-center">${escapeHtml(displayName)}</small>
                `;
            } else if (file.type.startsWith('video/')) {
                div.innerHTML = `
                    <video src="${e.target.result}" controls 
                           style="max-width: 150px; max-height: 150px; border-radius:4px;"></video>
                    <button type="button" class="btn btn-sm btn-danger position-absolute top-0 end-0"
                            data-filename="${escapeHtml(file.name)}">
                        <i class="fas fa-times"></i>
                    </button>
                    <small class="d-block text-center">${escapeHtml(displayName)}</small>
                `;
            }
            
            // Attach remove listener to the button
            const btn = div.querySelector('button');
            if (btn) {
                btn.addEventListener('click', (ev) => {
                    const name = btn.getAttribute('data-filename');
                    removeMedia(name);
                });
            }
            
            mediaPreview.appendChild(div);
        };
        
        reader.readAsDataURL(file);
    }
    
    window.removeMedia = function(fileName) {
        // fileName may be escaped in attribute; unescape needed
        const unescapedName = fileName;
        selectedFiles = selectedFiles.filter(f => f.name !== unescapedName);
        updateFileInput();
        
        // Remove preview(s) that refer to this fileName
        const previews = mediaPreview.querySelectorAll('.media-preview-item');
        previews.forEach(preview => {
            if (preview.innerHTML.includes(unescapedName)) {
                preview.remove();
            }
        });
    };
    
    function updateFileInput() {
        // Create new FileList-like object
        const dataTransfer = new DataTransfer();
        selectedFiles.forEach(file => dataTransfer.items.add(file));
        mediaInput.files = dataTransfer.files;
    }
    
    // --- Form Submission ---
    if (reportForm) {
        reportForm.addEventListener('submit', handleFormSubmit);
    }
    
    async function handleFormSubmit(e) {
        e.preventDefault();
        
        // Basic validation
        if (!reportForm.checkValidity()) {
            reportForm.classList.add('was-validated');
            showAlert('Please fill in all required fields', 'warning');
            return;
        }
        
        // Validate location
        if (!marker && (!latInput.value || !lngInput.value)) {
            showAlert('Please select a location on the map', 'warning');
                    return;
                }
        
        const formData = new FormData(reportForm);
        
        // Ensure user_id is set
        if (!formData.get('user_id')) {
            formData.set('user_id', 'user_' + Date.now());
        }
        
        // Validate coordinates are within Indian coastal bounds
        const lat = parseFloat(formData.get('latitude'));
        const lon = parseFloat(formData.get('longitude'));
        
        if (Number.isNaN(lat) || Number.isNaN(lon)) {
            showAlert('Invalid coordinates provided', 'warning');
            return;
        }
        
        if (!isNearIndianCoast(lat, lon)) {
            showAlert('Location must be near Indian coastline', 'warning');
            return;
        }
        
        // Update UI
            const submitBtn = reportForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Submitting...';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting report...';
        }

            try {
            // Use plural /api/reports/submit to match backend
            const response = await fetch(`${API_BASE_URL}/api/reports/submit`, {
                    method: 'POST',
                body: formData
                });

                if (response.ok) {
                    const data = await response.json();
                
                // Show success message
                showAlert(`Report submitted successfully! ID: ${data.report_id}`, 'success');
                
                // Show detailed result
                statusDiv.innerHTML = `
                    <div class="alert alert-success">
                        <h5>Report Submitted Successfully!</h5>
                        <p><strong>Report ID:</strong> ${escapeHtml(data.report_id)}</p>
                        <p><strong>Priority Score:</strong> ${escapeHtml(String(data.priority_score || 'N/A'))}</p>
                        ${data.nearby_reports_count > 0 ? 
                            `<p><strong>Nearby Reports:</strong> ${escapeHtml(String(data.nearby_reports_count))} similar reports found in the area</p>` : ''}
                        <p>${escapeHtml(data.message || '')}</p>
                    </div>
                `;
                
                // Reset form & UI
                resetForm();
                } else {
                    const errorData = await response.json().catch(() => ({}));
                const errMsg = errorData.detail || errorData.message || 'Submission failed';
                throw new Error(errMsg);
                }
            } catch (error) {
            console.error('Submission error:', error);
            showAlert(`Error: ${error.message}`, 'danger');
            } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
        }
    }
    
    function resetForm() {
        if (!reportForm) return;
        reportForm.reset();
        reportForm.classList.remove('was-validated');
        
        // Reset severity display
        if (severitySlider && severityValue) {
            severityValue.textContent = severitySlider.value = severitySlider.getAttribute('min') || '1';
            severityValue.className = 'text-info';
        }
        
        // Clear selected files & preview
        selectedFiles = [];
        if (mediaPreview) mediaPreview.innerHTML = '';
        if (mediaInput) {
            try {
                mediaInput.value = null;
            } catch (e) {
                // In some browsers setting .value may be restricted; fallback to recreating input
                const newInput = mediaInput.cloneNode();
                mediaInput.parentNode.replaceChild(newInput, mediaInput);
            }
        }
        
        // Clear marker but keep map view
        if (marker) {
            try {
                map.removeLayer(marker);
            } catch (e) { /* ignore */ }
            marker = null;
        }
        
        // Clear weather display
        const weatherDiv = document.getElementById('weatherData');
        if (weatherDiv) weatherDiv.innerHTML = '';
        currentWeatherData = null;
    }
    
    // --- Helpers ---
    function isNearIndianCoast(lat, lon) {
        // Slightly widened coastal bounds to include southern tip (approx)
        const bounds = {
            min_lat: 6.5,   // southern tip approx
            max_lat: 24.5,  // northern coastal margin
            min_lon: 68.0,  // west
            max_lon: 97.5   // east
        };
        if (typeof lat !== 'number' || typeof lon !== 'number') return false;
        return lat >= bounds.min_lat && lat <= bounds.max_lat && lon >= bounds.min_lon && lon <= bounds.max_lon;
    }
    
    function showAlert(message, type = 'info', timeout = 5000) {
        if (!statusDiv) {
            console.log(`[${type}] ${message}`);
            return;
        }
        const alertId = `alert-${Date.now()}`;
        const wrapper = document.createElement('div');
        wrapper.id = alertId;
        wrapper.innerHTML = `
            <div class="alert alert-${escapeHtml(type)} alert-dismissible fade show" role="alert">
                ${escapeHtml(message)}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
        statusDiv.prepend(wrapper);
        
        if (timeout > 0) {
            setTimeout(() => {
                const el = document.getElementById(alertId);
                if (el) el.remove();
            }, timeout);
        }
    }
    
    // Basic HTML-escape to avoid injecting user content into DOM
    function escapeHtml(unsafe) {
        if (unsafe === undefined || unsafe === null) return '';
        return String(unsafe)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }
    
    // Initialize map if Leaflet is present
    initializeMap();
    
    // Expose a debug function to manually trigger weather fetch if needed
    window.fetchWeatherForCurrent = () => {
        const lat = parseFloat(latInput.value || NaN);
        const lng = parseFloat(lngInput.value || NaN);
        if (!Number.isNaN(lat) && !Number.isNaN(lng)) fetchWeatherData(lat, lng).catch(() => {});
    };
});