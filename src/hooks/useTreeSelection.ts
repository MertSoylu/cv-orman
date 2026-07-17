"use client";

import { useCallback, useState } from "react";

export function useTreeSelection() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const select = useCallback((id: string) => setSelectedId((prev) => (prev === id ? null : id)), []);
  const clear = useCallback(() => setSelectedId(null), []);

  return { selectedId, select, clear };
}
