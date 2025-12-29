
import dotenv
from pathlib import Path
import urllib.parse
import os

# Try backend/.env first (single source of truth), fall back to root .env
root_path = Path(__file__).parent.parent.parent
backend_env = root_path / "backend" / ".env"
root_env = root_path / ".env"

if backend_env.exists():
    dotenv.load_dotenv(backend_env, override=True)
elif root_env.exists():
    dotenv.load_dotenv(root_env, override=True)
else:
    raise FileNotFoundError(
        f"No .env file found.\n\n"
        "To fix this:\n"
        "  1. cd backend && cp .env.example .env\n"
        "  2. Start the backend: deno task dev\n"
        "  3. Credentials are auto-generated on first run\n"
    )


def env(name: str, default: str | None = None) -> str:
    return os.getenv(name, default)

def get_url(*path):
    return urllib.parse.urljoin(env('MYCELIA_URL'), "/".join(path))

base_url = env('MYCELIA_URL') or ''
if base_url.startswith('http://'):
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

client_id = env('MYCELIA_CLIENT_ID')
client_secret = env('MYCELIA_TOKEN')
