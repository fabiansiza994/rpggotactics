import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
const Progress = createContext<number | null>(null);
/** Read-only presentation clock. It never grants rewards or delays navigation. */
export function ResultProgress({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [progress, setProgress] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0);
  const stopped = useRef(false);
  const finish = () => {
    stopped.current = true;
    setProgress(1);
  };
  useEffect(() => {
    if (!active) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) {
      const timer = setTimeout(finish, 0);
      return () => clearTimeout(timer);
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (stopped.current) return;
      const p = Math.min(1, (now - start) / 1400);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const fallback = setTimeout(finish, 2200);
    const visibility = () => {
      if (document.hidden) finish();
    };
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", finish);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", finish);
    };
  }, [active]);
  return (
    <Progress.Provider value={progress}>
      {children}
      {active && progress < 1 && (
        <button type="button" className="result-progress-skip" onClick={finish}>
          Omitir animaciones
        </button>
      )}
    </Progress.Provider>
  );
}
export function useResultProgress() {
  return useContext(Progress) ?? 1;
}
export function useResultProgressEnabled() { return useContext(Progress) !== null; }
export function AnimatedReward({
  from = 0,
  to,
  suffix = "",
}: {
  from?: number;
  to: number;
  suffix?: string;
}) {
  const p = useResultProgress(),
    value = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
  return (
    <span className="animated-reward" aria-label={`${to}${suffix}`}>
      <span aria-hidden="true">
        {value}
        {suffix}
      </span>
    </span>
  );
}
