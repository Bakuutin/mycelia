from .api import session, ensure_authorized
from .config import get_url
from typing import Any
import json


from bson import ObjectId
from datetime import datetime
import base64
import pytz


class EJsonEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return {"$oid": str(obj)}
        if isinstance(obj, datetime):
            utc = obj.astimezone(pytz.utc)
            return {"$date": utc.isoformat().replace( "+00:00", "Z")}
        if isinstance(obj, bytes):
            return {
                "$binary": {
                    "base64": base64.b64encode(obj).decode(),
                    "subType": "00",
                }
            }
        return super().default(obj)


class EJsonDecoder(json.JSONDecoder):
    def __init__(self, *args, **kwargs):
        kwargs['object_hook'] = self._object_hook
        super().__init__(*args, **kwargs)

    @staticmethod
    def _object_hook(dct):
        if "$oid" in dct:
            return ObjectId(dct["$oid"])
        if "$date" in dct:
            iso = dct["$date"]
            if iso.endswith("Z"):
                iso = iso[:-1] + "+00:00"
            return datetime.fromisoformat(iso)
        if "$binary" in dct:
            binary_data = dct["$binary"]
            base64_str = binary_data["base64"]
            if binary_data.get("subType", "00") != "00":
                raise ValueError
            return base64.b64decode(base64_str)
        return dct


def call_resource(resource_name: str, body: dict) -> Any:
    ensure_authorized()
    response = session.post(
        get_url("api", "resource", resource_name),
        data=json.dumps(body, cls=EJsonEncoder),
        headers={"Content-Type": "application/json"},
        timeout=600,
    )
    response.raise_for_status()
    return json.loads(response.text, cls=EJsonDecoder)
