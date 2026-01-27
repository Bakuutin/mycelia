/**
 * Proxy routes for the diarization/speaker recognition service.
 * Forwards requests to the diarization service (default: http://localhost:8085).
 */
import type { Request, Response } from "express";
import { authenticateOr401 } from "../lib/auth/core.server.ts";

// Get diarization service URL from environment or use default
const DIARIZATION_SERVICE_URL = (
  Deno.env.get("DIARIZATION_SERVER_URL") ||
  Deno.env.get("SPEAKER_SERVICE_URL") ||
  "http://localhost:8085"
).replace(/\/$/, "");

/**
 * Proxy handler for diarization service requests.
 * Supports both GET and POST requests, forwarding to the speaker recognition service.
 */
export async function apiDiarizationProxyHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Authenticate the request
    await authenticateOr401(req, res);

    // Extract the path after /api/diarization
    const subPath = req.params[0] || "";
    const targetUrl = `${DIARIZATION_SERVICE_URL}/${subPath}`;

    // Build query string if present
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const fullUrl = queryString ? `${targetUrl}?${queryString}` : targetUrl;

    console.log(`[diarization-proxy] ${req.method} ${fullUrl}`);

    // Prepare headers (forward auth if needed, but diarization service is internal)
    const headers: Record<string, string> = {
      "Accept": "application/json",
    };

    // Handle different request types
    let body: BodyInit | undefined;
    const contentType = req.headers["content-type"] || "";

    if (req.method !== "GET" && req.method !== "HEAD") {
      if (contentType.includes("multipart/form-data")) {
        // For multipart requests, we need to reconstruct the form data
        // This is tricky with Express - we'll pass through the raw request
        // Actually, since Express parses the body, we need to handle this differently

        // For file uploads, we need to handle this specially
        // The frontend should send directly to the diarization service for file uploads
        // Or we need to use a middleware like multer

        // For now, let's handle JSON requests and simple form data
        res.status(400).json({
          error: "File upload proxy not yet implemented. Please use direct upload to diarization service."
        });
        return;
      } else if (contentType.includes("application/json")) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(req.body);
      } else if (req.body) {
        headers["Content-Type"] = contentType;
        body = JSON.stringify(req.body);
      }
    }

    // Make the proxied request
    const proxyResponse = await fetch(fullUrl, {
      method: req.method,
      headers,
      body,
    });

    // Forward the response
    const responseContentType = proxyResponse.headers.get("content-type") || "application/json";
    res.status(proxyResponse.status);
    res.setHeader("Content-Type", responseContentType);

    if (responseContentType.includes("application/json")) {
      const data = await proxyResponse.json();
      res.json(data);
    } else {
      const buffer = await proxyResponse.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return; // Already sent 401 response
    }

    console.error("[diarization-proxy] Error:", error);

    // Check if it's a connection error to the diarization service
    if (error instanceof TypeError && error.message.includes("fetch failed")) {
      res.status(503).json({
        error: "Diarization service unavailable",
        message: `Could not connect to diarization service at ${DIARIZATION_SERVICE_URL}`,
        hint: "Make sure the diarization service is running (docker compose up diarization)"
      });
      return;
    }

    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Dedicated handler for speaker enrollment with file uploads.
 * Uses multer or similar for handling multipart/form-data.
 */
export async function apiDiarizationEnrollHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    await authenticateOr401(req, res);

    // For file uploads, we need to stream the request body
    // This is a special case that requires different handling

    const targetUrl = `${DIARIZATION_SERVICE_URL}/enroll/batch`;
    console.log(`[diarization-proxy] POST ${targetUrl} (file upload)`);

    // Get the raw content-type header including boundary
    const contentType = req.headers["content-type"];
    if (!contentType?.includes("multipart/form-data")) {
      res.status(400).json({ error: "Expected multipart/form-data" });
      return;
    }

    // For multipart uploads, we need to forward the raw body
    // This requires collecting the raw body chunks
    const chunks: Uint8Array[] = [];

    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk: Buffer) => {
        chunks.push(new Uint8Array(chunk));
      });
      req.on("end", resolve);
      req.on("error", reject);
    });

    const bodyBuffer = Buffer.concat(chunks.map(c => Buffer.from(c)));

    const proxyResponse = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
      },
      body: bodyBuffer,
    });

    const data = await proxyResponse.json();
    res.status(proxyResponse.status).json(data);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return;
    }

    console.error("[diarization-proxy] Enroll error:", error);
    res.status(500).json({
      error: "Enrollment failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
