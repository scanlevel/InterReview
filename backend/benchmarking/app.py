"""Compatibility entry point; annotation is served by the main FastAPI app."""

from app.main import app

__all__ = ["app"]
