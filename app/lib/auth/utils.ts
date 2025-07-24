/**
 * Throws a 403 Forbidden response with a message indicating permission denied.
 * This function is used to indicate that the user does not have permission to access a resource.
 *
 * @throws {Response} 403 Forbidden
 */
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
