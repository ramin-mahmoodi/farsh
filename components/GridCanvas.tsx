import React, { useEffect, useRef } from 'react';
import { GridConfig, PixelData, ToolType } from '../types';

interface GridCanvasProps {
  pixels: PixelData[][];
  setPixels: React.Dispatch<React.SetStateAction<PixelData[][]>>;
  config: GridConfig;
  activeTool: ToolType;
  brushColor: string;
  brushSize: number;
  brushOpacity: number;
  onColorPick: (hex: string) => void;
}

// Helper to parse hex to RGB
const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

// Convert rgb to hex
const rgbToHex = (r: number, g: number, b: number) => {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

// Helper for blending colors
const blendColors = (bg: {r:number, g:number, b:number}, fg: {r:number, g:number, b:number}, alpha: number) => {
    // If alpha is 1, return fg
    if (alpha >= 1) return fg;
    
    const r = Math.round(bg.r * (1 - alpha) + fg.r * alpha);
    const g = Math.round(bg.g * (1 - alpha) + fg.g * alpha);
    const b = Math.round(bg.b * (1 - alpha) + fg.b * alpha);
    
    return { r, g, b };
};

export default function GridCanvas({ pixels, setPixels, config, activeTool, brushColor, brushSize, brushOpacity, onColorPick }: GridCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  // Handle Drawing Logic
  const handleDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || activeTool === 'none' || pixels.length === 0) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const cellSize = 20; 
    const mouseX = Math.floor((e.clientX - rect.left) / cellSize);
    const mouseY = Math.floor((e.clientY - rect.top) / cellSize);

    if (mouseX < 0 || mouseX >= config.cols || mouseY < 0 || mouseY >= config.rows) return;

    if (activeTool === 'dropper') {
        if (pixels[mouseY] && pixels[mouseY][mouseX]) {
            onColorPick(pixels[mouseY][mouseX].hex);
        }
        return;
    }

    if (!isDrawing.current && e.type !== 'mousedown' && e.type !== 'click') return;

    // Define brush/eraser color
    // Eraser always draws white, but respects opacity if set (blends to white)
    const paintHex = activeTool === 'eraser' ? '#ffffff' : brushColor;
    const paintRgb = hexToRgb(paintHex) || {r: 255, g: 255, b: 255};
    
    // Calculate range for brush size
    const offset = Math.floor(brushSize / 2);

    setPixels(prev => {
        // Clone state shallowly
        const newPixels = [...prev];
        let changed = false;

        for (let dy = 0; dy < brushSize; dy++) {
            for (let dx = 0; dx < brushSize; dx++) {
                const targetY = mouseY - offset + dy;
                const targetX = mouseX - offset + dx;

                // Bounds check
                if (targetY >= 0 && targetY < config.rows && targetX >= 0 && targetX < config.cols) {
                    
                    // Copy row if not already copied in this batch (optimization)
                    if (newPixels[targetY] === prev[targetY]) {
                        newPixels[targetY] = [...prev[targetY]];
                    }

                    const currentPixel = newPixels[targetY][targetX];
                    if (!currentPixel) continue;

                    // Blend colors
                    const blended = blendColors(currentPixel, paintRgb, brushOpacity);
                    const blendedHex = rgbToHex(blended.r, blended.g, blended.b);

                    // Update pixel
                    if (currentPixel.hex !== blendedHex) {
                        newPixels[targetY][targetX] = {
                            r: blended.r,
                            g: blended.g,
                            b: blended.b,
                            hex: blendedHex
                        };
                        changed = true;
                    }
                }
            }
        }
        return changed ? newPixels : prev;
    });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      isDrawing.current = true;
      handleDraw(e);
  };
  
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if(isDrawing.current && activeTool !== 'dropper') {
          handleDraw(e);
      }
  };

  const handleMouseUp = () => {
      isDrawing.current = false;
  };

  // Effect to draw the visual grid based on props
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || pixels.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellSize = 20; 
    const width = config.cols * cellSize;
    const height = config.rows * cellSize;

    canvas.width = width;
    canvas.height = height;

    // Clear
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Draw Pixels
    pixels.forEach((row, y) => {
      row.forEach((pixel, x) => {
        ctx.fillStyle = pixel.hex;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      });
    });

    // Draw Grid Lines
    if (config.showGrid) {
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.5;
      
      ctx.beginPath();
      for (let x = 0; x <= config.cols; x++) {
        ctx.moveTo(x * cellSize, 0);
        ctx.lineTo(x * cellSize, height);
      }
      for (let y = 0; y <= config.rows; y++) {
        ctx.moveTo(0, y * cellSize);
        ctx.lineTo(width, y * cellSize);
      }
      ctx.stroke();

      // 10-knot markers
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 2;
      
      ctx.beginPath();
      for (let x = 0; x <= config.cols; x += 10) {
        ctx.moveTo(x * cellSize, 0);
        ctx.lineTo(x * cellSize, height);
        
        if (config.showNumbers && x > 0 && x < config.cols) {
           ctx.save();
           ctx.fillStyle = 'black';
           ctx.font = 'bold 10px Arial';
           ctx.textAlign = 'center';
           ctx.textBaseline = 'bottom';
           ctx.fillText(x.toString(), x * cellSize, -2);
           ctx.restore();
        }
      }
      for (let y = 0; y <= config.rows; y += 10) {
        ctx.moveTo(0, y * cellSize);
        ctx.lineTo(width, y * cellSize);
      }
      ctx.stroke();

      // Center lines
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.8)'; 
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      
      const midX = (config.cols / 2) * cellSize;
      const midY = (config.rows / 2) * cellSize;
      
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, height);
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();
      ctx.setLineDash([]); 
    }

  }, [pixels, config.showGrid, config.showNumbers, config.cols, config.rows]);

  return (
    <div className="overflow-auto print:overflow-visible max-w-full print:max-w-none relative cursor-crosshair">
       <canvas 
        ref={canvasRef} 
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="max-w-none border border-gray-300 shadow-sm"
        style={{
          width: pixels.length > 0 ? pixels[0].length * 20 : 0, 
          height: pixels.length * 20,
          cursor: activeTool === 'none' ? 'default' : activeTool === 'dropper' ? 'copy' : 'crosshair'
        }}
       />
    </div>
  );
}