export function permissionDenied(detail?: any): never {
  throw new Response(
    JSON.stringify({
      status: 403,
      detail: detail || "Permission denied",
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}
