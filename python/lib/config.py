
import dotenv

dotenv.load_dotenv(f'{__file__}/../../.env')


from requests_oauthlib import OAuth2Session
from oauthlib.oauth2 import BackendApplicationClient
from typing import Any
from datetime import datetime, timezone
from bson import ObjectId
import json
import os


def env(name: str, default: str | None = None) -> str:
    return os.getenv(name, default)

def get_url(*path):
    return env('MYCELIA_URL') + "/" + "/".join(path)

base_url = env('MYCELIA_URL') or ''
if base_url.startswith('http://'):
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

client_id = env('MYCELIA_CLIENT_ID')
client_secret = env('MYCELIA_TOKEN')
