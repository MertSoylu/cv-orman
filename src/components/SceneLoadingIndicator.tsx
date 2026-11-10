"use client";

import { useT } from "@/lib/i18n/dict";

/** Three cubes hopping in turn. The hop is CSS, so the global reduced-motion rule stills it. */
export default function SceneLoadingIndicator() {
  const t = useT();

  return (
    <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
      <div className="cube-loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="font-pixel text-base text-fg">{t("state.loading.title")}</p>
      <p className="text-xs text-muted">{t("state.loading.body")}</p>
    </div>
  );
}
