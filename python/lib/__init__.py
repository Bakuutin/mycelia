
import dotenv

dotenv.load_dotenv(f'{__file__}/../../.env')


from requests_oauthlib import OAuth2Session
from oauthlib.oauth2 import BackendApplicationClient
from typing import Any
from datetime import datetime, timezone
from bson import ObjectId
import json
import os

from .config import client_id, client_secret, get_url

token_url = get_url("oauth", "token")

oauth_client = BackendApplicationClient(client_id=client_id)
session = OAuth2Session(
    client_id=client_id, client=oauth_client, auto_refresh_url=token_url, auto_refresh_kwargs={"client_secret": client_secret},
    token_updater=lambda token: print(token) or session.headers.update({"Authorization": f"Bearer {token['access_token']}"})
)

def _encode_typed(obj: Any) -> Any:
    if isinstance(obj, datetime):
        if obj.tzinfo is None:
            obj = obj.replace(tzinfo=timezone.utc)
        iso = obj.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        return {"$date": iso}
    if isinstance(obj, ObjectId):
        return {"$oid": str(obj)}
    if isinstance(obj, dict):
        return {k: _encode_typed(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_encode_typed(v) for v in obj]
    return obj


def _parse_iso8601_z(iso: str) -> datetime:
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    return datetime.fromisoformat(iso).astimezone(timezone.utc)


def _decode_typed(obj: Any) -> Any:
    if isinstance(obj, dict):
        if set(obj.keys()) == {"$date"}:
            return _parse_iso8601_z(obj["$date"])  
        if set(obj.keys()) == {"$oid"}:
            return ObjectId(obj["$oid"])  
        return {k: _decode_typed(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_decode_typed(v) for v in obj]
    return obj


def call_resource(resource_name: str, body: dict) -> Any:
    if not session.authorized:
        session.fetch_token(token_url, client_id=client_id, client_secret=client_secret)
    encoded = _encode_typed(body)
    response = session.post(
        get_url("api", "resource", resource_name),
        data=json.dumps(encoded),
        headers={"Content-Type": "application/json"},
    )
    response.raise_for_status()
    data = response.json()
    return _decode_typed(data)

