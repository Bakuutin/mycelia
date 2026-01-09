# Networking & Reverse Proxy

Mycelia uses Nginx as a reverse proxy to provide a single entry point for the application, handle SSL/TLS, and route traffic between the frontend and backend.

## Architecture

By default, Nginx listens on port `4433` (HTTPS) and routes traffic as follows:

- `/api/*`, `/ws/*`, `/oauth/*`, `/v1/*`, etc. → `backend:5173`
- Everything else → `frontend:8080`

## Configuration

### Ports

You can customize the ports used by both Nginx and the individual services via environment variables in your `.env` file:

| Service | Environment Variable | Default Port | Description |
|---------|----------------------|--------------|-------------|
| **Nginx** | `NGINX_PORT` | `4433` | Primary HTTPS entry point |
| **Nginx** | `NGINX_HTTP_PORT` | `80` | HTTP entry point |
| **Nginx** | `NGINX_HTTPS_PORT` | `443` | Standard HTTPS entry point |
| **Frontend** | `FRONTEND_PORT` | `8080` | Direct access to Vite/Nginx frontend |
| **Backend** | `BACKEND_PORT` | `5173` | Direct access to Deno backend |
| **Worker** | `PYTHON_WORKER_PORT` | `8000` | Direct access to Python worker |
| **Database** | `MONGO_PORT` | `27017` | Direct access to MongoDB |

### SSL / Certificates

Nginx is configured to use SSL. For local development, you can generate a self-signed certificate:

```bash
# Generate self-signed certificates in misc/nginx/ssl/
./misc/nginx/generate-self-signed.sh
```

The certificates are stored in `misc/nginx/ssl/` and are automatically ignored by git.

#### Custom Certificates
To use your own certificates (e.g., from Let's Encrypt), place them in `misc/nginx/ssl/`:
- `fullchain.pem`
- `privkey.pem`

## Direct Service Access

While the Nginx proxy is the recommended way to access the application, all services remain accessible directly on their respective ports for backwards compatibility and debugging.

- **Frontend**: [http://localhost:8080](http://localhost:8080)
- **Backend**: [http://localhost:5173](http://localhost:5173)
- **Proxy**: [https://localhost:4433](https://localhost:4433) (Note: use `https://`)

## Troubleshooting

### "Privacy Error" in Browser
When using self-signed certificates, your browser will show a warning (e.g., `NET::ERR_CERT_AUTHORITY_INVALID`). You can usually bypass this by clicking "Advanced" and then "Proceed to localhost (unsafe)".

### WebSocket Connections
If you are behind an additional proxy (like Cloudflare or another Nginx instance), ensure that `Upgrade` and `Connection` headers are correctly forwarded to support WebSockets.

