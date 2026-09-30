import { useEffect, useState } from "react";
import type { Mode } from "./skin";

export type Pref = "system" | Mode;
const KEY = "precedent-ui-theme";

export function useTheme() {
  const [pref, setPref] = useState<Pref>(() => (localStorage.getItem(KEY) as Pref) ?? "system");
  const [system, setSystem] = useState<Mode>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setSystem(e.matches ? "dark" : "light");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const resolved: Mode = pref === "system" ? system : pref;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem(KEY, pref);
  }, [pref, resolved]);

  return { pref, resolved, set: setPref };
}
