import { useCallback, useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { openUrl } from "@tauri-apps/plugin-opener";

type EmailHtmlViewerProps = {
  html: string;
  zoomPercent: number;
};

function sanitizeAndRewriteAnchors(rawHtml: string): string {
  const sanitized = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
  });

  if (typeof window === "undefined") {
    return sanitized;
  }

  const parser = new window.DOMParser();
  const document = parser.parseFromString(sanitized, "text/html");
  document.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noreferrer noopener");
  });
  return document.body.innerHTML;
}

function resolveExternalHref(rawHref: string, iframeDocument: Document): string | null {
  const href = rawHref.trim();
  if (!href || href === "#") {
    return null;
  }

  if (/^mailto:/i.test(href)) {
    return href;
  }
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  if (/^\/\//.test(href)) {
    return `https:${href}`;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) {
    return null;
  }

  const baseHref = iframeDocument
    .querySelector("base[href]")
    ?.getAttribute("href")
    ?.trim();
  if (baseHref) {
    try {
      return new URL(href, baseHref).toString();
    } catch {
      return null;
    }
  }

  return null;
}

function buildSrcDoc(content: string, zoomPercent: number): string {
  const normalizedZoom = Math.min(125, Math.max(80, zoomPercent));
  const zoomScale = normalizedZoom / 100;
  const baseCss = `
    :root {
      color-scheme: light;
    }
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #111111;
      font-family: "Segoe UI Variable", "Inter", "Segoe UI", sans-serif;
      line-height: 1.45;
      overflow-x: hidden;
    }
    #root {
      transform-origin: top left;
      transform: scale(${zoomScale});
      width: calc(100% / ${zoomScale});
    }
    #content {
      padding: 14px;
    }
    img, table, video {
      max-width: 100% !important;
      height: auto !important;
    }
    table {
      width: 100% !important;
      table-layout: fixed;
      border-collapse: collapse;
    }
    td, th {
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    pre, code {
      white-space: pre-wrap;
      word-break: break-word;
    }
    a {
      color: #1d4ed8;
      text-decoration: underline;
      cursor: pointer;
    }
  `;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <base target="_blank" />
    <style>${baseCss}</style>
  </head>
  <body>
    <div id="root">
      <div id="content">${content}</div>
    </div>
  </body>
</html>`;
}

export function EmailHtmlViewer({ html, zoomPercent }: EmailHtmlViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const clickCleanupRef = useRef<(() => void) | null>(null);
  const normalizedHtml = useMemo(() => sanitizeAndRewriteAnchors(html), [html]);
  const srcDoc = useMemo(() => buildSrcDoc(normalizedHtml, zoomPercent), [normalizedHtml, zoomPercent]);

  const attachLinkHandler = useCallback(() => {
    clickCleanupRef.current?.();
    clickCleanupRef.current = null;

    const iframe = iframeRef.current;
    const document = iframe?.contentDocument;
    if (!iframe || !document) {
      return;
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const href = anchor.getAttribute("href");
      if (!href) {
        return;
      }

      const resolvedHref = resolveExternalHref(href, document);
      if (!resolvedHref) {
        return;
      }

      void openUrl(resolvedHref);
    };

    document.addEventListener("click", onClick, true);
    clickCleanupRef.current = () => {
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  useEffect(() => {
    return () => {
      clickCleanupRef.current?.();
      clickCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    clickCleanupRef.current?.();
    clickCleanupRef.current = null;
  }, [srcDoc]);

  return (
    <iframe
      className="h-full w-full border-0"
      onLoad={attachLinkHandler}
      ref={iframeRef}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      title="Email HTML body"
    />
  );
}

