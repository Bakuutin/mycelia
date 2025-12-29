# Nginx GPU Reverse Proxy Setup

This setup provides a reverse proxy at port 8087 with basic authentication that routes:
- `/transcribe` → Whisper server
- Everything else → Ollama

## Setup Instructions

### 1. Configure Users

Edit `misc/nginx-auth-users.yml` to add your users:

```yaml
users:
  admin: changeme
  user1: password123
  user2: securepass
```

### 2. Generate .htpasswd File

Run the generation script to create the `.htpasswd` file:

```bash
cd misc
./generate-htpasswd.sh
```

This script requires either:
- Docker (recommended) - uses httpd:2.4-alpine container
- Or `htpasswd` command (from apache2-utils package)

The script will read `nginx-auth-users.yml` and generate `.htpasswd` with bcrypt-hashed passwords in the `misc/` directory.

### 3. Start Services

```bash
docker-compose -f docker-compose.gpu.yml up -d
```

## Usage

### Accessing Services

All requests to `http://localhost:8087` require basic authentication using the credentials defined in `misc/nginx-auth-users.yml`.

**Whisper Transcription:**
```bash
curl -u admin:changeme -X POST http://localhost:8087/transcribe \
  -F "files=@audio.wav"
```

**Ollama API:**
```bash
curl -u admin:changeme http://localhost:8087/api/tags
```

### Adding/Removing Users

1. Edit `misc/nginx-auth-users.yml`
2. Run `cd misc && ./generate-htpasswd.sh` to regenerate `.htpasswd`
3. Restart nginx: `docker-compose -f docker-compose.gpu.yml restart nginx`

### Manual htpasswd Generation

If you prefer to manually manage users, you can use:

```bash
cd misc
# Create new file
docker run --rm -v $(pwd):/work -w /work httpd:2.4-alpine \
  htpasswd -B -c .htpasswd username

# Add additional users
docker run --rm -v $(pwd):/work -w /work httpd:2.4-alpine \
  htpasswd -B .htpasswd username2
```

## Security Notes

- The `.htpasswd` file contains hashed passwords and should be kept secure
- Consider adding `.htpasswd` to `.gitignore` if not already present
- Use strong passwords for production environments
- Basic auth credentials are transmitted in base64 encoding - use HTTPS in production

