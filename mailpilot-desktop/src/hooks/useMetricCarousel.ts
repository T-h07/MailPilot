import { useCallback, useEffect, useState } from "react";

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

  useEffect(() => {
    setActiveMetricIndex((previous) => (metricCount === 0 ? 0 : previous % metricCount));
  }, [metricCount]);

  useEffect(() => {
    if (metricCount <= 1) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (isPinned || isHoveringChart || Date.now() < resumeAfterMs) {
        return;
      }
      setActiveMetricIndex((previous) => (previous + 1) % metricCount);
    }, autoRotateMs);

    return () => window.clearInterval(intervalId);
  }, [autoRotateMs, isHoveringChart, isPinned, metricCount, resumeAfterMs]);

  const handleChartMouseEnter = useCallback(() => {
    setIsHoveringChart(true);
  }, []);

  const handleChartMouseLeave = useCallback(() => {
    setIsHoveringChart(false);
    setResumeAfterMs(Date.now() + resumeAfterHoverMs);
  }, [resumeAfterHoverMs]);

  const handleMetricClick = useCallback(
    (metricIndex: number) => {
      if (metricIndex === activeMetricIndex) {
        setIsPinned((previous) => !previous);
        return;
      }
      setActiveMetricIndex(metricIndex);
      setIsPinned(true);
    },
    [activeMetricIndex],
  );

  return {
    activeMetricIndex,
    isPinned,
    setIsPinned,
    handleChartMouseEnter,
    handleChartMouseLeave,
    handleMetricClick,
  };
}
