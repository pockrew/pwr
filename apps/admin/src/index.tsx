import { Route, Router } from "@solidjs/router";
import { QueryClientProvider } from "@tanstack/solid-query";
import { ErrorBoundary, render } from "solid-js/web";

import { NotFound, UnexpectedError } from "@pockrew/pwr-ui/core";

import { queryClient } from "./libs/query-client";
import { AuditPage } from "./routes/audit";
import { AdminLayout } from "./routes/layout";
import { LoginPage } from "./routes/login";
import { ServerLogsPage } from "./routes/logs";
import { TunnelsPage } from "./routes/tunnels";
import { TunnelDetailPage } from "./routes/tunnels/detail";
import { TunnelKeysPage } from "./routes/tunnels/keys";

import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("#root is missing from index.html");
}

render(
  () => (
    <ErrorBoundary fallback={(error, reset) => <UnexpectedError error={error} onRetry={reset} />}>
      <QueryClientProvider client={queryClient}>
        <Router root={AdminLayout} base="/admin">
          <Route path="/" component={TunnelsPage} />
          <Route path="/tunnels" component={TunnelsPage} />
          <Route path="/tunnels/:tunnelId" component={TunnelDetailPage} />
          <Route path="/tunnels/:tunnelId/keys" component={TunnelKeysPage} />
          <Route path="/audit" component={AuditPage} />
          <Route path="/logs" component={ServerLogsPage} />
          <Route path="/login" component={LoginPage} />
          <Route path="*404" component={NotFound} />
        </Router>
      </QueryClientProvider>
    </ErrorBoundary>
  ),
  root,
);
