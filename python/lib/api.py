from requests_oauthlib import OAuth2Session
from oauthlib.oauth2 import BackendApplicationClient
from typing import Any
from datetime import datetime, timezone
from bson import ObjectId

from .config import client_id, client_secret, get_url

token_url = get_url("oauth", "token")

oauth_client = BackendApplicationClient(client_id=client_id)


session = OAuth2Session(
    client_id=client_id, client=oauth_client, auto_refresh_url=token_url, auto_refresh_kwargs={"client_secret": client_secret},
    token_updater=lambda token: print(token) or session.headers.update({"Authorization": f"Bearer {token['access_token']}"})
)


def ensure_authorized() -> None:
    if not session.authorized:
        session.fetch_token(token_url, client_id=client_id, client_secret=client_secret)


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
