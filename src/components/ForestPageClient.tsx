"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "./Navbar";
import Footer from "./Footer";
import VoxelForest from "./renderers/voxel/VoxelForest";
import TreeDetailPanel from "./TreeDetailPanel";
import ErrorBoundary from "./ErrorBoundary";
import RepoFallbackList from "./RepoFallbackList";
import SceneLoadingIndicator from "./SceneLoadingIndicator";
import { IconChevron } from "./icons";
import { useTreeSelection } from "@/hooks/useTreeSelection";
import { useLanguage } from "@/context/LanguageContext";
import { useDarkMode } from "@/context/DarkModeContext";
import { useT } from "@/lib/i18n/dict";
import { HEALTH } from "@/lib/config";
import type { PlacedTreeData } from "@/lib/forest/treeData";

const GLASS_STYLE: React.CSSProperties = {
  backgroundColor: "rgb(var(--canvas) / 0.88)",
  borderColor: "rgb(var(--line) / 0.14)",
};

// Same greens/browns the voxel foliage wilts through -- the legend bar is a
// truthful sample of the scene's health ramp, not a decorative gradient.
const HEALTH_RAMP = "linear-gradient(90deg, #6fae4f, #d9a441, #c8762b, #8a5a2b)";

export interface ForestPageClientProps {
  trees: PlacedTreeData[];
  /** True when the server-side GitHub fetch failed. */
  error: boolean;
}

