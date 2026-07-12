import ForestPageClient from "@/components/ForestPageClient";
import { computeForestLayout } from "@/lib/forest/layout";
import type { PlacedTreeData } from "@/lib/forest/treeData";
import { fetchAllRepoNodes } from "@/lib/github/client";
import { normalizeRepoNodes } from "@/lib/github/normalize";

// Must be a statically-analyzable literal (see api/repos/route.ts) -- keep in
// sync with REVALIDATE_SECONDS in lib/config.ts.
export const revalidate = 3600;

export default async function Home() {
  let trees: PlacedTreeData[] = [];
  let error = false;

  try {
    const rawNodes = await fetchAllRepoNodes();
    const normalized = normalizeRepoNodes(rawNodes);
    const positions = computeForestLayout(normalized);
    trees = normalized.map((tree) => ({
      ...tree,
      ...(positions.get(tree.id) ?? { x: 0, y: 0 }),
    }));
  } catch (err) {
    // UI copy lives in i18n; this flag only gates the error state.
    error = true;
    console.error("[page]", err);
  }

  return <ForestPageClient trees={trees} error={error} />;
}
