export interface PixelData {
  r: number;
  g: number;
  b: number;
  hex: string;
}

export interface GridConfig {
  rows: number;
  cols: number;
  showGrid: boolean;
  showNumbers: boolean;
  contrast: number;
  usePalette: boolean;
  palette: string[];
}

export type ToolType = 'none' | 'brush' | 'eraser' | 'dropper';