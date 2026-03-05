import { useEffect } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { AppOutletContext } from "@/App";
import { MailboxShell } from "@/features/mailbox/components/MailboxShell";

export function ViewPage() {
  const { viewId } = useParams();
  const navigate = useNavigate();
  const { views, viewsLoading } = useOutletContext<AppOutletContext>();
  const view = views.find((candidate) => candidate.id === viewId) ?? null;

  useEffect(() => {
    if (!viewId || viewsLoading) {
      return;
    }
    if (!view) {
      navigate("/inbox", { replace: true });
    }
  }, [navigate, view, viewId, viewsLoading]);

  if (!viewId) {
    return <MailboxShell context="view" view={null} />;
  }

  return <MailboxShell context="view" view={view} />;
}
