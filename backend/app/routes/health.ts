import type { Request, Response } from "express";

const serviceStartedAt = new Date();
let serviceReady = false;

export function setServiceReady(ready: boolean): void {
  serviceReady = ready;
}

export function getServiceReadiness(): "ready" | "starting" {
  return serviceReady ? "ready" : "starting";
}

export async function rootHandler(_req: Request, res: Response) {
  res.json({
    message: "Mycelia API is running 🍄",
  });
}

export async function healthHandler(_req: Request, res: Response) {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}

export async function readinessHandler(_req: Request, res: Response) {
  const status = getServiceReadiness();
  res.status(status === "ready" ? 200 : 503).json({
    status,
    startedAt: serviceStartedAt.toISOString(),
    timestamp: new Date().toISOString(),
  });
}
