import { useEffect, useState } from "react";

export function useNow(updateInterval: number = 1000) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, updateInterval);

    return () => clearInterval(interval);
  }, [updateInterval]);

  return now;
}
