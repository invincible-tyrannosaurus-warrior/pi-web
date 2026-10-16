"use client";

import { useState, useCallback, useRef } from "react";
import { droppedItems, type DroppedItem } from "@/lib/file-upload-client";

function hasDraggedFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.items).some((item) => item.kind === "file");
}

export function useDragDrop(onDrop: (items: DroppedItem[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback(() => {
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current = 0;
    setIsDragOver(false);
    onDrop(droppedItems(e.dataTransfer));
  }, [onDrop]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
