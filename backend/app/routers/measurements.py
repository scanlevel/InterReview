"""B-owned endpoint for captured audio and vision measurements."""

from fastapi import APIRouter

from app.schemas import MeasurementReport, MeasurementRequest
from app.services.measurements import build_measurement_report

router = APIRouter(tags=["measurements"])


@router.post("/measurements", response_model=MeasurementReport)
def create_measurement_report(request: MeasurementRequest) -> MeasurementReport:
    return build_measurement_report(request)
