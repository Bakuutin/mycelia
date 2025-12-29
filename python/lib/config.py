
import dotenv
from pathlib import Path
import urllib.parse
import os

env_path = Path(__file__).parent.parent.parent / ".env"
if not env_path.exists():
    raise FileNotFoundError(
        f"Root .env file not found at {env_path}\n\n"
        "To fix this:\n"
        "  1. cp .env.example .env\n"
        "  2. Start the backend: cd backend && deno task dev\n"
        "  3. Copy MYCELIA_TOKEN and MYCELIA_CLIENT_ID from console to root .env\n"
    )
dotenv.load_dotenv(env_path, override=True)


def env(name: str, default: str | None = None) -> str:
    return os.getenv(name, default)

def get_url(*path):
    return urllib.parse.urljoin(env('MYCELIA_URL'), "/".join(path))

base_url = env('MYCELIA_URL') or ''
if base_url.startswith('http://'):
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

client_id = env('MYCELIA_CLIENT_ID')
client_secret = env('MYCELIA_TOKEN')
