import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { type Component } from "solid-js";
import { toast } from "solid-sonner";

import { Tabs } from "@pockrew/pwr-ui/core";
import { LogSettingsForm, LogViewer } from "@pockrew/pwr-ui/logs";

import {
  fetchAgentLogs,
  fetchAgentLogSettings,
  openAgentLogStream,
  saveAgentLogSettings,
} from "~/libs/api-client";

const settingsKey = ["agent", "log-settings"] as const;

/** Agent Logs: the live agent.log viewer and its level/rotation settings. */
export const AgentLogsSettings: Component = () => {
  const queryClient = useQueryClient();
  const settings = createQuery(() => ({ queryKey: settingsKey, queryFn: fetchAgentLogSettings }));
  const save = createMutation(() => ({
    mutationFn: saveAgentLogSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsKey, saved);
      toast.success("Log settings saved and applied");
    },
    onError: (error) => toast.error(error.message),
  }));

  return (
    <Tabs defaultValue="stream" class="flex h-full w-full flex-col">
      <Tabs.List class="border-border mb-4 border-b">
        <Tabs.Trigger value="stream">Log stream</Tabs.Trigger>
        <Tabs.Trigger value="settings">Level & rotation</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="stream" class="min-h-0 flex-1">
        <LogViewer title="Agent Logs" fetchPage={fetchAgentLogs} openStream={openAgentLogStream} />
      </Tabs.Content>
      <Tabs.Content value="settings">
        <LogSettingsForm
          value={settings.data}
          logFile="agent.log"
          saving={save.isPending}
          onSave={(next) => save.mutate(next)}
        />
      </Tabs.Content>
    </Tabs>
  );
};
