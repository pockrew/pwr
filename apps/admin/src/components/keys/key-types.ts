import type { ManagedKey } from "@pockrew/pwr-shared/schemas";

export type KeyTypeOption = {
  value: ManagedKey["types"];
  label: string;
  badge: string;
  colorClass: string;
};

/** Key roles offered when issuing a credential, with the badge colors used across the vault. */
export const KEY_TYPE_OPTIONS: KeyTypeOption[] = [
  {
    value: "outbound",
    label: "Relay",
    badge: "Outbound",
    colorClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  {
    value: "inbound",
    label: "Ingress",
    badge: "Inbound",
    colorClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  },
  {
    value: "admin",
    label: "CLI",
    badge: "Bearer",
    colorClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  },
];

/** Badge colors for a key type, shared by the issue form and the key list. */
export const keyTypeColor = (type: ManagedKey["types"]): string =>
  KEY_TYPE_OPTIONS.find((option) => option.value === type)?.colorClass ?? "";
