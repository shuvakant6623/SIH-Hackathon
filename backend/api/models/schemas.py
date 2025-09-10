from pydantic import BaseModel, field_validator
from typing import Optional ,Dict
from sqlalchemy import create_engine, Column, String, Float, Integer, DateTime, JSON, Text
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
import pytz
from datetime import datetime
# Database Configuration
DATABASE_URL = "sqlite:///./backend/data/database/citizen_reporter.db"
engine = create_engine(
    DATABASE_URL, 
    connect_args={"check_same_thread": False}  #only for sqlite
)
IST = pytz.timezone('Asia/Kolkata')

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class HazardReport(Base):
    __tablename__ = "hazard_reports"
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    timestamp = Column(DateTime, default= lambda: datetime.now(IST))
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    location_name = Column(String)
    hazard_type = Column(String, nullable=False)
    severity = Column(Integer)  # 1-5 scale
    description = Column(Text)
    media_urls = Column(JSON)
    verification_status = Column(String, default="pending")  
    priority_score = Column(Float)
    nearby_reports = Column(JSON)  # IDs of reports within 5km
    weather_conditions = Column(JSON)
    
Base.metadata.create_all(bind=engine)

class ReportSubmission(BaseModel):
    user_id: str
    latitude: float
    longitude: float
    location_name: Optional[str] = None
    hazard_type: str
    severity: int
    description: str
    weather_conditions: Optional[Dict] = None
    
    @field_validator('latitude')
    def validate_latitude(cls, v):
        if not -90 <= v <= 90:
            raise ValueError('Invalid latitude')
        return v
    
    @field_validator('longitude')
    def validate_longitude(cls, v):
        if not -180 <= v <= 180:
            raise ValueError('Invalid longitude')
        return v
    
    @field_validator('hazard_type')
    def validate_hazard_type(cls, v):
        valid_types = ['tsunami', 'storm_surge', 'high_waves', 'coastal_flooding', 
                      'cyclone', 'rip_current', 'coastal_erosion', 'other']
        if v not in valid_types:
            raise ValueError(f'Hazard type must be one of {valid_types}')
        return v
    
    @field_validator('severity')
    def validate_severity(cls, v):
        if not 1 <= v <= 5:
            raise ValueError('Severity must be between 1 and 5')
        return v