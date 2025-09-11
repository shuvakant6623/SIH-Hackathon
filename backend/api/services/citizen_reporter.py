from fastapi import APIRouter, File, UploadFile, HTTPException, Depends, Form
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timedelta
import os
import aiofiles
from geopy.distance import geodesic
import uuid
import json
from dataclasses import asdict

# Import your models / schemas (adjust import path if needed)
from backend.api.models.schemas import HazardReport, ReportSubmission, IST, SessionLocal

router = APIRouter()


class HazardReportManager:
    def __init__(self):
        self.media_storage_path = os.path.join(os.getcwd(), "uploads", "hazard_media")
        os.makedirs(self.media_storage_path, exist_ok=True)

        self.hazard_weights = {
            'tsunami': 5.0,
            'storm_surge': 4.5,
            'cyclone': 4.5,
            'coastal_flooding': 3.5,
            'high_waves': 3.0,
            'rip_current': 3.0,
            'coastal_erosion': 2.0,
            'other': 1.0
        }

    def calculate_priority_score(self, report: ReportSubmission, nearby_reports: List) -> float:
        base_score = self.hazard_weights.get(report.hazard_type, 1.0)
        severity_multiplier = report.severity / 5.0

        cluster_bonus = min(len(nearby_reports) * 0.2, 2.0)  # Max 2x bonus for clustering

        time_factor = 1.0

        priority_score = base_score * severity_multiplier * (1 + cluster_bonus) * time_factor
        return round(priority_score, 2)

    def find_nearby_reports(self, db: Session, lat: float, lon: float, radius_km: float = 5.0) -> List:
        """Find all reports within specified radius"""
        all_reports = db.query(HazardReport).filter(
            HazardReport.timestamp >= datetime.now(IST) - timedelta(hours=24)
        ).all()

        nearby = []
        current_location = (lat, lon)

        for report in all_reports:
            report_location = (report.latitude, report.longitude)
            try:
                distance = geodesic(current_location, report_location).kilometers
            except Exception:
                continue

            if distance <= radius_km:
                nearby.append({
                    'id': report.id,
                    'distance_km': round(distance, 2),
                    'hazard_type': report.hazard_type,
                    'severity': report.severity
                })

        return nearby

    async def save_media_bytes(self, content: bytes, orig_filename: str) -> str:
        file_extension = orig_filename.split('.')[-1] if '.' in orig_filename else ''
        unique_filename = f"{uuid.uuid4()}.{file_extension}" if file_extension else str(uuid.uuid4())
        file_path = os.path.join(self.media_storage_path, unique_filename)

        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(content)

        # Return path relative to backend root that will be mounted at /media/hazard
        return f"/media/hazard/{unique_filename}"

    def validate_report_location(self, lat: float, lon: float) -> bool:
        """Validate if location is near Indian coastline"""
        indian_coastal_bounds = {
            'min_lat': 8.0,   # Southern tip
            'max_lat': 23.5,  # Gujarat coast
            'min_lon': 68.0,  # Western coast
            'max_lon': 97.5   # Eastern coast
        }

        return (indian_coastal_bounds['min_lat'] <= lat <= indian_coastal_bounds['max_lat'] and
                indian_coastal_bounds['min_lon'] <= lon <= indian_coastal_bounds['max_lon'])


report_manager = HazardReportManager()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def get_hazard_hotspots(
    time_range: int = 24,  # hours
    min_reports: int = 3,
    db: Session = Depends(get_db)
):
    """Identify hotspot clusters from recent reports.

    - Groups recent reports (within `time_range` hours) into geographic grid cells
      (grid_size degrees, ~11km for 0.1) and aggregates counts and severity.
    - Returns cells that have at least `min_reports` reports with computed
      average severity, hazard types and a simple threat level.
    """

    cutoff_time = datetime.now(IST) - timedelta(hours=time_range)
    recent_reports = db.query(HazardReport).filter(
        HazardReport.timestamp >= cutoff_time
    ).all()

    grid_size = 0.1  # ~11km grid cells
    clusters = {}

    for report in recent_reports:
        grid_key = (
            round(report.latitude / grid_size) * grid_size,
            round(report.longitude / grid_size) * grid_size
        )

        if grid_key not in clusters:
            clusters[grid_key] = {
                'center_lat': grid_key[0],
                'center_lon': grid_key[1],
                'reports': [],
                'total_severity': 0,
                'hazard_types': set()
            }

        clusters[grid_key]['reports'].append(report.id)
        clusters[grid_key]['total_severity'] += getattr(report, 'severity', 0)
        clusters[grid_key]['hazard_types'].add(getattr(report, 'hazard_type', 'unknown'))

    hotspots = []
    for grid_key, cluster in clusters.items():
        if len(cluster['reports']) >= min_reports:
            avg_severity = cluster['total_severity'] / len(cluster['reports']) if cluster['reports'] else 0
            hotspots.append({
                'latitude': cluster['center_lat'],
                'longitude': cluster['center_lon'],
                'report_count': len(cluster['reports']),
                'average_severity': round(avg_severity, 2),
                'hazard_types': list(cluster['hazard_types']),
                'threat_level': 'high' if avg_severity >= 3.5 else 'medium'
            })

    # Sort by a simple score: count * average_severity
    hotspots.sort(key=lambda x: x['report_count'] * x['average_severity'], reverse=True)

    return {
        "hotspots": hotspots,
        "total_reports": len(recent_reports),
        "time_range_hours": time_range
    }




