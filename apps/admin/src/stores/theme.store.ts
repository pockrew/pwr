import { createEffect, createRoot, createSignal } from "solid-js";

export type Theme = "light" | "dark";

export const themeStore = createRoot(() => {
  const getInitialTheme = (): Theme => {
    if (typeof window === "undefined") return "dark";
    const saved = localStorage.getItem("pwr-admin-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const [theme, setTheme] = createSignal<Theme>(getInitialTheme());

  createEffect(() => {
    const current = theme();
    if (typeof window !== "undefined") {
      localStorage.setItem("pwr-admin-theme", current);
      if (current === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  });

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return {
    get theme() {
      return theme();
    },
    setTheme,
    toggleTheme,
  };
});
