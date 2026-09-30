import { createSignal } from "solid-js";

type Theme = "dark" | "light" | "system";

const readThemeFromStorage = () => {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light" || saved === "system") return saved;
  } catch {}
  return "system";
};

const [current, setCurrent] = createSignal<Theme>(readThemeFromStorage());

const root = document.documentElement;

const applyThemeToDOM = (t: Theme) => {
  if (t === "system") {
    root.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
    return;
  }

  root.classList.toggle("dark", t === "dark");
};

// Listen color schema changed
if (typeof window !== "undefined") {
  applyThemeToDOM(current());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (current() === "system") {
      applyThemeToDOM("system");
    }
  });
}

export const theme = current;

export const setTheme = (next: Theme) => {
  applyThemeToDOM(next);
  setCurrent(next);

  try {
    localStorage.setItem("theme", next);
  } catch (error) {
    console.error("[theme] localStorage is not available", error);
  }
};
