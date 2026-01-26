import { useEffect, useState } from "react";
import { WifiOff, AlertTriangle } from "lucide-react";

interface ConnectivityState {
  internet: boolean;
  llm: boolean | null; // null = no provider configured
  checkedAt: number;
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds

export function ConnectivityStatus() {
  const [connectivity, setConnectivity] = useState<ConnectivityState | null>(null);
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);

  // Listen for browser online/offline events
  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Poll the health endpoint for server-side connectivity status
  useEffect(() => {
    const checkConnectivity = async () => {
      try {
        const response = await fetch("/health");
        if (response.ok) {
          const data = await response.json();
          setConnectivity({
            internet: data.connectivity?.internet ?? true,
            llm: data.connectivity?.llm ?? true,
            checkedAt: Date.now(),
          });
        }
      } catch {
        // Server unreachable - browser might be offline
        setConnectivity({
          internet: false,
          llm: false,
          checkedAt: Date.now(),
        });
      }
    };

    // Initial check
    checkConnectivity();

    // Poll periodically
    const interval = setInterval(checkConnectivity, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // Don't show anything if everything is fine
  // llm === null means no provider configured (that's fine)
  // llm === true means provider is reachable
  if (browserOnline && connectivity?.internet && (connectivity?.llm === null || connectivity?.llm === true)) {
    return null;
  }

  // Browser is offline
  if (!browserOnline) {
    return (
      <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center justify-center gap-2 text-red-600 dark:text-red-400 text-sm">
        <WifiOff className="h-4 w-4" />
        <span>You are offline. Some features may not work.</span>
      </div>
    );
  }

  // Server has no internet
  if (connectivity && !connectivity.internet) {
    return (
      <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2 flex items-center justify-center gap-2 text-yellow-600 dark:text-yellow-400 text-sm">
        <WifiOff className="h-4 w-4" />
        <span>Server is offline. Jobs requiring internet will fail.</span>
      </div>
    );
  }

  // Server has internet but LLM provider is unreachable (llm === false, not null)
  if (connectivity && connectivity.internet && connectivity.llm === false) {
    return (
      <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2 flex items-center justify-center gap-2 text-yellow-600 dark:text-yellow-400 text-sm">
        <AlertTriangle className="h-4 w-4" />
        <span>LLM provider is unreachable. AI features may not work.</span>
      </div>
    );
  }

  return null;
}
