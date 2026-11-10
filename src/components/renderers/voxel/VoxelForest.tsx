"use client";

import { useEffect, useRef, useState } from "react";
import type { PlacedTreeData } from "@/lib/forest/treeData";
import { QUALITY_PRESETS, useQualityTier } from "@/hooks/useQualityTier";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
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
  const [failure, setFailure] = useState<Error | null>(null);
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
  return <div ref={hostRef} className="h-full w-full" aria-hidden="true" />;
}
