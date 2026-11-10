"use client";

import { useEffect, useRef, useState } from "react";
import type { PlacedTreeData } from "@/lib/forest/treeData";
import { QUALITY_PRESETS, useQualityTier } from "@/hooks/useQualityTier";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useT } from "@/lib/i18n/dict";
import SpeciesSprite from "@/components/SpeciesSprite";
import { createWorld, type World } from "./world";

export interface VoxelForestProps {
  trees: PlacedTreeData[];
  onSelect: (id: string) => void;
  /** Currently selected tree id (drives the outline and the camera fly-in), or null. */
  selectedId?: string | null;
  /** Follows the site's dark-mode toggle: dark is night on the island. */
  isDark: boolean;
  /** Fired once the world has drawn its first complete frame. */
  onReady?: () => void;
}

/**
 * React's whole involvement with the scene: one `<div>`, and prop changes
 * forwarded to the engine in `world.ts`. See that file for why.
 */
export default function VoxelForest({ trees, onSelect, selectedId = null, isDark, onReady }: VoxelForestProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const t = useT();
  const tier = useQualityTier();
  const reducedMotion = usePrefersReducedMotion();

  // Latest props, readable from callbacks the engine holds for its whole life.
  const latest = useRef({ onSelect, onReady, isDark, selectedId, reducedMotion });
  useEffect(() => {
    latest.current = { onSelect, onReady, isDark, selectedId, reducedMotion };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let world: World;
    try {
      world = createWorld(host, {
        trees,
        isDark: latest.current.isDark,
        reducedMotion: latest.current.reducedMotion,
        quality: QUALITY_PRESETS[tier],
        onSelect: (id) => latest.current.onSelect(id),
        // The card follows the pointer by a direct style write; only a change of tree re-renders.
        onHover: (id, x, y) => {
          setHoveredId(id);
          const card = cardRef.current;
          if (!card || !id) return;
          const rect = host.getBoundingClientRect();
          const left = Math.min(x - rect.left + 18, rect.width - 250);
          card.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, y - rect.top + 18)}px)`;
        },
        onReady: () => latest.current.onReady?.(),
      });
    } catch (error) {
      // No WebGL. Surface it during render so the page's ErrorBoundary shows the repo list instead.
      queueMicrotask(() => setFailure(error instanceof Error ? error : new Error(String(error))));
      return;
    }
    world.setSelected(latest.current.selectedId);
    worldRef.current = world;
    return () => {
      worldRef.current = null;
      world.dispose();
    };
  }, [trees, tier]);

  useEffect(() => worldRef.current?.setDark(isDark), [isDark]);
  useEffect(() => worldRef.current?.setSelected(selectedId), [selectedId]);
  useEffect(() => worldRef.current?.setReducedMotion(reducedMotion), [reducedMotion]);

  if (failure) throw failure;
  const hovered = hoveredId && !selectedId ? trees.find((tree) => tree.id === hoveredId) : null;
  return (
    <div className="relative h-full w-full" aria-hidden="true">
      <div ref={hostRef} className="h-full w-full" />
      {/* Says outright what the tag and the marker imply: this tree is a repository, and it opens. */}
      <div ref={cardRef} className={`voxel-panel pointer-events-none absolute left-0 top-0 w-60 p-3 ${hovered ? "block" : "hidden"}`}>
        {hovered && (
          <>
            <div className="flex items-center gap-2.5">
              <SpeciesSprite species={hovered.species} size={28} />
              <span className="min-w-0 leading-tight">
                <span className="eyebrow !text-[10px]">{t("hover.repo")}</span>
                <span className="block truncate font-display text-base font-semibold text-fg">{hovered.name}</span>
              </span>
            </div>
            <p className="mt-1.5 font-pixel text-xs text-muted">
              {hovered.primaryLanguage ?? "—"} · ★ {hovered.stars} · {hovered.commitCount} commit
            </p>
            <p className="mt-1 font-pixel text-xs text-accent">{t("hover.cta")} →</p>
          </>
        )}
      </div>
    </div>
  );
}