export default function ForestPageClient({ trees, error }: ForestPageClientProps) {
  const t = useT();
  const { language } = useLanguage();
  const { isDark } = useDarkMode();
  const { selectedId, select, clear } = useTreeSelection();
  const [sceneReady, setSceneReady] = useState(false);
  // Only consulted below `sm` -- the legend is always open on wider screens.
  const [legendOpen, setLegendOpen] = useState(false);
  const selectedTree = trees.find((tree) => tree.id === selectedId) ?? null;

  useEffect(() => {
    if (sceneReady) return;
    const timer = setTimeout(() => setSceneReady(true), 8000);
    return () => clearTimeout(timer);
  }, [sceneReady]);

  const locale = language === "tr" ? "tr-TR" : "en-US";
  const stats = useMemo(() => {
    const healthy = trees.filter((tree) => tree.healthStage >= HEALTH.HEALTHY_STAGE_THRESHOLD).length;
    const stars = trees.reduce((sum, tree) => sum + tree.stars, 0);
    return { healthy, stars };
  }, [trees]);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:shadow-lg">
        {t("a11y.skipToContent")}
      </a>
      <Navbar />

      <main id="main-content" className="flex flex-1 flex-col">
        {/* Screen-reader/crawler-reachable repo list -- the 3D canvas has no
            DOM equivalent, so this is the only way a11y tools and search
            engines ever see the actual repo data. */}
        {trees.length > 0 && <RepoFallbackList trees={trees} visuallyHidden />}

        {error || trees.length === 0 ? (
          <>
            <div className="container-wide pb-2 pt-10">
              <span className="eyebrow mb-3">{t("hero.badge")}</span>
              <h1 className="mb-2 font-display text-3xl font-semibold text-fg sm:text-4xl">{t("hero.title")}</h1>
            </div>
            {error ? (
              <div role="alert" aria-live="assertive">
                <StateBlock title={t("state.error.title")} body={t("state.error.body")} />
              </div>
            ) : (
              <div role="status" aria-live="polite">
                <StateBlock title={t("state.empty.title")} body={t("state.empty.body")} />
              </div>
            )}
          </>
        ) : (
          <section className="scene-viewport relative w-full overflow-hidden">
            {!sceneReady && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas" role="status" aria-live="polite">
                <SceneLoadingIndicator />
              </div>
            )}

            <ErrorBoundary
              fallback={
                <div className="h-full overflow-y-auto py-4">
                  <StateBlock title={t("state.webglError.title")} body={t("state.webglError.body")} />
                  <RepoFallbackList trees={trees} />
                </div>
              }
            >
              <VoxelForest trees={trees} onSelect={select} selectedId={selectedId} isDark={isDark} onReady={() => setSceneReady(true)} />
            </ErrorBoundary>

            {/* Exhibit label: the hero floats over the garden like a museum wall
                text. On a phone the wall text is cut back to badge + name +
                figures -- the prose reads as caption on a desktop and as a
                blindfold on a 390px screen, so it stays in the a11y tree
                (`sr-only`) and out of the frame until there is room for it. */}
            <div className="pointer-events-none absolute inset-x-0 top-0">
              <div className="container-wide pt-3 sm:pt-8">
                <div className="pointer-events-auto max-w-md rounded-2xl border p-3.5 shadow-lg backdrop-blur-md sm:p-6" style={GLASS_STYLE}>
                  <span className="eyebrow mb-1 sm:mb-2">
                    <span className="relative flex h-2 w-2" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                    </span>
                    {t("hero.badge")}
                  </span>
                  <h1 className="mb-0.5 font-display text-2xl font-semibold text-fg sm:mb-1.5 sm:text-4xl">{t("hero.title")}</h1>
                  <p className="sr-only text-sm leading-relaxed text-muted sm:not-sr-only sm:block">{t("hero.subtitle")}</p>

                  <div className="mt-2.5 flex flex-wrap gap-1.5 sm:mt-4 sm:gap-2">
                    <StatChip value={trees.length.toLocaleString(locale)} label={t("stats.trees")} />
                    <StatChip value={stats.healthy.toLocaleString(locale)} label={t("stats.healthy")} />
                    <StatChip value={stats.stars.toLocaleString(locale)} label={t("stats.stars")} />
                  </div>
                </div>
              </div>
            </div>

            {/* Legend + interaction hint pinned to the bottom edge. The legend
                is the taller of the two overlays and the species list is the
                bulk of it, so on a phone it folds down to its own title bar and
                opens on tap; on `sm` and up it is always open and the toggle is
                gone, since there the card never crowded the scene. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-3 sm:bottom-4">
              <div className="container-wide flex flex-wrap items-end justify-between gap-2 sm:gap-3">
                <div className="pointer-events-auto max-w-full rounded-xl border backdrop-blur-md sm:max-w-sm" style={GLASS_STYLE}>
                  <button
                    type="button"
                    onClick={() => setLegendOpen((open) => !open)}
                    aria-expanded={legendOpen}
                    aria-controls="forest-legend"
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted sm:hidden"
                  >
                    {t("legend.title")}
                    <IconChevron className={`h-3 w-3 transition-transform ${legendOpen ? "rotate-180" : ""}`} />
                  </button>
                  <p className="hidden px-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted sm:block">
                    {t("legend.title")}
                  </p>

                  <div id="forest-legend" className={`${legendOpen ? "block" : "hidden"} px-4 pb-3 pt-1 sm:block sm:pt-2`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-fg">{t("legend.healthy")}</span>
                      <span className="h-1.5 w-28 rounded-full sm:w-36" style={{ background: HEALTH_RAMP }} aria-hidden="true" />
                      <span className="text-[11px] font-medium text-fg">{t("legend.wilted")}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted">{t("legend.health")}</p>
                    <p className="text-[11px] text-muted">{t("legend.size")}</p>
                    <p className="text-[11px] text-muted">{t("legend.order")}</p>
                    <p className="mt-1.5 text-[11px] text-muted">{t("legend.species")}</p>
                  </div>
                </div>

                {/* Every visual utility here is `sm:`-prefixed on purpose:
                    `not-sr-only` resets padding, and an unprefixed `px-*` sorts
                    *before* a prefixed reset, so the pill loses its padding. */}
                <p
                  className="sr-only sm:not-sr-only sm:block sm:rounded-full sm:border sm:px-3.5 sm:py-1.5 sm:text-xs sm:text-muted sm:backdrop-blur-md"
                  style={GLASS_STYLE}
                >
                  {t("hero.hint")}
                </p>
              </div>
            </div>
          </section>
        )}
      </main>

      <Footer />
      <TreeDetailPanel tree={selectedTree} onClose={clear} />
    </div>
  );
}

function StatChip({ value, label }: { value: string; label: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1"
      style={{ backgroundColor: "rgb(var(--surface) / 0.7)", borderColor: "rgb(var(--line) / 0.12)" }}
    >
      <span className="font-display text-sm font-semibold text-fg">{value}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </span>
  );
}

function StateBlock({ title, body, detail }: { title: string; body: string; detail?: string }) {
  return (
    <div className="container-wide flex flex-1 items-center justify-center py-20">
      <div className="card max-w-md p-8 text-center">
        <h2 className="mb-2 font-display text-xl font-semibold text-fg">{title}</h2>
        <p className="text-sm leading-relaxed text-muted">{body}</p>
        {detail && <p className="mt-3 text-xs text-muted">{detail}</p>}
      </div>
    </div>
  );
}
