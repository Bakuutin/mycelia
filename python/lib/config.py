
import dotenv
from pathlib import Path
import urllib.parse
import os

env_path = Path(__file__).parent.parent.parent / ".env"
if env_path.exists():
    dotenv.load_dotenv(env_path, override=True)


def env(name: str, default: str | None = None) -> str:
    return os.getenv(name, default)

def get_url(*path):
    return urllib.parse.urljoin(env('MYCELIA_URL'), "/".join(path))

base_url = env('MYCELIA_URL') or ''


ALLOW_INSECURE_TRANSPORT = base_url.startswith('http://') or env('ALLOW_INSECURE_TRANSPORT', 'false') == 'true'

if ALLOW_INSECURE_TRANSPORT:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

client_id = env('MYCELIA_CLIENT_ID')
client_secret = env('MYCELIA_TOKEN')
