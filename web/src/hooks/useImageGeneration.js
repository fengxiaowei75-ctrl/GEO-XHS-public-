import { useCallback, useState } from "react";

export function useImageGeneration({ onOpen } = {}) {
  const [editingSlot, setEditingSlot] = useState(null);
  const [editingSourceImage, setEditingSourceImage] = useState(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [editImageCount, setEditImageCount] = useState("1");

  const resetImageEdit = useCallback(() => {
    setEditingSlot(null);
    setEditingSourceImage(null);
    setEditInstruction("");
    setEditImageCount("1");
  }, []);

  const openImageEdit = useCallback(
    (slot, sourceImage = null) => {
      setEditingSlot(slot);
      setEditingSourceImage(sourceImage);
      setEditInstruction("");
      setEditImageCount("1");
      onOpen?.(slot, sourceImage);
    },
    [onOpen],
  );

  return {
    editingSlot,
    editingSourceImage,
    editInstruction,
    editImageCount,
    setEditingSlot,
    setEditingSourceImage,
    setEditInstruction,
    setEditImageCount,
    openImageEdit,
    resetImageEdit,
  };
}
