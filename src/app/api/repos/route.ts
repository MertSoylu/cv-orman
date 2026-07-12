import { NextResponse } from "next/server";
import { computeForestLayout } from "@/lib/forest/layout";
import type { PlacedTreeData } from "@/lib/forest/treeData";
import { fetchAllRepoNodes } from "@/lib/github/client";
import { normalizeRepoNodes } from "@/lib/github/normalize";

// Next.js requires route segment config exports to be statically analyzable
// literals — it cannot be an imported constant. Keep this in sync with
// REVALIDATE_SECONDS in lib/config.ts (which drives the actual fetch() cache
// and is fine to import since that's a runtime value, not a segment export).
export const revalidate = 3600;

export async function GET() {
  try {
    const rawNodes = await fetchAllRepoNodes();
    const trees = normalizeRepoNodes(rawNodes);
    const positions = computeForestLayout(trees);

    const placed: PlacedTreeData[] = trees.map((tree) => ({
      ...tree,
      ...(positions.get(tree.id) ?? { x: 0, y: 0 }),
    }));

    return NextResponse.json({ trees: placed });
  } catch (error) {
    console.error("[api/repos]", error);

    return NextResponse.json(
      { error: "Failed to fetch GitHub data. Check server logs." },
      { status: 502 },
    );
  }
}
