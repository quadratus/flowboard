import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "./index.css";
import { ApiError } from "./api/client.ts";
import { Shell } from "./app/Shell.tsx";
import { Home } from "./app/Home.tsx";
import { ListPage } from "./features/list/ListPage.tsx";
import { SettingsPage } from "./features/config/SettingsPage.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // 4xx answers are final (401, 403, 404): retrying only delays the message.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Home /> },
      { path: "lists/:listId/:view?", element: <ListPage /> },
      { path: "containers/:containerId/settings", element: <SettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
