/**
 * Throws a 403 Forbidden response with a message indicating permission denied.
 * This function is used to indicate that the user does not have permission to access a resource.
 * 
 * @throws {Response} 403 Forbidden
 */
export function permissionDenied(): never {
    throw new Response("Permission denied", { status: 403 });
} 