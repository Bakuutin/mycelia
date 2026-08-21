type SetupLocation = Pick<Location, "hostname" | "origin" | "port">;

const MEDIA_DEV_PORTS = new Set(["3211", "4443"]);
const DEFAULT_DOCKER_ENDPOINT = "https://localhost:4433";

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "::1" || hostname === "[::1]";
}

export function isMediaDevSetupLocation(location: SetupLocation): boolean {
  return isLoopbackHost(location.hostname) &&
    MEDIA_DEV_PORTS.has(location.port);
}

export function getDockerSetupEndpoint(location: SetupLocation): string {
  return isMediaDevSetupLocation(location)
    ? location.origin
    : DEFAULT_DOCKER_ENDPOINT;
}

export function getDockerTokenCommand(
  tokenName: string,
  location: SetupLocation,
): string {
  if (isMediaDevSetupLocation(location)) {
    return `docker exec -it -w /app mycelia-media-89da-backend-1 deno run -A server.ts token-create --name ${tokenName}`;
  }

  return `docker compose exec backend deno run -A server.ts token-create --name ${tokenName}`;
}
