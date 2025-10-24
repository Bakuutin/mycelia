from .api import session, ensure_authorized, encode_typed, decode_typed
from .config import get_url
from typing import Any
import json

def call_resource(resource_name: str, body: dict) -> Any:
    ensure_authorized()
    encoded = encode_typed(body)
    response = session.post(
        get_url("api", "resource", resource_name),
        data=json.dumps(encoded),
        headers={"Content-Type": "application/json"},
    )
    response.raise_for_status()
    data = response.json()
    return decode_typed(data)

