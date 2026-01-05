import requests
from typing import Any, Optional
from datetime import datetime, timezone
from bson import ObjectId
from contextvars import ContextVar

from .config import get_url

# ContextVars to store per-request job state
job_token_var: ContextVar[Optional[str]] = ContextVar("job_token", default=None)
job_session_var: ContextVar[Optional[requests.Session]] = ContextVar("job_session", default=None)


def get_session() -> requests.Session:
    """Get or create a requests Session for the current job context."""
    session = job_session_var.get()
    if session is None:
        session = requests.Session()
        token = job_token_var.get()
        if token:
            session.headers.update({"Authorization": f"Bearer {token}"})
        job_session_var.set(session)
    return session


def ensure_authorized() -> None:
    """Ensure the current session has a token. Raises if no token is available."""
    token = job_token_var.get()
    if not token:
        raise RuntimeError("No job token available in current context. Fallback authentication is disabled.")


def encode_typed(obj: Any) -> Any:
    if isinstance(obj, datetime):
        if obj.tzinfo is None:
            obj = obj.replace(tzinfo=timezone.utc)
        iso = obj.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        return {"$date": iso}
    if isinstance(obj, ObjectId):
        return {"$oid": str(obj)}
    if isinstance(obj, dict):
        return {k: encode_typed(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [encode_typed(v) for v in obj]
    return obj
