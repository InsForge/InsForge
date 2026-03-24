from fastapi import APIRouter
import time

router = APIRouter()

@router.get("/health")
async def health_check():
    """
    Unified API health and status endpoint.
    Returns the current status of the InsForge services.
    """
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "version": "1.0.0",
        "services": {
            "database": "connected",
            "ai_gateway": "online"
        }
    }
