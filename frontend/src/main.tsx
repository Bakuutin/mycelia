import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ActionDialogProvider } from "@/components/ActionDialogProvider";

const queryClient = new QueryClient();

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
