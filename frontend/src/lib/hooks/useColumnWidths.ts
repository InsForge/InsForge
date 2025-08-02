import { useState, useCallback, useEffect, useRef } from 'react';
import type { DataGridColumn } from '@/components/DataGrid';

interface ColumnWidthData {
  [columnKey: string]: number | string;
}

/**
 * Hook to manage column widths with localStorage persistence
 * Saves to localStorage only when column resizing is finished (mouseup/pointerup)
 * @param storageKey - Unique key for localStorage storage
 * @param initialColumns - Initial column definitions
 * @param minWidth - Minimum width for columns in pixels (default: 100)
 * @returns [columns with saved widths, function to update width]
 */
export function useColumnWidths(
  storageKey: string,
  initialColumns: DataGridColumn[],
  minWidth = 100
): [DataGridColumn[], (columnKey: string, width: number | string) => void] {
  const [savedWidths, setSavedWidths] = useState<ColumnWidthData>(() => {
    try {
      const stored = localStorage.getItem(`column-widths-${storageKey}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Keep track of current widths (for immediate UI updates during dragging)
  const [currentWidths, setCurrentWidths] = useState<ColumnWidthData>({});
  const isResizingRef = useRef(false);
  const prevStorageKeyRef = useRef(storageKey);

  // Effect to handle storage key changes (e.g., switching between tables)
  useEffect(() => {
    if (prevStorageKeyRef.current !== storageKey) {
      // Save any pending changes for the previous storage key
      if (Object.keys(currentWidths).length > 0) {
        const oldSavedWidths = (() => {
          try {
            const stored = localStorage.getItem(`column-widths-${prevStorageKeyRef.current}`);
            return stored ? JSON.parse(stored) : {};
          } catch {
            return {};
          }
        })();

        const mergedWidths = { ...oldSavedWidths, ...currentWidths };
        try {
          localStorage.setItem(
            `column-widths-${prevStorageKeyRef.current}`,
            JSON.stringify(mergedWidths)
          );
        } catch {
          // Handle localStorage errors silently
        }
      }

      // Reset current widths for the new storage key
      setCurrentWidths({});

      // Load saved widths for the new storage key
      try {
        const stored = localStorage.getItem(`column-widths-${storageKey}`);
        const newSavedWidths = stored ? JSON.parse(stored) : {};
        setSavedWidths(newSavedWidths);
      } catch {
        setSavedWidths({});
      }

      // Update the reference
      prevStorageKeyRef.current = storageKey;
    }
  }, [storageKey, currentWidths]);

  // Merge saved and current widths with initial columns
  const finalWidths = { ...savedWidths, ...currentWidths };
  const columnsWithSavedWidths = initialColumns.map((column) => {
    const savedWidth = finalWidths[column.key];
    let finalWidth = column.width;

    if (savedWidth !== undefined) {
      // Apply minimum width constraint to saved widths
      const numericSavedWidth =
        typeof savedWidth === 'string' ? parseFloat(savedWidth) || 0 : savedWidth;
      finalWidth = Math.max(numericSavedWidth, minWidth);
    }

    return {
      ...column,
      width: finalWidth,
    };
  });

  // Function to save pending changes to localStorage
  const savePendingChanges = useCallback(() => {
    if (Object.keys(currentWidths).length === 0) {
      return;
    }

    const newSavedWidths = { ...savedWidths, ...currentWidths };

    try {
      localStorage.setItem(`column-widths-${storageKey}`, JSON.stringify(newSavedWidths));
      setSavedWidths(newSavedWidths);
      setCurrentWidths({});
    } catch {
      // Handle localStorage errors silently
    }
  }, [currentWidths, savedWidths, storageKey]);

  // Function to update column width (immediate UI update)
  const updateColumnWidth = useCallback(
    (columnKey: string, width: number | string) => {
      // Mark that we're in resizing mode
      isResizingRef.current = true;

      // Convert width to number and apply minimum width constraint
      const numericWidth = typeof width === 'string' ? parseFloat(width) || 0 : width;
      const constrainedWidth = Math.max(numericWidth, minWidth);

      // Immediately update current widths for responsive UI
      setCurrentWidths((prev) => ({
        ...prev,
        [columnKey]: constrainedWidth,
      }));
    },
    [minWidth]
  );

  // Set up global mouse/pointer event listeners to detect resize end
  useEffect(() => {
    const handleResizeEnd = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        savePendingChanges();
      }
    };

    // Listen for mouse and pointer events to detect drag end
    const handleMouseUp = () => handleResizeEnd();
    const handlePointerUp = () => handleResizeEnd();

    // Also listen for mouse leave to handle edge cases
    const handleMouseLeave = (e: MouseEvent) => {
      // Only trigger if leaving the window/document
      if (!e.relatedTarget) {
        handleResizeEnd();
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [savePendingChanges]);

  // Save any pending changes when component unmounts
  useEffect(() => {
    return () => {
      if (Object.keys(currentWidths).length > 0) {
        const newSavedWidths = { ...savedWidths, ...currentWidths };
        try {
          localStorage.setItem(`column-widths-${storageKey}`, JSON.stringify(newSavedWidths));
        } catch {
          // Handle localStorage errors silently
        }
      }
    };
  }, [currentWidths, savedWidths, storageKey]);

  return [columnsWithSavedWidths, updateColumnWidth];
}
