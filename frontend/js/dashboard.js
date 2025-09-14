// dashboard.js - Enhanced version with Authority Alerts functionality

document.addEventListener('DOMContentLoaded', async function () {
    const API_BASE_URL = 'http://127.0.0.1:8001';
    const REFRESH_INTERVAL = 30000; // 30s

    let refreshInterval;
    let map;
    let markersLayer;
    let currentHazards = [];

    /* ---------------- helpers ---------------- */
    function escapeHtml(unsafe) {
        if (unsafe === undefined || unsafe === null) return '';
        return String(unsafe)
            .replaceAll('&','&amp;')
            .replaceAll('<','&lt;')
            .replaceAll('>','&gt;')
            .replaceAll('"','&quot;')
            .replaceAll("'", '&#039;');
    }

    function showNotification(message, type = 'info') {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
        alertDiv.innerHTML = `
            ${escapeHtml(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999;';
            document.body.appendChild(container);
        }
        container.appendChild(alertDiv);
        if (type !== 'danger') setTimeout(() => alertDiv.remove(), 5000);
    }

    async function apiCall(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;
        const opts = { ...options };

        // If body is a plain object and not FormData, stringify it
        if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object') {
            opts.body = JSON.stringify(opts.body);
            opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        } else {
            opts.headers = { ...(opts.headers || {}) };
        }

        try {
            const res = await fetch(url, opts);
            const text = await res.text();
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }

            if (!res.ok) {
                const errMsg = (json && (json.detail || json.message)) || res.statusText || `HTTP ${res.status}`;
                const err = new Error(errMsg);
                err.status = res.status;
                err.body = json || text;
                throw err;
            }
            return json;
        } catch (err) {
            console.error('apiCall error', endpoint, err, err?.body ?? '');
            throw err;
        }
    }

    function formatHazardType(type) {
        if (!type) return 'Other';
        return String(type).replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    function formatTimestamp(ts) {
        if (!ts) return 'N/A';
        const d = new Date(ts);
        if (isNaN(d)) return ts;
        return new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(d);
    }

    function getSeverityLevel(sev) {
        const n = Number(sev || 0);
        if (n >= 4) return 'high';
        if (n >= 2) return 'medium';
        return 'low';
    }

    function renderSeverityStars(severity) {
        const s = Math.max(0, Math.min(5, Number(severity) || 0));
        const stars = '★'.repeat(s) + '☆'.repeat(5 - s);
        const color = s >= 4 ? 'text-danger' : s >= 3 ? 'text-warning' : 'text-info';
        return `<span class="${color}">${stars}</span>`;
    }

    function getStatusColor(status) {
        const s = (status || '').toString().toLowerCase();
        const colors = {
            'verified': 'success',
            'pending': 'warning',
            'under review': 'info',
            'rejected': 'danger',
            'urgent': 'danger',
            'high_priority': 'warning',
            'standard': 'primary',
            'informational': 'info'
        };
        return colors[s] || 'secondary';
    }

    function getHazardColor(typeTitleCase) {
        const colors = {
            'Tsunami': 'danger',
            'Cyclone': 'warning',
            'Flood': 'info',
            'Storm Surge': 'primary',
            'High Waves': 'secondary'
        };
        return colors[typeTitleCase] || 'dark';
    }

    /* ---------------- map ---------------- */
    function initializeMap() {
        const mapElement = document.getElementById('map');
        if (!mapElement) {
            console.warn('Map element not found');
            return;
        }
        mapElement.style.height = '500px';
        mapElement.style.width = '100%';
        map = L.map('map').setView([20.5937, 78.9629], 5);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18,
            errorTileUrl: ''
        }).addTo(map);

        L.control.scale().addTo(map);

        markersLayer = L.layerGroup().addTo(map);
        addMapLegend();
        setupMapInteractions();
    }

    function addMapLegend() {
        const legend = L.control({ position: 'bottomright' });
        legend.onAdd = function () {
            const div = L.DomUtil.create('div', 'info legend');
            div.style.backgroundColor = 'white';
            div.style.padding = '10px';
            div.style.borderRadius = '5px';
            div.style.boxShadow = '0 0 15px rgba(0,0,0,0.2)';
            div.style.zIndex = '1000';
            div.style.pointerEvents = 'auto';
            div.innerHTML = `
                <h4 style="margin:0 0 8px 0">Hazard Types</h4>
                <div><span style="display:inline-block;width:12px;height:12px;background:#ff4444;border-radius:50%;margin-right:8px;"></span> Tsunami</div>
                <div><span style="display:inline-block;width:12px;height:12px;background:#FF8800;border-radius:50%;margin-right:8px;"></span> Cyclone</div>
                <div><span style="display:inline-block;width:12px;height:12px;background:#00C851;border-radius:50%;margin-right:8px;"></span> Flood</div>
                <div><span style="display:inline-block;width:12px;height:12px;background:#33b5e5;border-radius:50%;margin-right:8px;"></span> Storm Surge</div>
                <div><span style="display:inline-block;width:12px;height:12px;background:#9933ff;border-radius:50%;margin-right:8px;"></span> High Waves</div>
                <div><span style="display:inline-block;width:12px;height:12px;background:#ff9933;border-radius:50%;margin-right:8px;"></span> Other</div>
            `;
            return div;
        };
        legend.addTo(map);
    }

    function setupMapInteractions() {
        if (!map) return;
        map.on('click', function (e) {
            const uid = Date.now();
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;

            const selectHtml = `
                <select id="quickHazardType_${uid}" class="form-select form-select-sm mb-2" aria-label="Select hazard type">
                    <option value="coastal_flooding">Coastal Flooding</option>
                    <option value="tsunami">Tsunami</option>
                    <option value="storm_surge">Storm Surge</option>
                    <option value="high_waves">High Waves</option>
                    <option value="cyclone">Cyclone</option>
                    <option value="rip_current">Rip Current</option>
                    <option value="coastal_erosion">Coastal Erosion</option>
                    <option value="other">Other</option>
                </select>
            `;

            const popupHtml = `
                <div style="min-width:240px;">
                    <h5 style="margin:0 0 6px 0;">Quick Report</h5>
                    <p style="margin:0 0 6px 0;">Location: ${lat.toFixed(4)}, ${lng.toFixed(4)}</p>
                    ${selectHtml}
                    <div class="d-flex gap-2">
                        <button id="qrBtn_${uid}" class="btn btn-sm btn-primary">Report Hazard Here</button>
                        <button id="qrClose_${uid}" class="btn btn-sm btn-secondary">Close</button>
                    </div>
                </div>
            `;

            const popup = L.popup()
                .setLatLng(e.latlng)
                .setContent(popupHtml)
                .openOn(map);

            setTimeout(() => {
                const btn = document.getElementById(`qrBtn_${uid}`);
                const closeBtn = document.getElementById(`qrClose_${uid}`);
                const sel = document.getElementById(`quickHazardType_${uid}`);

                if (btn) {
                    btn.addEventListener('click', () => {
                        const hazardType = (sel && sel.value) ? sel.value : 'coastal_flooding';
                        if (typeof window.quickReport === 'function') {
                            window.quickReport(lat, lng, hazardType);
                        }
                        if (map) map.closePopup();
                    });
                }
                if (closeBtn) closeBtn.addEventListener('click', () => map.closePopup());
            }, 50);
        });
    }

    /* ---------- quickReport exposed ---------- */
    window.quickReport = async function (lat, lng, hazardType = 'coastal_flooding') {
        const form = new FormData();
        form.append('user_id', 'user_' + Date.now());
        form.append('latitude', String(lat));
        form.append('longitude', String(lng));
        form.append('hazard_type', hazardType);
        form.append('severity', String(3));
        form.append('description', 'Quick report from map click');
        form.append('location_name', `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);

        try {
            const res = await fetch(`${API_BASE_URL}/api/reports/submit`, {
                method: 'POST',
                body: form
            });

            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                throw new Error(txt || res.statusText || `HTTP ${res.status}`);
            }

            const data = await res.json().catch(() => ({}));
            showNotification(`Report submitted: ${data.report_id || 'ok'}`, 'success');

            if (typeof window.refreshHazards === 'function') {
                await window.refreshHazards();
            }
        } catch (err) {
            console.error('quickReport error', err);
            showNotification(`Failed to submit report: ${err.message}`, 'danger');
        }
    };

    /* ---------- fetch & render data ---------- */
    async function fetchHazardData() {
    try {
        const data = await apiCall('/api/reports/active?hours=48');

        // Ensure we always get an array
        let reports = [];
        if (data && Array.isArray(data.reports)) {
            reports = data.reports;
        } else if (Array.isArray(data)) {
            reports = data;
        } else {
            console.warn("Unexpected API response format:", data);
            reports = [];
        }

        currentHazards = reports.map(report => ({
            id: report.id,
            lat: report.latitude,
            lng: report.longitude,
            type: report.hazard_type || report.type || 'other',
            severityRaw: report.severity ?? report.severity_raw ?? 0,
            severity: getSeverityLevel(report.severity ?? report.severity_raw ?? 0),
            title: `${report.location_name || report.location || 'Unknown'} - ${formatHazardType(report.hazard_type || report.type || 'other')}`,
            description: report.description || '',
            timestamp: report.timestamp || report.created_at || null,
            status: report.verification_status || report.status || 'Pending',
            priority: report.priority_score || report.priority || null,
            media_urls: report.media_urls || []
        }));

        updateMapMarkers();
        return currentHazards;

    } catch (err) {
        console.error('Error fetching hazard data:', err);
        currentHazards = getSampleHazardData();
        updateMapMarkers();
        return currentHazards;
    }
}

    function getSampleHazardData() {
        return [
            { lat: 13.0827, lng: 80.2707, type: 'tsunami', severity: 'high', title: 'Chennai - Tsunami Alert' },
            { lat: 19.0760, lng: 72.8777, type: 'flood', severity: 'medium', title: 'Mumbai - Flooding' },
            { lat: 8.5241, lng: 76.9366, type: 'high_waves', severity: 'low', title: 'Kerala - High Waves' }
        ];
    }

    function updateMapMarkers() {
        if (!markersLayer) return;
        markersLayer.clearLayers();
        currentHazards.forEach(hazard => {
            const { marker, circle } = createHazardMarker(hazard) || {};
            if (marker) markersLayer.addLayer(marker);
            if (circle) markersLayer.addLayer(circle);
        });
    }

    function createHazardMarker(hazard) {
        const markerColors = {
            tsunami: '#ff4444',
            cyclone: '#FF8800',
            flood: '#00C851',
            storm_surge: '#33b5e5',
            high_waves: '#9933ff',
            coastal_flooding: '#00C851',
            coastal_erosion: '#996633',
            rip_current: '#cc0066',
            other: '#ff9933'
        };
        const severityRadius = { low: 20000, medium: 40000, high: 60000 };
        const typeKey = (hazard.type || 'other').toLowerCase();
        const color = markerColors[typeKey] || markerColors.other;
        const marker = L.marker([hazard.lat, hazard.lng], {
            icon: L.divIcon({
                className: 'hazard-marker',
                html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>`,
                iconSize: [12, 12]
            })
        });
        const circle = L.circle([hazard.lat, hazard.lng], {
            color: color,
            fillColor: color,
            fillOpacity: 0.18,
            radius: severityRadius[hazard.severity] || 30000
        });
        marker.bindPopup(`
            <div class="hazard-popup" style="min-width:250px;">
                <h5>${escapeHtml(hazard.title || formatHazardType(hazard.type))}</h5>
                <p><strong>Type:</strong> ${escapeHtml(formatHazardType(hazard.type))}</p>
                <p><strong>Severity:</strong> ${escapeHtml(hazard.severity || hazard.severityRaw?.toString() || 'N/A')}</p>
                <p><strong>Status:</strong> ${escapeHtml(hazard.status || 'Pending')}</p>
                ${hazard.priority ? `<p><strong>Priority:</strong> ${Number(hazard.priority).toFixed(1)}</p>` : ''}
                <p><strong>Time:</strong> ${formatTimestamp(hazard.timestamp)}</p>
                ${hazard.description ? `<p><strong>Description:</strong> ${escapeHtml(hazard.description)}</p>` : ''}
                <button class="btn btn-sm btn-primary" onclick="viewReportDetails('${escapeHtml(hazard.id)}')">View Details</button>
            </div>
        `);
        return { marker, circle };
    }

    /* ---------- dashboard stats ---------- */
    async function fetchDashboardStats() {
        try {
            const data = await apiCall('/api/dashboard/stats');
            updateStatCards(data || {});
            const lastUpdatedEl = document.getElementById('lastUpdated');
            if (lastUpdatedEl) lastUpdatedEl.textContent = formatTimestamp(new Date().toISOString());
        } catch (err) {
            console.error('Error fetching dashboard stats:', err);
            updateStatCards({ total_reports: 0, active_reports: 0, resolved_reports: 0 });
        }
    }

    function updateStatCards(data) {
        const mapping = {
            totalReports: data.total_reports || data.totalReports || 0,
            activeHazards: data.active_reports || data.active_hazards || data.activeHazards || 0,
            hotspotCount: data.hotspot_count || data.hotspotCount || 0,
            highPriorityAlerts: data.resolved_reports || data.high_priority_alerts || 0
        };
        Object.entries(mapping).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) animateValue(el, parseInt(el.textContent) || 0, Number(value) || 0, 500);
        });
    }

    function animateValue(element, start, end, duration) {
        const range = end - start;
        const stepTime = Math.max(Math.floor(duration / Math.abs(range || 1)), 10);
        let current = start;
        const inc = range > 0 ? 1 : -1;
        const timer = setInterval(() => {
            current += inc;
            element.textContent = current;
            if ((inc > 0 && current >= end) || (inc < 0 && current <= end)) {
                element.textContent = end;
                clearInterval(timer);
            }
        }, stepTime);
    }

    /* ---------- trending, recent reports, social ---------- */
    async function fetchTrendingHazards() {
        const container = document.getElementById('trendingHazards');
        if (!container) return;
        try {
            const data = await apiCall('/api/dashboard/trends');
            if (data && data.trending && data.trending.length) renderTrendingHazards(container, data.trending);
            else container.innerHTML = '<div class="text-muted">No trending hazards at the moment</div>';
        } catch (err) {
            console.error('Error fetching trending hazards:', err);
            container.innerHTML = '<div class="alert alert-warning">Unable to load trending data</div>';
        }
    }

    function renderTrendingHazards(container, hazards) {
        container.innerHTML = `
            <div class="trending-section">
                <h4 class="mb-3">Trending Hazards</h4>
                ${hazards.map(h => `
                    <div class="card mb-2">
                        <div class="card-body">
                            <h5 class="card-title">${escapeHtml(formatHazardType(h.hazard_type || h.type))}</h5>
                            <div class="d-flex justify-content-between mb-2">
                                <span class="badge bg-info">Trend: ${(h.trend_score * 100 || 0).toFixed(0)}%</span>
                                <span class="badge bg-secondary">Posts: ${h.post_count || 0}</span>
                            </div>
                            <div class="affected-regions">
                                ${(h.affected_regions || []).map(region => `<span class="badge bg-light text-dark me-1">${escapeHtml(region)}</span>`).join('')}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    async function fetchRecentReports() {
        const tbody = document.querySelector('#reportsTable tbody');
        if (!tbody) return;
        try {
            const data = await apiCall('/api/dashboard/reports');
            const reports = (data && data.reports) ? data.reports : (Array.isArray(data) ? data : []);
            if (reports.length) renderReportsTable(tbody, reports);
            else tbody.innerHTML = '<tr><td colspan="6" class="text-center">No recent reports</td></tr>';
        } catch (err) {
            console.error('Error fetching recent reports:', err);
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error loading reports</td></tr>';
        }
    }

    function renderReportsTable(tbody, reports) {
        tbody.innerHTML = reports.map(report => {
            const type = report.hazard_type || report.type || 'other';
            const location = report.location_name || report.location || 'Unknown';
            const severity = report.severity ?? report.severity_raw ?? 0;
            const status = report.verification_status || report.status || 'Pending';
            return `
            <tr class="report-row" data-report-id="${escapeHtml(report.id || '')}" style="cursor:pointer;">
                <td>${escapeHtml(String(report.id || '').slice(0,8))}...</td>
                <td><span class="badge bg-${getHazardColor(formatHazardType(type))}">${escapeHtml(formatHazardType(type))}</span></td>
                <td>${escapeHtml(location)}</td>
                <td>${renderSeverityStars(Number(severity))}</td>
                <td>${escapeHtml(report.timestamp || report.created_at || '')}</td>
                <td><span class="badge bg-${getStatusColor(status)}">${escapeHtml(status)}</span></td>
            </tr>
            `;
        }).join('');

        const rows = tbody.querySelectorAll('.report-row');
        rows.forEach(row => {
            const id = row.dataset.reportId;
            if (id) {
                row.addEventListener('click', () => viewReportDetails(id));
            }
        });
    }

    async function fetchSocialMediaActivity() {
        const container = document.getElementById('socialMediaActivity');
        if (!container) return;
        try {
            const samplePosts = [
                { id: "post_" + Date.now(), text: "Heavy flooding reported in Chennai Marina Beach area.", platform: "twitter", timestamp: new Date().toISOString() },
                { id: "post_" + (Date.now() + 1), text: "Cyclone warning issued for coastal Tamil Nadu.", platform: "facebook", timestamp: new Date().toISOString() }
            ];

            const data = await apiCall('/api/analyze/social-media', {
                method: 'POST',
                body: { posts: samplePosts }
            });

            renderSocialMediaAnalysis(container, data || {});
        } catch (err) {
            console.error('fetchSocialMediaActivity error', err);
            container.innerHTML = '<div class="alert alert-warning">Social media analysis temporarily unavailable</div>';
        }
    }

    function renderSocialMediaAnalysis(container, data) {
        container.innerHTML = `
            <div class="social-analysis">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h4>Social Media Analysis</h4>
                    <span class="badge bg-info">Posts: ${data.total_posts_analyzed || 0} | Alerts: ${data.alerts_generated || 0}</span>
                </div>
                ${data.high_priority_alerts && data.high_priority_alerts.length ? `
                <div class="alert alert-warning"><h5>High Priority Alerts</h5>
                    ${data.high_priority_alerts.map(a => `
                        <div class="mb-2">
                            <strong>${escapeHtml(formatHazardType(a.alert.hazard_type))}</strong>
                            <span class="badge bg-danger ms-2">${(a.alert.confidence*100 || 0).toFixed(0)}% confidence</span>
                            <div class="small">Locations: ${(a.alert.location_mentions || []).join(', ') || 'Unknown'}</div>
                        </div>
                    `).join('')}
                </div>` : '<p class="text-muted">No high priority alerts</p>'}
            </div>
        `;
    }

    /* ---------- Authority Alerts Functions ---------- */
    async function fetchAuthorityAlerts() {
        const container = document.getElementById('alertsList');
        if (!container) return;

        try {
            container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading alerts...</div>';
            const data = await apiCall('/api/alerts');
            const alerts = Array.isArray(data) ? data : [];
            
            if (alerts.length === 0) {
                container.innerHTML = '<div class="text-muted text-center">No authority alerts found</div>';
                return;
            }

            renderAuthorityAlerts(container, alerts);
        } catch (err) {
            console.error('Error fetching authority alerts:', err);
            container.innerHTML = '<div class="alert alert-danger">Error loading authority alerts</div>';
        }
    }

    function renderAuthorityAlerts(container, alerts) {
        container.innerHTML = alerts.map(alert => `
            <div class="card mb-3">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <div>
                        <h5 class="mb-0">Alert ID: ${escapeHtml(alert.id.slice(0, 8))}...</h5>
                        <small class="text-muted">Report: ${escapeHtml(alert.report_id.slice(0, 8))}...</small>
                    </div>
                    <span class="badge bg-${getStatusColor(alert.status)} fs-6">${escapeHtml(formatAuthorityType(alert.authority_type))}</span>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-8">
                            <p class="card-text">${escapeHtml(alert.message)}</p>
                        </div>
                        <div class="col-md-4">
                            <small class="text-muted">
                                <strong>Status:</strong> <span class="badge bg-${getStatusColor(alert.status)}">${escapeHtml(alert.status)}</span><br>
                                <strong>Created:</strong> ${formatTimestamp(alert.timestamp)}<br>
                                <strong>Authority:</strong> ${escapeHtml(formatAuthorityType(alert.authority_type))}
                            </small>
                        </div>
                    </div>
                    <div class="mt-2">
                        <button class="btn btn-sm btn-outline-primary" onclick="viewReportDetails('${escapeHtml(alert.report_id)}')">
                            View Related Report
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    function formatAuthorityType(type) {
        const typeMap = {
            'coast_guard': 'Coast Guard',
            'disaster_management': 'Disaster Management',
            'navy': 'Indian Navy',
            'police': 'State Police',
            'fire_dept': 'Fire Department',
            'medical_emergency': 'Medical Emergency',
            'port_authority': 'Port Authority'
        };
        return typeMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    function showCreateAlertModal(reportId = '') {
        const modal = document.getElementById('authorityAlertModal');
        const reportIdInput = document.getElementById('alertReportId');
        
        if (reportId && reportIdInput) {
            reportIdInput.value = reportId;
        }
        
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    }

    async function submitAuthorityAlert(alertData) {
        try {
            const response = await apiCall('/api/alerts', {
                method: 'POST',
                body: alertData
            });

            showNotification('Authority alert sent successfully!', 'success');
            
            // Refresh the alerts tab if it's active
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.getAttribute('data-tab') === 'alerts') {
                await fetchAuthorityAlerts();
            }
            
            return response;
        } catch (err) {
            console.error('Error submitting authority alert:', err);
            throw err;
        }
    }

    /* ---------- report details & verification ---------- */
    window.viewReportDetails = async function (reportId) {
        try {
            const data = await apiCall(`/api/reports/${reportId}`);
            showReportDetailsModal(data);
        } catch (err) {
            console.error('viewReportDetails error', err);
            showNotification('Failed to load report details', 'danger');
        }
    };

    function showReportDetailsModal(report) {
        if (!report) { showNotification('Report not found', 'warning'); return; }

        const rid = report.id || '';
        const locationName = escapeHtml(report.location_name || report.location || 'Not specified');
        const coords = `${escapeHtml(String(report.latitude ?? 'N/A'))}, ${escapeHtml(String(report.longitude ?? 'N/A'))}`;
        const hazardType = escapeHtml(formatHazardType(report.hazard_type || report.type || 'other'));
        const severityHtml = renderSeverityStars(report.severity ?? report.severity_raw ?? 0);
        const priority = (report.priority_score !== undefined && report.priority_score !== null) ? Number(report.priority_score).toFixed(2) : 'N/A';
        const time = formatTimestamp(report.timestamp || report.created_at || new Date().toISOString());
        const description = escapeHtml(report.description || 'No description provided');

        let mediaHtml = '';
        if (Array.isArray(report.media_urls) && report.media_urls.length > 0) {
            mediaHtml = `<div class="d-flex flex-wrap">` +
                report.media_urls.map(url => {
                    const u = escapeHtml(url);
                    return `<a href="${u}" target="_blank" rel="noopener noreferrer"><img src="${u}" class="img-thumbnail m-1" style="max-width:200px; max-height:160px; object-fit:cover;"></a>`;
                }).join('') + `</div>`;
        }

        let weatherHtml = '';
        if (report.weather_conditions) {
            try { weatherHtml = `<pre style="background:#f8f9fa; padding:10px; border-radius:6px; max-height:240px; overflow:auto;">${escapeHtml(JSON.stringify(report.weather_conditions, null, 2))}</pre>`; }
            catch (e) { weatherHtml = `<div class="text-muted">Unable to render weather data</div>`; }
        }

        const status = report.verification_status || report.status || 'pending';
        const isPending = String(status).toLowerCase() === 'pending';

        const existing = document.getElementById('reportDetailModal');
        if (existing) existing.remove();

        const modalHtml = `
            <div class="modal fade" id="reportDetailModal" tabindex="-1" aria-hidden="true">
              <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                  <div class="modal-header">
                    <h5 class="modal-title">Report Details - ${escapeHtml(rid)}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                  </div>
                  <div class="modal-body">
                    <div class="row">
                      <div class="col-md-6">
                        <h6>Location</h6>
                        <p><strong>Coordinates:</strong> ${coords}</p>
                        <p><strong>Location Name:</strong> ${locationName}</p>
                      </div>
                      <div class="col-md-6">
                        <h6>Hazard</h6>
                        <p><strong>Type:</strong> ${hazardType}</p>
                        <p><strong>Severity:</strong> ${severityHtml}</p>
                        <p><strong>Priority Score:</strong> ${escapeHtml(String(priority))}</p>
                        <p><strong>Reported:</strong> ${escapeHtml(time)}</p>
                        <p><strong>Status:</strong> ${escapeHtml(String(status))}</p>
                      </div>
                    </div>

                    <div class="row mt-3">
                      <div class="col-12">
                        <h6>Description</h6>
                        <p>${description}</p>
                      </div>
                    </div>

                    ${report.media_urls && report.media_urls.length ? `
                      <div class="row mt-3"><div class="col-12"><h6>Media</h6>${mediaHtml}</div></div>` : ''}

                    ${report.weather_conditions ? `
                      <div class="row mt-3"><div class="col-12"><h6>Weather Conditions</h6>${weatherHtml}</div></div>` : ''}
                  </div>

                  <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    ${isPending ? `<button type="button" id="verifyBtn" class="btn btn-success">Verify</button>
                                   <button type="button" id="rejectBtn" class="btn btn-danger">Reject</button>` : ''}
                    <button type="button" id="alertAuthoritiesBtn" class="btn btn-warning">
                        <i class="fas fa-exclamation-triangle"></i> Alert Authorities
                    </button>
                  </div>
                </div>
              </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modalEl = document.getElementById('reportDetailModal');
        const bsModal = new bootstrap.Modal(modalEl);
        bsModal.show();

        modalEl.addEventListener('hidden.bs.modal', () => {
            try { modalEl.remove(); } catch (e) { /* ignore */ }
        });

        // Add event listeners
        const alertAuthoritiesBtn = document.getElementById('alertAuthoritiesBtn');
        if (alertAuthoritiesBtn) {
            alertAuthoritiesBtn.addEventListener('click', () => {
                bsModal.hide();
                showCreateAlertModal(rid);
            });
        }

        if (isPending) {
            const verifyBtn = document.getElementById('verifyBtn');
            const rejectBtn = document.getElementById('rejectBtn');

            if (verifyBtn) {
                verifyBtn.addEventListener('click', async () => {
                    try {
                        verifyBtn.disabled = true;
                        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
                        await verifyReport(rid, 'verified');
                        bsModal.hide();
                    } catch (err) {
                        showNotification('Failed to verify report', 'danger');
                        verifyBtn.disabled = false;
                        verifyBtn.innerHTML = 'Verify';
                    }
                });
            }

            if (rejectBtn) {
                rejectBtn.addEventListener('click', async () => {
                    try {
                        rejectBtn.disabled = true;
                        rejectBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rejecting...';
                        await verifyReport(rid, 'rejected');
                        bsModal.hide();
                    } catch (err) {
                        showNotification('Failed to reject report', 'danger');
                        rejectBtn.disabled = false;
                        rejectBtn.innerHTML = 'Reject';
                    }
                });
            }
        }
    }

    window.verifyReport = async function (reportId, status) {
        try {
            await apiCall(`/api/reports/${reportId}/verify`, {
                method: 'POST',
                body: { status: status, verifier_id: 'admin' }
            });
            showNotification(`Report ${status} successfully`, 'success');

            const modalEl = document.getElementById('reportDetailModal');
            if (modalEl) {
                const instance = bootstrap.Modal.getInstance(modalEl);
                if (instance) instance.hide();
                modalEl.remove();
            }
            await fetchRecentReports();
            await fetchDashboardStats();
            if (typeof window.refreshHazards === 'function') await window.refreshHazards();
        } catch (err) {
            console.error('verify error', err);
            showNotification('Failed to update report status', 'danger');
        }
    };

    /* ---------- tab switching ---------- */
    function setupTabSwitching() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                // Remove active class from all buttons and content
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));

                // Add active class to clicked button
                btn.classList.add('active');

                // Show corresponding content
                const tabName = btn.getAttribute('data-tab');
                const tabContent = document.getElementById(tabName + 'Tab');
                if (tabContent) {
                    tabContent.classList.add('active');
                }

                // Load tab-specific data
                if (tabName === 'alerts') {
                    await fetchAuthorityAlerts();
                } else if (tabName === 'trends') {
                    await fetchTrendingHazards();
                    await fetchSocialMediaActivity();
                } else if (tabName === 'reports') {
                    await fetchRecentReports();
                }
            });
        });
    }

    /* ---------- auto refresh / filters / init ---------- */
    function startAutoRefresh() {
        stopAutoRefresh();
        refreshInterval = setInterval(async () => {
            try {
                await Promise.all([fetchHazardData(), fetchDashboardStats(), fetchTrendingHazards(), fetchRecentReports()]);
                
                // Refresh alerts if alerts tab is active
                const activeTab = document.querySelector('.tab-btn.active');
                if (activeTab && activeTab.getAttribute('data-tab') === 'alerts') {
                    await fetchAuthorityAlerts();
                }
            } catch (err) {
                console.error('Auto refresh error', err);
            }
        }, REFRESH_INTERVAL);
    }

    function stopAutoRefresh() {
        if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    }

    function setupFilters() {
        const filterForm = document.getElementById('filterForm');
        if (!filterForm) return;
        filterForm.addEventListener('submit', async (e) => { e.preventDefault(); await applyFilters(); });
        const resetBtn = document.getElementById('resetFiltersBtn');
        if (resetBtn) resetBtn.addEventListener('click', async () => { filterForm.reset(); await resetFilters(); });
    }

    async function applyFilters() {
        const filterForm = document.getElementById('filterForm');
        if (!filterForm) return;
        const formData = new FormData(filterForm);
        const params = new URLSearchParams();
        ['locationFilter','hazardTypeFilter','startDate','endDate','minSeverity','verificationStatus'].forEach(k => {
            const v = formData.get(k);
            if (v) params.append(k.replace(/Filter$/,''), v);
        });
        try {
            const data = await apiCall(`/api/reports/filter?${params.toString()}`);
            const reports = (Array.isArray(data) ? data : (data.reports || []));
            currentHazards = reports.map(r => ({
                id: r.id, lat: r.latitude, lng: r.longitude, type: r.hazard_type || r.type,
                severity: getSeverityLevel(r.severity), title: r.location_name || r.location, description: r.description,
                timestamp: r.timestamp, status: r.verification_status
            }));
            updateMapMarkers();
            showNotification('Filters applied successfully', 'success');
        } catch (err) {
            console.error('applyFilters error', err);
            showNotification('Failed to apply filters', 'danger');
        }
    }

    async function resetFilters() {
        await fetchHazardData();
        showNotification('Filters reset', 'success');
    }

    /* ---------- event listeners setup ---------- */
    function setupEventListeners() {
        // Authority Alert Form
        const authorityAlertForm = document.getElementById('authorityAlertForm');
        if (authorityAlertForm) {
            authorityAlertForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = e.target.querySelector('button[type="submit"]');
                const originalBtnText = submitBtn.innerHTML;

                try {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending Alert...';

                    const formData = new FormData(authorityAlertForm);
                    const alertData = {
                        report_id: formData.get('report_id'),
                        authority_type: formData.get('authority_type'),
                        message: formData.get('message'),
                        status: formData.get('status')
                    };

                    await submitAuthorityAlert(alertData);
                    
                    // Close modal and reset form
                    const modal = bootstrap.Modal.getInstance(document.getElementById('authorityAlertModal'));
                    if (modal) modal.hide();
                    authorityAlertForm.reset();
                    
                } catch (err) {
                    console.error('Authority alert submission error:', err);
                    showNotification(`Failed to send alert: ${err.message}`, 'danger');
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                }
            });
        }

        // Create Alert Button
        const createAlertBtn = document.getElementById('createAlertBtn');
        if (createAlertBtn) {
            createAlertBtn.addEventListener('click', () => showCreateAlertModal());
        }

        // Refresh Button
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
                try {
                    await Promise.all([
                        fetchHazardData(), 
                        fetchDashboardStats(), 
                        fetchTrendingHazards(), 
                        fetchRecentReports(), 
                        fetchSocialMediaActivity()
                    ]);
                    
                    // Refresh alerts if alerts tab is active
                    const activeTab = document.querySelector('.tab-btn.active');
                    if (activeTab && activeTab.getAttribute('data-tab') === 'alerts') {
                        await fetchAuthorityAlerts();
                    }
                    
                    showNotification('Dashboard refreshed', 'success');
                } catch (err) {
                    showNotification('Refresh failed', 'danger');
                } finally {
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
                }
            });
        }
    }

    async function initializeDashboard() {
        try {
            initializeMap();
            setupFilters();
            setupTabSwitching();
            setupEventListeners();
            window.refreshHazards = fetchHazardData;

            await Promise.all([fetchHazardData(), fetchDashboardStats(), fetchTrendingHazards(), fetchRecentReports(), fetchSocialMediaActivity()]);

            startAutoRefresh();
            window.addEventListener('beforeunload', stopAutoRefresh);
            console.log('Dashboard initialized');
        } catch (err) {
            console.error('initializeDashboard error', err);
            showNotification('Dashboard initialization failed. Some features may not work.', 'warning');
        }
    }

    // Expose functions globally for inline onclick handlers
    window.showCreateAlertModal = showCreateAlertModal;
    
    // start
    initializeDashboard();
});