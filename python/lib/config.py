
import dotenv
from pathlib import Path
import urllib.parse
import os

env_path = Path(__file__).parent.parent.parent / "backend" / ".env"
assert env_path.exists(), f"Environment file not found at {env_path}"
dotenv.load_dotenv(env_path)


def env(name: str, default: str | None = None) -> str:
    return os.getenv(name, default)

def get_url(*path):
    return urllib.parse.urljoin(env('MYCELIA_URL'), "/".join(path))

base_url = env('MYCELIA_URL') or ''
if base_url.startswith('http://'):
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

client_id = env('MYCELIA_CLIENT_ID')
client_secret = env('MYCELIA_TOKEN')
