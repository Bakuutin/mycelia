import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ActionDialogProvider } from "@/components/ActionDialogProvider";
import { wsClient } from "@/lib/websocket";

const queryClient = new QueryClient();

// Redis Pub/Sub cannot replay messages that occurred during a reconnect. The
// backend reports that delivery gap explicitly; invalidate canonical API state
// once here instead of relying on every feature callback to detect it.
wsClient.onResync(() => {
  void queryClient.invalidateQueries();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ActionDialogProvider>
        <RouterProvider router={router} />
        <Toaster closeButton position="bottom-right" />
      </ActionDialogProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
