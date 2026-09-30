import { createEffect, createSignal, For, Show, type Component } from "solid-js";

import { LogSettingsSchema, type LogLevel, type LogSettings } from "@pockrew/pwr-shared/schemas";
import { Button, TextField } from "@pockrew/pwr-ui/core";

const LEVELS: { id: LogLevel; label: string }[] = [
  { id: "debug", label: "Debug" },
  { id: "info", label: "Info" },
  { id: "warning", label: "Warn" },
  { id: "error", label: "Error" },
];

interface LogSettingsFormProps {
  /** Saved settings; the form stays disabled until they load. */
  value: LogSettings | undefined;
  /** File the settings apply to, shown in the rotation summary. */
  logFile: string | undefined;
  saving: boolean;
  onSave: (settings: LogSettings) => void;
}

/** Minimum level written to the log file and its size-based rotation. */
export const LogSettingsForm: Component<LogSettingsFormProps> = (props) => {
  const [level, setLevel] = createSignal<LogLevel>("info");
  const [maxSizeMb, setMaxSizeMb] = createSignal("10");
  const [maxFiles, setMaxFiles] = createSignal("5");

  createEffect(() => {
    const saved = props.value;
    if (!saved) return;
    setLevel(saved.level);
    setMaxSizeMb(String(saved.maxSizeMb));
    setMaxFiles(String(saved.maxFiles));
  });

  const draft = () =>
    LogSettingsSchema.safeParse({
      level: level(),
      maxSizeMb: Number(maxSizeMb()),
      maxFiles: Number(maxFiles()),
    });
  const file = () => props.logFile ?? "the log file";

  return (
    <form
      class="max-w-xl space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = draft();
        if (parsed.success) props.onSave(parsed.data);
      }}
    >
      <fieldset class="space-y-2" disabled={!props.value}>
        <legend class="text-foreground text-sm font-medium">Minimum level written</legend>
        <div class="flex gap-1">
          <For each={LEVELS}>
            {(option) => (
              <Button
                type="button"
                size="xs"
                variant={level() === option.id ? "default" : "outline"}
                class="h-7 px-2.5 font-mono text-xs"
                onClick={() => setLevel(option.id)}
              >
                {option.label}
              </Button>
            )}
          </For>
        </div>
      </fieldset>

      <div class="grid max-w-md grid-cols-2 gap-3">
        <TextField.Root disabled={!props.value}>
          <TextField.Label>Rotate at (MB)</TextField.Label>
          <TextField.Input
            type="number"
            min="1"
            max="500"
            value={maxSizeMb()}
            onInput={(event) => setMaxSizeMb(event.currentTarget.value)}
            class="font-mono text-sm"
          />
        </TextField.Root>
        <TextField.Root disabled={!props.value}>
          <TextField.Label>Rotated files kept</TextField.Label>
          <TextField.Input
            type="number"
            min="1"
            max="50"
            value={maxFiles()}
            onInput={(event) => setMaxFiles(event.currentTarget.value)}
            class="font-mono text-sm"
          />
        </TextField.Root>
      </div>

      <Show
        when={draft().success}
        fallback={
          <p class="text-destructive text-xs">
            Size must be 1–500 MB and 1–50 rotated files are kept.
          </p>
        }
      >
        <p class="text-muted-foreground text-xs">
          When {file()} reaches {maxSizeMb()} MB it becomes {file()}.1, and older files shift up to
          .{maxFiles()}; at most {Number(maxSizeMb()) * (Number(maxFiles()) + 1)} MB is kept.
        </p>
      </Show>

      <Button
        type="submit"
        size="sm"
        pill
        disabled={!props.value || props.saving || !draft().success}
      >
        {props.saving ? "Saving…" : "Save log settings"}
      </Button>
    </form>
  );
};
