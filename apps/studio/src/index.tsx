import { Route, Router } from "@solidjs/router";
import { ErrorBoundary, render } from "solid-js/web";

import { NotFound, UnexpectedError } from "@pockrew/pwr-ui/core";

import "./index.css";

import { QueryClientProvider } from "@tanstack/solid-query";

import { AgentControlSettings } from "./components/modules/settings/agent-control-settings";
import { AgentLogsSettings } from "./components/modules/settings/agent-logs-settings";
import { DataRetentionSettings } from "./components/modules/settings/data-retention-settings";
import { GeneralTunnelSettings } from "./components/modules/settings/general-tunnel-settings";
import { queryClient } from "./libs/query-client";
import { ComparePage } from "./routes/compare";
import { EndpointsPage } from "./routes/endpoints";
import { StudioLayout } from "./routes/layout";
import { RequestPage } from "./routes/requests";
import { SettingsLayout } from "./routes/settings";

const root = document.getElementById("root");

if (!root) {
  throw new Error("#app is missing from index.html");
}

render(
  () => (
    <ErrorBoundary fallback={(error, reset) => <UnexpectedError error={error} onRetry={reset} />}>
      <QueryClientProvider client={queryClient}>
        <Router root={StudioLayout}>
          <Route path="/" component={RequestPage} />
          <Route path="/endpoints" component={EndpointsPage} />
          <Route path="/settings" component={SettingsLayout}>
            <Route path="/" component={GeneralTunnelSettings} />
            <Route path="/general" component={GeneralTunnelSettings} />
            <Route path="/data" component={DataRetentionSettings} />
            <Route path="/logs" component={AgentLogsSettings} />
            <Route path="/agent" component={AgentControlSettings} />
          </Route>
          <Route path="/compare" component={ComparePage} />
          <Route path="/*404" component={NotFound} />
        </Router>
      </QueryClientProvider>
    </ErrorBoundary>
  ),
  root,
);
