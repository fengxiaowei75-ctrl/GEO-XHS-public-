import { useCallback, useEffect, useMemo, useState } from "react";

export function useDraftReview(readDrafts, writeDraftItem, imageHistoryEvent, fixedHistoryEvent) {
  const initialDrafts = useMemo(() => readDrafts(), [readDrafts]);
  const [drafts, setDrafts] = useState(initialDrafts);

  const refreshDrafts = useCallback(() => {
    setDrafts(readDrafts());
  }, [readDrafts]);

  const persistDraft = useCallback(
    (nextDraft) => {
      const normalized = writeDraftItem(nextDraft);
      setDrafts(readDrafts());
      return normalized;
    },
    [readDrafts, writeDraftItem],
  );

  useEffect(() => {
    window.addEventListener(imageHistoryEvent, refreshDrafts);
    window.addEventListener(fixedHistoryEvent, refreshDrafts);
    return () => {
      window.removeEventListener(imageHistoryEvent, refreshDrafts);
      window.removeEventListener(fixedHistoryEvent, refreshDrafts);
    };
  }, [fixedHistoryEvent, imageHistoryEvent, refreshDrafts]);

  return { drafts, setDrafts, persistDraft, refreshDrafts };
}
