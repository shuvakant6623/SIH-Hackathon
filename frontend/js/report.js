// report.js

document.addEventListener('DOMContentLoaded', function () {
    const reportForm = document.getElementById('hazardReportForm');
    const severitySlider = document.getElementById('severity');
    const severityValue = document.getElementById('severityValue');
    const getCurrentLocationBtn = document.getElementById('getCurrentLocationBtn');
    const statusDiv = document.getElementById('reportStatus');
    
    // Initialize map
    const map = L.map('locationMap').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    let marker;
    const latInput = document.getElementById('latitude');
    const lngInput = document.getElementById('longitude');

    // Map click handler
    map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        if (marker) {
            marker.setLatLng([lat, lng]);
        } else {
            marker = L.marker([lat, lng]).addTo(map);
        }
        
        latInput.value = lat.toFixed(6);
        lngInput.value = lng.toFixed(6);
        
        // Fetch weather data for the selected location
        fetchWeatherData(lat, lng);
    });
    
    async function fetchWeatherData(lat, lng) {
        const weatherDiv = document.getElementById('weatherData');
        try {
            const response = await fetch(`http://localhost:8001/api/weather?lat=${lat}&lon=${lng}`);
            if (!response.ok) throw new Error('Weather data not available');
            
            const data = await response.json();
            weatherDiv.innerHTML = `
                <div class="weather-item">
                    <span>Temperature:</span>
                    <strong>${data.temperature}°C</strong>
                </div>
                <div class="weather-item">
                    <span>Wind Speed:</span>
                    <strong>${data.wind_speed} m/s</strong>
                </div>
                <div class="weather-item">
                    <span>Weather:</span>
                    <strong>${data.weather_description}</strong>
                </div>
                <div class="weather-item">
                    <span>Humidity:</span>
                    <strong>${data.humidity}%</strong>
                </div>
            `;
            
            // Automatically fill the weather conditions JSON
            document.getElementById('weatherConditions').value = JSON.stringify(data);
        } catch (error) {
            weatherDiv.innerHTML = '<p class="text-warning">Weather data temporarily unavailable</p>';
        }
    }

    // Update severity display
    if (severitySlider && severityValue) {
        severityValue.textContent = severitySlider.value;
        severitySlider.oninput = function() {
            severityValue.textContent = this.value;
        };
    }

    // Get current location
    if (getCurrentLocationBtn) {
        getCurrentLocationBtn.addEventListener('click', function() {
            if (navigator.geolocation) {
                getCurrentLocationBtn.disabled = true;
                const originalText = getCurrentLocationBtn.innerHTML;
                getCurrentLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting location...';
                
                navigator.geolocation.getCurrentPosition(
                    function(position) {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        
                        // Update map
                        map.setView([lat, lng], 13);
                        if (marker) {
                            marker.setLatLng([lat, lng]);
                        } else {
                            marker = L.marker([lat, lng]).addTo(map);
                        }
                        
                        // Update inputs
                        latInput.value = lat.toFixed(6);
                        lngInput.value = lng.toFixed(6);
                        
                        // Fetch weather for the location
                        fetchWeatherData(lat, lng);
                        
                        showAlert('Location retrieved successfully', 'success');
                        getCurrentLocationBtn.disabled = false;
                        getCurrentLocationBtn.innerHTML = originalText;
                    },
                    function(error) {
                        console.error('Error getting location:', error);
                        let message = 'Unable to retrieve location.';
                        if (error.code === error.PERMISSION_DENIED) {
                            message = 'Location access denied. Please enable location services.';
                        }
                        showAlert(message, 'danger');
                        getCurrentLocationBtn.disabled = false;
                        getCurrentLocationBtn.innerHTML = originalText;
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 5000,
                        maximumAge: 0
                    }
                );
            } else {
                showAlert('Geolocation is not supported by this browser', 'warning');
            }
        });
    }

    // Handle form submission
    if (reportForm) {
        reportForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            // Enhanced validation
            if (!reportForm.checkValidity()) {
                e.stopPropagation();
                reportForm.classList.add('was-validated');
                showAlert('Please fill in all required fields correctly', 'warning');
                return;
            }

            const formData = new FormData(reportForm);
            const lat = formData.get('latitude');
            const lon = formData.get('longitude');
            
            if (!marker) {
                showAlert('Please select a location on the map', 'warning');
                return;
            }

            // Validate media files
            const mediaFiles = formData.getAll('media_files');
            for (const file of mediaFiles) {
                if (file.size > 10 * 1024 * 1024) { // 10MB
                    showAlert(`File ${file.name} is too large. Maximum size is 10MB.`, 'warning');
                    return;
                }
            }

            // Validate weather conditions JSON
            const weatherConditions = formData.get('weather_conditions');
            if (weatherConditions) {
                try {
                    JSON.parse(weatherConditions);
                } catch (e) {
                    showAlert('Weather conditions must be valid JSON', 'warning');
                    return;
                }
            }

            // Disable submit button and show progress
            const submitBtn = reportForm.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
            showAlert('Submitting report...', 'info');

            try {
                // --- Call the backend API ---
                // Assuming the backend is running on localhost:8000
                const response = await fetch('http://127.0.0.1:8001/api/reports/submit', {
                    method: 'POST',
                    body: formData // FormData handles file uploads automatically
                });

                if (response.ok) {
                    const data = await response.json();
                    statusDiv.innerHTML = `<p style="color:green;">Report submitted successfully! Report ID: ${data.report_id}. Priority Score: ${data.priority_score}</p>`;
                    reportForm.reset(); // Clear the form
                    document.getElementById('severityValue').textContent = '3'; // Reset slider display
                    document.getElementById('mediaPreview').innerHTML = ''; // Clear preview
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    const errorMsg = errorData.detail || 'Failed to submit report.';
                    statusDiv.innerHTML = `<p style="color:red;">Error: ${errorMsg}</p>`;
                }
            } catch (error) {
                console.error('Error submitting report:', error);
                statusDiv.innerHTML = `<p style="color:red;">Network error. Please check your connection and try again.</p>`;
            } finally {
                // Re-enable submit button
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            }
        });
    }

    // Enhanced media preview
    const mediaInput = document.getElementById('mediaFiles');
    const mediaPreview = document.getElementById('mediaPreview');
    let selectedFiles = new Set();
    
    if (mediaInput && mediaPreview) {
        mediaInput.addEventListener('change', function() {
            const files = Array.from(this.files);
            
            files.forEach(file => {
                if (selectedFiles.size >= 5) {
                    showAlert('Maximum 5 files allowed', 'warning');
                    return;
                }
                
                if (file.size > 10 * 1024 * 1024) {
                    showAlert(`${file.name} is too large (max 10MB)`, 'warning');
                    return;
                }
                
                const reader = new FileReader();
                const div = document.createElement('div');
                div.className = 'media-preview-item';
                
                reader.onload = function(e) {
                    if (file.type.startsWith('image/')) {
                        div.innerHTML = `
                            <img src="${e.target.result}" alt="${file.name}">
                            <button type="button" class="remove-media" title="Remove">×</button>
                        `;
                    } else if (file.type.startsWith('video/')) {
                        div.innerHTML = `
                            <video src="${e.target.result}" controls></video>
                            <button type="button" class="remove-media" title="Remove">×</button>
                        `;
                    }
                    
                    div.querySelector('.remove-media').addEventListener('click', function() {
                        div.remove();
                        selectedFiles.delete(file);
                    });
                    
                    mediaPreview.appendChild(div);
                };
                
                reader.readAsDataURL(file);
                selectedFiles.add(file);
            });
        });
    }

    // Utility function to show alerts
    function showAlert(message, type = 'info') {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        statusDiv.innerHTML = '';
        statusDiv.appendChild(alertDiv);
        
        if (type !== 'danger') {
            setTimeout(() => alertDiv.remove(), 5000);
        }
    }
});