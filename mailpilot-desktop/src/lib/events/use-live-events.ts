import { useContext } from "react";
import { LiveEventsContext } from "@/lib/events/live-events-store";

export function useLiveEvents() {
  const context = useContext(LiveEventsContext);
  if (!context) {
    throw new Error("useLiveEvents must be used within LiveEventsProvider");
  }
  return context;
}