@router.post("/api/report/submit")
async def submit_hazard_report(
    user_id: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    location_name: str = Form(None),
    hazard_type: str = Form(...),
    severity: int = Form(...),
    description: str = Form(...),
    weather_conditions: str = Form(None),
    media_files: List[UploadFile] = File(None),
    db: Session = Depends(get_db)
):

    if not report_manager.validate_report_location(latitude, longitude):
        raise HTTPException(status_code=400, detail="Location must be near Indian coastline")

    weather_data = json.loads(weather_conditions) if weather_conditions else None

    report = ReportSubmission(
        user_id=user_id,
        latitude=latitude,
        longitude=longitude,
        location_name=location_name,
        hazard_type=hazard_type,
        severity=severity,
        description=description,
        weather_conditions=weather_data
    )

    nearby_reports = report_manager.find_nearby_reports(db, latitude, longitude)

    priority_score = report_manager.calculate_priority_score(report, nearby_reports)

    media_urls = []
    if media_files:
        for file in media_files:
            # Read bytes and check size
            content = await file.read()
            if len(content) > 10 * 1024 * 1024:  # 10MB limit
                raise HTTPException(status_code=400, detail="File size exceeds 10MB limit")

            media_url = await report_manager.save_media_bytes(content, file.filename)
            media_urls.append(media_url)

    db_report = HazardReport(
        id=str(uuid.uuid4()),
        user_id=report.user_id,
        latitude=report.latitude,
        longitude=report.longitude,
        location_name=report.location_name,
        hazard_type=report.hazard_type,
        severity=report.severity,
        description=report.description,
        media_urls=media_urls,
        priority_score=priority_score,
        nearby_reports=nearby_reports,
        weather_conditions=report.weather_conditions
    )

    db.add(db_report)
    db.commit()

    return {
        "status": "success",
        "report_id": db_report.id,
        "priority_score": priority_score,
        "nearby_reports_count": len(nearby_reports),
        "message": "Report submitted successfully. Authorities have been notified."
    }


