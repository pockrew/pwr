import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { type Component } from "solid-js";

import { Tabs, toast } from "@pockrew/pwr-ui/core";
import { LogSettingsForm, LogViewer } from "@pockrew/pwr-ui/logs";

import {
  fetchServerLogs,
  fetchServerLogSettings,
  openServerLogStream,
  saveServerLogSettings,
} from "~/libs/logs-client";

const settingsKey = ["server", "log-settings"] as const;

/** Server Logs: the live server.log viewer (same viewer as Studio) and level/rotation settings. */
export const ServerLogsPage: Component = () => {
  const queryClient = useQueryClient();
  const settings = createQuery(() => ({ queryKey: settingsKey, queryFn: fetchServerLogSettings }));
  const save = createMutation(() => ({
    mutationFn: saveServerLogSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsKey, saved);
      toast.success("Log settings saved and applied");
    },
    onError: (error) => toast.error(error.message),
  }));

  return (
    <div class="mx-auto flex h-full w-full max-w-6xl flex-1 flex-col p-4 md:p-6">
      <Tabs defaultValue="stream" class="flex min-h-0 w-full flex-1 flex-col">
        <Tabs.List class="border-border mb-4 border-b">
          <Tabs.Trigger value="stream">Log stream</Tabs.Trigger>
          <Tabs.Trigger value="settings">Level & rotation</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="stream" class="min-h-[70vh] flex-1">
          <LogViewer
            title="Server Logs"
            fetchPage={fetchServerLogs}
            openStream={openServerLogStream}
          />
        </Tabs.Content>
        <Tabs.Content value="settings">
          <LogSettingsForm
            value={settings.data}
            logFile="server.log"
            saving={save.isPending}
            onSave={(next) => save.mutate(next)}
          />
        </Tabs.Content>
      </Tabs>
    </div>
  );
};
