
import dotenv
from pathlib import Path
import urllib.parse
import os

# Local dev loads from repo-root `.env` (when present).
# In Docker, set `MYCELIA_ENV_FILE=/run/mycelia/mycelia.env` (or rely on env vars).
env_file_override = os.getenv("MYCELIA_ENV_FILE")
candidate_paths: list[Path] = []
if env_file_override:
    candidate_paths.append(Path(env_file_override))
candidate_paths.append(Path(__file__).resolve().parent.parent.parent / ".env")
candidate_paths.append(Path.cwd() / ".env")

for env_path in candidate_paths:
    try:
        if env_path.exists():
            dotenv.load_dotenv(env_path, override=True)
            break
    except Exception:
        # Ignore invalid/unreadable paths; env vars may already be set
        pass


def env(name: str, default: str | None = None) -> str:
    return os.getenv(name, default)

def get_url(*path):
    return urllib.parse.urljoin(env('MYCELIA_URL'), "/".join(path))

base_url = env('MYCELIA_URL') or ''
if base_url.startswith('http://'):
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

client_id = env('MYCELIA_CLIENT_ID')
client_secret = env('MYCELIA_TOKEN')
