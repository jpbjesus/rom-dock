import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
export default function ThemeSwitch() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || "dark",
  );
  useEffect(() => {
    const sync = () =>
      setTheme(document.documentElement.dataset.theme || "dark");
    window.addEventListener("romdock-theme-change", sync);
    return () => window.removeEventListener("romdock-theme-change", sync);
  }, []);
  function choose(next: "light" | "dark") {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem("romdock-theme", next);
    } catch {}
    window.dispatchEvent(new Event("romdock-theme-change"));
  }
  return (
    <div className="theme-switcher" role="group" aria-label="Tema">
      <button
        title="Modo claro"
        aria-label="Claro"
        aria-pressed={theme === "light"}
        onClick={() => choose("light")}
      >
        <Sun size={16} />
        <span>Claro</span>
      </button>
      <button
        title="Modo escuro"
        aria-label="Escuro"
        aria-pressed={theme === "dark"}
        onClick={() => choose("dark")}
      >
        <Moon size={16} />
        <span>Escuro</span>
      </button>
    </div>
  );
}
