import { useCallback, useEffect, useRef, useState } from "react";

type UseMetricCarouselOptions = {
  metricCount: number;
  autoRotateMs: number;
  resumeAfterHoverMs: number;
};

export function useMetricCarousel({
  metricCount,
  autoRotateMs,
  resumeAfterHoverMs,
}: UseMetricCarouselOptions) {
  const [activeMetricIndex, setActiveMetricIndex] = useState(0);
  const [isPinned, setIsPinned] = useState(false);
  const [isHoveringChart, setIsHoveringChart] = useState(false);
  const [resumeAfterMs, setResumeAfterMs] = useState(0);
  const isPinnedRef = useRef(isPinned);
  const isHoveringRef = useRef(isHoveringChart);
  const resumeAfterMsRef = useRef(resumeAfterMs);
  const metricCountRef = useRef(metricCount);

  useEffect(() => {
    isPinnedRef.current = isPinned;
  }, [isPinned]);

  useEffect(() => {
    isHoveringRef.current = isHoveringChart;
  }, [isHoveringChart]);

  useEffect(() => {
    resumeAfterMsRef.current = resumeAfterMs;
  }, [resumeAfterMs]);

  useEffect(() => {
    metricCountRef.current = metricCount;
    setActiveMetricIndex((previous) => {
      if (metricCount === 0) {
        return previous === 0 ? previous : 0;
      }
      const normalized = previous % metricCount;
      return normalized === previous ? previous : normalized;
    });
  }, [metricCount]);

  useEffect(() => {
    if (metricCount <= 1) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (
        isPinnedRef.current ||
        isHoveringRef.current ||
        Date.now() < resumeAfterMsRef.current ||
        metricCountRef.current <= 1
      ) {
        return;
      }
      setActiveMetricIndex((previous) => (previous + 1) % metricCountRef.current);
    }, autoRotateMs);

    return () => window.clearInterval(intervalId);
  }, [autoRotateMs, metricCount]);

  const handleChartMouseEnter = useCallback(() => {
    isHoveringRef.current = true;
    setIsHoveringChart(true);
  }, []);

  const handleChartMouseLeave = useCallback(() => {
    const resumeAt = Date.now() + resumeAfterHoverMs;
    isHoveringRef.current = false;
    resumeAfterMsRef.current = resumeAt;
    setIsHoveringChart(false);
    setResumeAfterMs(resumeAt);
  }, [resumeAfterHoverMs]);

  const handleMetricClick = useCallback(
    (metricIndex: number) => {
      if (metricIndex === activeMetricIndex) {
        setIsPinned((previous) => {
          const next = !previous;
          isPinnedRef.current = next;
          return next;
        });
        return;
      }
      setActiveMetricIndex(metricIndex);
      isPinnedRef.current = true;
      setIsPinned(true);
    },
    [activeMetricIndex]
  );

  const setPinnedState = useCallback((nextPinned: boolean) => {
    isPinnedRef.current = nextPinned;
    setIsPinned(nextPinned);
  }, []);

  return {
    activeMetricIndex,
    isPinned,
    setIsPinned: setPinnedState,
    handleChartMouseEnter,
    handleChartMouseLeave,
    handleMetricClick,
  };
}
