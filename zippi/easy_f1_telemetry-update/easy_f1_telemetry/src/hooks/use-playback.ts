import { useCallback, useEffect, useRef, useState } from "react";

/** Single shared clock for the whole dashboard (one rAF loop). */
export function usePlayback(duration: number) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const timeRef = useRef(0);

  const seek = useCallback(
    (t: number) => {
      const v = Math.max(0, Math.min(duration, t));
      timeRef.current = v;
      setTime(v);
    },
    [duration],
  );

  useEffect(() => {
    if (!playing || duration <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = Math.min(duration, timeRef.current + dt * rate);
      timeRef.current = next;
      setTime(next);
      if (next >= duration) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, duration]);

  const reset = useCallback(() => {
    setPlaying(false);
    seek(0);
  }, [seek]);
  const toggle = useCallback(() => {
    if (!playing && timeRef.current >= duration) seek(0);
    setPlaying((p) => !p);
  }, [playing, duration, seek]);

  return { time, playing, rate, setRate, seek, reset, toggle, setPlaying };
}