@router.get("/api/reports/hotspots")
@router.get("/api/weather")
async def get_weather_data(lat: float, lon: float):
    """Get current weather data for a location (mock)"""
    try:
        return {
            "temperature": 28,
            "wind_speed": 15,
            "wind_direction": "NE",
            "humidity": 75,
            "pressure": 1010,
            "weather_description": "Partly Cloudy",
            "precipitation": 0,
            "wave_height": 1.5,
            "timestamp": datetime.now(IST).isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/dashboard/stats")
async def get_dashboard_stats(db: Session = Depends(get_db)):
    """Get statistics for the dashboard"""
    now = datetime.now(IST)

    # Get counts for different time periods
    last_24h = now - timedelta(hours=24)

    # Active reports (last 24 hours)
    active_reports = db.query(HazardReport).filter(
        HazardReport.timestamp >= last_24h
    ).all()

    # Hazard type distribution
    hazard_counts = {}
    severity_sum = 0
    verified_count = 0
    high_priority_count = 0

    for report in active_reports:
        hazard_counts[report.hazard_type] = hazard_counts.get(report.hazard_type, 0) + 1
        severity_sum += report.severity
        if getattr(report, 'verification_status', None) == 'verified':
            verified_count += 1
        if getattr(report, 'priority_score', 0) >= 4.0:
            high_priority_count += 1

    # Get hotspots
    hotspots = await get_hazard_hotspots(db=db)

    return {
        "total_reports": len(active_reports),
        "verified_reports": verified_count,
        "active_hazards": len(hazard_counts),
        "high_priority_alerts": high_priority_count,
        "hotspot_count": len(hotspots["hotspots"]),
        "average_severity": round(severity_sum / len(active_reports), 2) if active_reports else 0,
        "hazard_distribution": hazard_counts,
        "last_updated": now.isoformat()
    }


@router.get("/api/reports/active")
async def get_active_reports(
    db: Session = Depends(get_db),
    hours: int = 24,
    min_severity: int = None,
    verification_status: str = None
):
    """Get active hazard reports within the specified time window"""
    cutoff_time = datetime.now(IST) - timedelta(hours=hours)

    query = db.query(HazardReport).filter(HazardReport.timestamp >= cutoff_time)

    if min_severity:
        query = query.filter(HazardReport.severity >= min_severity)
    if verification_status:
        query = query.filter(HazardReport.verification_status == verification_status)

    reports = query.order_by(HazardReport.priority_score.desc()).all()

    return [
        {
            "id": report.id,
            "hazard_type": report.hazard_type,
            "severity": report.severity,
            "latitude": report.latitude,
            "longitude": report.longitude,
            "location_name": report.location_name,
            "description": report.description,
            "timestamp": report.timestamp.isoformat(),
            "verification_status": report.verification_status,
            "priority_score": report.priority_score,
            "media_urls": report.media_urls
        }
        for report in reports
    ]


@router.get("/api/reports/filter")
async def filter_reports(
    db: Session = Depends(get_db),
    start_date: str = None,
    end_date: str = None,
    location: str = None,
    hazard_type: str = None,
    min_severity: int = None,
    verification_status: str = None
):
    """Filter reports based on various criteria"""
    query = db.query(HazardReport)

    if start_date:
        query = query.filter(HazardReport.timestamp >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.filter(HazardReport.timestamp <= datetime.fromisoformat(end_date))
    if location:
        query = query.filter(HazardReport.location_name.ilike(f"%{location}%"))
    if hazard_type:
        query = query.filter(HazardReport.hazard_type == hazard_type)
    if min_severity:
        query = query.filter(HazardReport.severity >= min_severity)
    if verification_status:
        query = query.filter(HazardReport.verification_status == verification_status)

    reports = query.order_by(HazardReport.timestamp.desc()).all()

    return [
        {
            "id": report.id,
            "hazard_type": report.hazard_type,
            "severity": report.severity,
            "latitude": report.latitude,
            "longitude": report.longitude,
            "location_name": report.location_name,
            "description": report.description,
            "timestamp": report.timestamp.isoformat(),
            "verification_status": report.verification_status,
            "priority_score": report.priority_score,
            "media_urls": report.media_urls,
            "weather_conditions": report.weather_conditions
        }
        for report in reports
    ]


@router.get("/api/reports/{report_id}")
async def get_report_details(
    report_id: str,
    db: Session = Depends(get_db)
):
    """Get detailed information about a specific report"""
    report = db.query(HazardReport).filter(HazardReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    return {
        "id": report.id,
        "user_id": report.user_id,
        "hazard_type": report.hazard_type,
        "severity": report.severity,
        "latitude": report.latitude,
        "longitude": report.longitude,
        "location_name": report.location_name,
        "description": report.description,
        "timestamp": report.timestamp.isoformat(),
        "verification_status": report.verification_status,
        "priority_score": report.priority_score,
        "media_urls": report.media_urls,
        "weather_conditions": report.weather_conditions,
        "nearby_reports": report.nearby_reports
    }


@router.get("/api/reports/submit/{report_id}")
async def verify_report(
    report_id: str,
    status: str,
    verifier_id: str,
    db: Session = Depends(get_db)
):

    if status not in ['verified', 'rejected']:
        raise HTTPException(status_code=400, detail="Status must be 'verified' or 'rejected'")

    report = db.query(HazardReport).filter(HazardReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    report.verification_status = status
    report.verifier_id = verifier_id
    report.verification_timestamp = datetime.now(IST)
    db.commit()

    return {
        "status": "success",
        "report_id": report_id,
        "new_status": status,
        "verified_by": verifier_id,
        "verification_timestamp": report.verification_timestamp.isoformat()
    }