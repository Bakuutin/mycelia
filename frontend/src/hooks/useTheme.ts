import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

export const useTheme = () => {
  const { theme, setTheme } = useSettingsStore();

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme =
        window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  return { theme, setTheme };
};
