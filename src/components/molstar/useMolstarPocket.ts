import { useState, useRef, useEffect } from "react";
import { PocketResult } from "./molstarThemes";

export function useMolstarPocket() {
  const [showPocket, setShowPocket] = useState<boolean>(false);
  const [isPocketPanelOpen, setIsPocketPanelOpen] = useState<boolean>(false);
  const [isPocketDragging, setIsPocketDragging] = useState<boolean>(false);
  const [pocketPosition, setPocketPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [pocketDragStart, setPocketDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const pocketComponentRefRef = useRef<any[]>([]);

  // Reset pocket panel position when toggling open/close
  useEffect(() => {
    setPocketPosition({ x: 0, y: 0 });
  }, [isPocketPanelOpen]);

  const handlePocketMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    setIsPocketDragging(true);
    setPocketDragStart({
      x: e.clientX - pocketPosition.x,
      y: e.clientY - pocketPosition.y,
    });
    e.preventDefault();
  };

  useEffect(() => {
    if (!isPocketDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPocketPosition({
        x: e.clientX - pocketDragStart.x,
        y: e.clientY - pocketDragStart.y,
      });
    };

    const handleMouseUp = () => {
      setIsPocketDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPocketDragging, pocketDragStart]);

  return {
    showPocket,
    setShowPocket,
    isPocketPanelOpen,
    setIsPocketPanelOpen,
    isPocketDragging,
    pocketPosition,
    pocketComponentRefRef,
    handlePocketMouseDown
  };
}
