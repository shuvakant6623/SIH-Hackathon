// dashboard.js

document.addEventListener('DOMContentLoaded', async function () {
    // --- Error Handling Setup ---
    function showError(message) {
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-danger alert-dismissible fade show';
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.querySelector('.main-content').prepend(alertDiv);
        setTimeout(() => alertDiv.remove(), 5000);
    }

    // --- Map Initialization ---
    const mapElement = document.getElementById('map');
    
    // Ensure map container has height
    if (mapElement) {
        // Set explicit height for the map container
        mapElement.style.height = '500px';
        mapElement.style.width = '100%';
        
        // Initialize the map centered on India
        const map = L.map('map').setView([20.5937, 78.9629], 5);

        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 18
        }).addTo(map);

        // Add scale control
        L.control.scale().addTo(map);

        // Initialize markers layer group
        const markersLayer = L.layerGroup().addTo(map);
        
        // Initialize heatmap layer (if needed)
        const heatmapData = [];
        
        // Utility function to convert numeric severity to level
        function getSeverityLevel(severity) {
            if (severity >= 4) return 'high';
            if (severity >= 2) return 'medium';
            return 'low';
        }

        // Fetch hazard data from API
        async function fetchHazardData() {
            try {
                const response = await fetch('http://localhost:8001/api/reports/active');
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                const data = await response.json();
                // Transform data to match our format
                return data.map(report => ({
                    lat: report.latitude,
                    lng: report.longitude,
                    type: report.hazard_type,
                    severity: getSeverityLevel(report.severity),
                    title: `${report.location_name || 'Unknown Location'} - ${report.hazard_type.replace('_', ' ').toUpperCase()}`,
                    id: report.id,
                    description: report.description,
                    timestamp: report.timestamp,
                    verification_status: report.verification_status
                }));
            } catch (error) {
                console.error('Error fetching hazard data:', error);
                showError('Unable to fetch hazard reports');
                return [];
            }
        }

        // Get the hazard data
        const hazardData = await fetchHazardData();

        // Create custom markers for different hazard types
        function createHazardMarker(hazard) {
            const markerColors = {
                cyclone: '#ff4444',
                flood: '#00C851',
                'storm-surge': '#FF8800',
                tsunami: '#33b5e5'
            };

            const severityRadius = {
                low: 30000,
                medium: 50000,
                high: 70000
            };

            // Create marker
            const marker = L.marker([hazard.lat, hazard.lng], {
                icon: L.divIcon({
                    className: 'hazard-marker',
                    html: `<div style="background-color: ${markerColors[hazard.type]}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>`,
                    iconSize: [12, 12]
                })
            });

            // Create impact radius circle
            const circle = L.circle([hazard.lat, hazard.lng], {
                color: markerColors[hazard.type],
                fillColor: markerColors[hazard.type],
                fillOpacity: 0.2,
                radius: severityRadius[hazard.severity]
            });

            // Add popup
            marker.bindPopup(`
                <div class="hazard-popup">
                    <h5>${hazard.title}</h5>
                    <p><strong>Type:</strong> ${hazard.type}</p>
                    <p><strong>Severity:</strong> ${hazard.severity}</p>
                    <button class="btn btn-sm btn-primary view-details">View Details</button>
                </div>
            `);

            // Add to layers
            markersLayer.addLayer(marker);
            markersLayer.addLayer(circle);
            
            // Add to heatmap data
            heatmapData.push([hazard.lat, hazard.lng, hazard.severity === 'high' ? 1 : 0.5]);
        }

        // Add hazards to map
        hazardData.forEach(createHazardMarker);

        // Map click handler for adding new reports
        function onMapClick(e) {
            const infoPanel = document.getElementById('hotspotInfo');
            infoPanel.innerHTML = `
                <h4>New Report</h4>
                <form id="quickReportForm">
                    <div class="mb-3">
                        <label>Location</label>
                        <input type="text" class="form-control" value="${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}" readonly>
                    </div>
                    <div class="mb-3">
                        <label>Hazard Type</label>
                        <select class="form-select">
                            <option value="cyclone">Cyclone</option>
                            <option value="flood">Flood</option>
                            <option value="storm-surge">Storm Surge</option>
                            <option value="tsunami">Tsunami</option>
                        </select>
                    </div>
                    <button type="submit" class="btn btn-primary">Submit Report</button>
                </form>
            `;
        }

        map.on('click', onMapClick);

        // Handle quick report form submission
        document.addEventListener('submit', async function(e) {
            if (e.target.id === 'quickReportForm') {
                e.preventDefault();
                const formData = new FormData(e.target);
                
                try {
                    const response = await fetch('http://localhost:8001/api/reports/submit', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            user_id: formData.get('user_id'), 
                            latitude: parseFloat(formData.get('latitude')),
                            longitude: parseFloat(formData.get('longitude')),
                            hazard_type: formData.get('hazard_type'),
                            severity: parseInt(formData.get('severity') || '3'),
                            description: formData.get('description') || 'Quick report from map',
                            location_name: formData.get('location_name') || null
                        })
                    })
                    .then(res => res.json())
                    .then(data => {
                        console.log("Report submitted:", data);
                    })
                    .catch(err => console.error("Error submitting report:", err));
                    // Refresh hazard data
                    const newHazards = await fetchHazardData();
                    refreshHazardMarkers(newHazards);
                } catch (error) {
                    console.error('Error submitting report:', error);
                    showError('Failed to submit report. Please try again.');
                }
            }
        });

        // --- Real-time Data Updates ---

        async function fetchDashboardStats() {
            try {
                const response = await fetch('http://localhost:8001/api/dashboard/stats');
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                const data = await response.json();
                
                document.getElementById('totalReports').textContent = data.total_reports || '0';
                document.getElementById('activeHazards').textContent = data.active_hazards || '0';
                document.getElementById('hotspotCount').textContent = data.hotspot_count || '0';
                
                // Update last updated timestamp
                document.getElementById('lastUpdated').textContent = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
            } catch (error) {
                console.error('Error fetching dashboard stats:', error);
                showError('Unable to fetch dashboard statistics');
            }
        }

        async function fetchTrendingHazards() {
            const container = document.getElementById('trendingHazards');
            try {
                const response = await fetch('http://localhost:8001/api/dashboard/trends');
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                const data = await response.json();
                
                const hazardList = data.trending.map(h => ({
                    type: h.hazard_type.replace('_', ' ').toUpperCase(),
                    count: h.post_count,
                    score: h.trend_score,
                    regions: h.affected_regions
                }));
                
                container.innerHTML = `
                    <div class="trending-section">
                        <h4>Trending Hazards</h4>
                        <div class="trend-chart">
                            ${generateTrendChart(hazardList)}
                        </div>
                        ${hazardList.map(hazard => `
                            <div class="hazard-detail">
                                <h5>${hazard.type}</h5>
                                <div class="hazard-stats">
                                    <div class="stat">
                                        <span class="label">Trend Score</span>
                                        <span class="value">${(hazard.score * 100).toFixed(1)}%</span>
                                    </div>
                                    <div class="stat">
                                        <span class="label">Mentions</span>
                                        <span class="value">${hazard.count}</span>
                                    </div>
                                </div>
                                <div class="affected-areas">
                                    <h6>Affected Regions:</h6>
                                    <div class="region-tags">
                                        ${hazard.regions.map(region => `
                                            <span class="region-tag">${region}</span>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            } catch (error) {
                console.error('Error fetching trending hazards:', error);
                container.innerHTML = '<div class="alert alert-warning">Unable to load trending data</div>';
            }
        }

        async function fetchSocialMediaActivity() {
            const container = document.getElementById('socialMediaActivity');
            try {
                // Fetch recent social media analysis
                const response = await fetch('http://localhost:8001/api/analyze/social-media', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        // Example posts for testing - replace with real social media feed
                        posts: [
                            {
                                id: "1",
                                text: "Heavy flooding reported in Chennai Marina Beach area. Water levels rising rapidly. #ChennaiRains",
                                platform: "twitter",
                                timestamp: new Date().toISOString()
                            },
                            {
                                id: "2",
                                text: "Cyclone warning issued for coastal Tamil Nadu. High waves observed in Pondicherry.",
                                platform: "facebook",
                                timestamp: new Date().toISOString()
                            }
                        ]
                    })
                });
                
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                
                const data = await response.json();
                
                container.innerHTML = `
                    <div class="social-analysis">
                        <div class="analysis-header">
                            <h4>Social Media Analysis</h4>
                            <span class="analysis-stats">
                                Posts Analyzed: ${data.total_posts_analyzed} | 
                                Alerts: ${data.alerts_generated}
                            </span>
                        </div>
                        
                        ${data.high_priority_alerts.length > 0 ? `
                            <div class="high-priority-alerts">
                                <h5>High Priority Alerts</h5>
                                ${data.high_priority_alerts.map(alert => `
                                    <div class="alert-item priority-${alert.alert.urgency_level.toLowerCase()}">
                                        <div class="alert-header">
                                            <span class="hazard-type">${alert.alert.hazard_type.replace('_', ' ').toUpperCase()}</span>
                                            <span class="confidence">Confidence: ${(alert.alert.confidence * 100).toFixed(1)}%</span>
                                        </div>
                                        <div class="alert-locations">
                                            ${alert.alert.location_mentions.map(loc => `
                                                <span class="location-tag">${loc}</span>
                                            `).join('')}
                                        </div>
                                        <div class="alert-phrases">
                                            ${alert.alert.key_phrases.map(phrase => `
                                                <span class="phrase-tag">${phrase}</span>
                                            `).join('')}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                        
                        <div class="location-clusters">
                            <h5>Active Locations</h5>
                            <div class="cluster-grid">
                                ${Object.entries(data.location_clusters).map(([location, cluster]) => `
                                    <div class="cluster-item urgency-${cluster.max_urgency}">
                                        <h6>${location}</h6>
                                        <div class="cluster-stats">
                                            <span>Alerts: ${cluster.alerts.length}</span>
                                            <span>Hazards: ${cluster.hazard_types.join(', ')}</span>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                `;
            } catch (error) {
                console.error('Error fetching social media activity:', error);
                container.innerHTML = '<div class="alert alert-warning">Unable to load social media updates</div>';
            }
        }
        
        // Helper function to generate trend chart
        function generateTrendChart(hazardList) {
            const maxCount = Math.max(...hazardList.map(h => h.count));
            return `
                <div class="trend-bars">
                    ${hazardList.map(hazard => `
                        <div class="trend-bar-container">
                            <div class="trend-bar" style="height: ${(hazard.count / maxCount * 100)}%"></div>
                            <div class="trend-label">${hazard.type}</div>
                            <div class="trend-value">${hazard.count}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        async function fetchRecentReports() {
            const tbody = document.querySelector('#reportsTable tbody');
            try {
                // In production, replace with actual API call
                const response = await fetch('http://localhost:8001/api/dashboard/reports');
                const data = await response.json();
                
                const reports = data.reports || [
                    {
                        id: 'RPT-001',
                        type: 'Flood',
                        location: 'Chennai',
                        severity: 4,
                        timestamp: '2024-05-21 10:30',
                        status: 'Pending'
                    },
                    {
                        id: 'RPT-002',
                        type: 'High Waves',
                        location: 'Kochi',
                        severity: 3,
                        timestamp: '2024-05-21 09:15',
                        status: 'Verified'
                    },
                    {
                        id: 'RPT-003',
                        type: 'Storm Surge',
                        location: 'Visakhapatnam',
                        severity: 5,
                        timestamp: '2024-05-20 18:45',
                        status: 'Under Review'
                    }
                ];
                
                tbody.innerHTML = reports.map(report => `
                    <tr class="report-row" data-report-id="${report.id}">
                        <td>${report.id}</td>
                        <td>
                            <span class="hazard-type ${report.type.toLowerCase().replace(' ', '-')}">
                                ${report.type}
                            </span>
                        </td>
                        <td>${report.location}</td>
                        <td>
                            <div class="severity-indicator" data-severity="${report.severity}">
                                ${Array(report.severity).fill('●').join('')}
                            </div>
                        </td>
                        <td>${formatTimestamp(report.timestamp)}</td>
                        <td>
                            <span class="status-badge ${report.status.toLowerCase().replace(' ', '-')}">
                                ${report.status}
                            </span>
                        </td>
                    </tr>
                `).join('');
                
                // Add click handlers for report rows
                document.querySelectorAll('.report-row').forEach(row => {
                    row.addEventListener('click', () => showReportDetails(row.dataset.reportId));
                });
                
            } catch (error) {
                console.error('Error fetching recent reports:', error);
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error loading reports</td></tr>';
            }
        }

        // Utility function to refresh hazard markers
        function refreshHazardMarkers(hazards) {
            // Clear existing markers
            markersLayer.clearLayers();
            
            // Add new markers
            hazards.forEach(createHazardMarker);
        }

        // Utility function to format timestamp
        function formatTimestamp(timestamp) {
            const date = new Date(timestamp);
            return new Intl.DateTimeFormat('en-IN', {
                timeZone: 'Asia/Kolkata',
                dateStyle: 'medium',
                timeStyle: 'short'
            }).format(date);
        }

        // Setup auto-refresh
        let refreshInterval;
        function startAutoRefresh() {
            refreshInterval = setInterval(async () => {
                const newHazards = await fetchHazardData();
                refreshHazardMarkers(newHazards);
                await fetchDashboardStats();
                await fetchTrendingHazards();
                await fetchSocialMediaActivity();
            }, 30000); // Refresh every 30 seconds
        }

        function stopAutoRefresh() {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
        }

        // Start auto-refresh when page loads
        startAutoRefresh();

        // Cleanup on page unload
        window.addEventListener('beforeunload', stopAutoRefresh);

        // Initialize real-time updates
        let updateInterval;

        function startRealtimeUpdates() {
            // Update data every 30 seconds
            updateInterval = setInterval(() => {
                fetchDashboardStats();
                fetchTrendingHazards();
                fetchSocialMediaActivity();
                fetchRecentReports();
            }, 30000);
        }

        function stopRealtimeUpdates() {
            clearInterval(updateInterval);
        }

        // Initialize dashboard
        function initializeDashboard() {
            fetchDashboardStats();
            fetchTrendingHazards();
            fetchSocialMediaActivity();
            fetchRecentReports();
            startRealtimeUpdates();

            // Add refresh button handler
            document.getElementById('refreshBtn').addEventListener('click', () => {
                fetchDashboardStats();
                fetchTrendingHazards();
                fetchSocialMediaActivity();
                fetchRecentReports();
            });
        }

        // Initialize the dashboard
        initializeDashboard();

        // --- Filter Logic ---
        const filterForm = document.getElementById('filterForm');
        if (filterForm) {
            filterForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                const formData = new FormData(filterForm);
                
                // Build query parameters
                const params = new URLSearchParams();
                if (formData.get('locationFilter')) params.append('location', formData.get('locationFilter'));
                if (formData.get('hazardTypeFilter')) params.append('hazard_type', formData.get('hazardTypeFilter'));
                if (formData.get('startDate')) params.append('start_date', formData.get('startDate'));
                if (formData.get('endDate')) params.append('end_date', formData.get('endDate'));
                if (formData.get('sourceFilter')) params.append('source', formData.get('sourceFilter'));
                
                try {
                    // Fetch filtered reports
                    const response = await fetch(`http://localhost:8001/api/reports/filter?${params}`);
                    if (!response.ok) {
                        throw new Error('Failed to apply filters');
                    }
                    
                    const filteredData = await response.json();
                    // Update map markers
                    refreshHazardMarkers(filteredData);
                    // Update stats
                    await fetchDashboardStats();
                    // Update trending data
                    await fetchTrendingHazards();
                    
                    showError('Filters applied successfully', 'success');
                } catch (error) {
                    console.error('Error applying filters:', error);
                    showError('Failed to apply filters. Please try again.');
                }
            });

            document.getElementById('resetFiltersBtn').addEventListener('click', async function() {
                filterForm.reset();
                try {
                    // Fetch all reports without filters
                    const response = await fetch('http://localhost:8001/api/reports/active');
                    if (!response.ok) {
                        throw new Error('Failed to reset filters');
                    }
                    
                    const data = await response.json();
                    // Update map markers
                    refreshHazardMarkers(data);
                    // Update stats
                    await fetchDashboardStats();
                    // Update trending data
                    await fetchTrendingHazards();
                    
                    showError('Filters reset successfully', 'success');
                } catch (error) {
                    console.error('Error resetting filters:', error);
                    showError('Failed to reset filters. Please try again.');
                }
            });
        }

        // --- Hotspot Info Panel Interaction ---
        // This would be linked to map click events on hotspot markers/clusters
        // Example placeholder:
        // map.on('click', function(e) {
        //     if (clickedOnHotspot) {
        //         document.getElementById('hotspotInfo').innerHTML = `<h4>Hotspot Details</h4><p>Location: ...</p><p>Reports: ...</p>`;
        //     }
        // });

    } // End if mapElement
});