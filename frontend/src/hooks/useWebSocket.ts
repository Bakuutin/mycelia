import { useEffect, useRef } from "react";
import { wsClient } from "@/lib/websocket";

export function useWebSocketSubscription(
  channel: string,
  onEvent: (event: any) => void,
  enabled: boolean = true
): void {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleEvent = (event: any) => {
      onEventRef.current(event);
    };

    const unsubscribe = wsClient.subscribe(channel, handleEvent);

    return () => {
      unsubscribe();
    };
  }, [channel, enabled]);
}
