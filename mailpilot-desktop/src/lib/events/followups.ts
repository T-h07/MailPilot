const FOLLOWUP_UPDATED_EVENT = "mailpilot:followup-updated";

export function emitFollowupUpdated() {
  window.dispatchEvent(new CustomEvent(FOLLOWUP_UPDATED_EVENT));
}

export function subscribeFollowupUpdated(onChange: () => void) {
  const listener = () => onChange();
  window.addEventListener(FOLLOWUP_UPDATED_EVENT, listener);
  return () => window.removeEventListener(FOLLOWUP_UPDATED_EVENT, listener);
}
