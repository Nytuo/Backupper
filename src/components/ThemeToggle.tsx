import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

type Theme = "dark" | "light";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("theme-dark", "theme-light", "dark");
  root.classList.add(`theme-${theme}`);
  if (theme === "dark") root.classList.add("dark");
}

export default function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "dark",
  );

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const next = theme === "dark" ? "light" : "dark";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(next)}
      aria-label={next === "light"
        ? t("common.lightMode")
        : t("common.darkMode")}
      title={next === "light" ? t("common.lightMode") : t("common.darkMode")}
    >
      {theme === "dark"
        ? <Sun className="size-4" />
        : <Moon className="size-4" />}
    </Button>
  );
}
