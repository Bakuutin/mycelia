export function formatJobDuration(
  start?: number,
  end?: number,
  now = Date.now(),
): string {
  if (!start) return "-";
  const ms = (end ?? now) - start;
  if (ms < 0) return "Restarted";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
