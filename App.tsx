import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Grid, Wand2, Image as ImageIcon, Printer, Settings2, RefreshCcw, Palette, Plus, Trash2, Check, Ratio, Paintbrush, Eraser, Pipette, MousePointer2, Move, Crown, Save, FolderOpen, Key, X } from 'lucide-react';
import { GridConfig, ToolType, PixelData } from './types';
import GridCanvas from './components/GridCanvas';
import { generateRugDesign } from './services/geminiService';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const PRESET_PALETTES = {
  traditional: {
    name: 'سنتی لاکی',
    colors: ['#8B0000', '#F5F5DC', '#000080', '#D4AF37', '#000000', '#006400']
  },
  earthy: {
    name: 'طبیعت و کویر',
    colors: ['#8B4513', '#D2691E', '#F4A460', '#556B2F', '#FAEBD7', '#2F4F4F']
  },
  modern: {
    name: 'مدرن خاکستری',
    colors: ['#2C3E50', '#95A5A6', '#ECF0F1', '#E74C3C', '#34495E']
  },
  blue: {
    name: 'نیلی و فیروزه‌ای',
    colors: ['#000080', '#4169E1', '#87CEEB', '#E0FFFF', '#FFFFFF', '#191970']
  }
};

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

// Weighted RGB distance
const getColorDistance = (c1: {r: number, g: number, b: number}, c2: {r: number, g: number, b: number}) => {
  const rmean = (c1.r + c2.r) / 2;
  const r = c1.r - c2.r;
  const g = c1.g - c2.g;
  const b = c1.b - c2.b;
  return Math.sqrt((((512 + rmean) * r * r) >> 8) + 4 * g * g + (((767 - rmean) * b * b) >> 8));
};

// --- Median Cut Quantization Algorithm ---

interface RGB { r: number; g: number; b: number; }

const findBiggestRange = (pixels: RGB[]) => {
  let minR=255, maxR=0, minG=255, maxG=0, minB=255, maxB=0;
  for(const p of pixels) {
     if(p.r < minR) minR = p.r; if(p.r > maxR) maxR = p.r;
     if(p.g < minG) minG = p.g; if(p.g > maxG) maxG = p.g;
     if(p.b < minB) minB = p.b; if(p.b > maxB) maxB = p.b;
  }
  const rRange = maxR - minR;
  const gRange = maxG - minG;
  const bRange = maxB - minB;
  
  if (rRange >= gRange && rRange >= bRange) return 'r';
  if (gRange >= rRange && gRange >= bRange) return 'g';
  return 'b';
};

const medianCutQuantization = (pixels: RGB[], depth: number): RGB[] => {
  if (depth === 0 || pixels.length === 0) {
     const r = Math.round(pixels.reduce((a,b)=>a+b.r,0)/pixels.length);
     const g = Math.round(pixels.reduce((a,b)=>a+b.g,0)/pixels.length);
     const b = Math.round(pixels.reduce((a,b)=>a+b.b,0)/pixels.length);
     return [{r,g,b}];
  }
  
  const component = findBiggestRange(pixels);
  // Sort pixels by the channel with biggest range
  // @ts-ignore
  pixels.sort((a,b) => a[component] - b[component]);
  
  const mid = Math.floor(pixels.length / 2);
  return [
     ...medianCutQuantization(pixels.slice(0, mid), depth - 1),
     ...medianCutQuantization(pixels.slice(mid), depth - 1)
  ];
};

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [pixels, setPixels] = useState<PixelData[][]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>('3:4');
  
  // GenAI Settings
  const [useProModel, setUseProModel] = useState(false);
  const [imageSize, setImageSize] = useState('1K');

  // API Key Management
  const [userApiKey, setUserApiKey] = useState('');
  const [showKeyModal, setShowKeyModal] = useState(false);
  
  // Drawing State
  const [activeTool, setActiveTool] = useState<ToolType>('none');
  const [brushColor, setBrushColor] = useState<string>('#000000');
  const [brushSize, setBrushSize] = useState<number>(1);
  const [brushOpacity, setBrushOpacity] = useState<number>(100);

  const [gridConfig, setGridConfig] = useState<GridConfig>({
    rows: 80,
    cols: 60,
    showGrid: true,
    showNumbers: false,
    contrast: 1.0,
    usePalette: false,
    palette: PRESET_PALETTES.traditional.colors
  });

  const printRef = useRef<HTMLDivElement>(null);
  
  // Flag to prevent auto-processing when loading from save
  const isProcessingBlockedRef = useRef(false);

  // Load API Key from localStorage
  useEffect(() => {
    const storedKey = localStorage.getItem('gemini_api_key');
    if (storedKey) {
      setUserApiKey(storedKey);
    }
  }, []);

  const saveApiKey = () => {
    localStorage.setItem('gemini_api_key', userApiKey);
    setShowKeyModal(false);
    alert("کلید API ذخیره شد.");
  };

  const clearApiKey = () => {
    localStorage.removeItem('gemini_api_key');
    setUserApiKey('');
    alert("کلید API حذف شد.");
  };

  // --- Image Processing Logic (Moved from GridCanvas) ---
  useEffect(() => {
    // If blocked (e.g., during load), just reset the block and skip generation
    if (isProcessingBlockedRef.current) {
        isProcessingBlockedRef.current = false;
        return;
    }

    if (!imageSrc) return;

    const processImage = () => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.src = imageSrc;
      
      img.onload = () => {
        const { cols, rows, contrast, usePalette, palette } = gridConfig;
        
        const offCanvas = document.createElement('canvas');
        offCanvas.width = cols;
        offCanvas.height = rows;
        const ctx = offCanvas.getContext('2d');
        
        if (!ctx) return;

        ctx.filter = `contrast(${contrast})`; 
        ctx.drawImage(img, 0, 0, cols, rows);

        const imageData = ctx.getImageData(0, 0, cols, rows);
        const data = imageData.data;
        const newPixels: PixelData[][] = [];

        const paletteRgb = usePalette ? palette.map(hex => ({ hex, ...hexToRgb(hex)! })).filter(c => c.r !== undefined) : [];

        for (let y = 0; y < rows; y++) {
          const row: PixelData[] = [];
          for (let x = 0; x < cols; x++) {
            const i = (y * cols + x) * 4;
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];
            let hex = rgbToHex(r, g, b);

            if (usePalette && paletteRgb.length > 0) {
              let minDist = Infinity;
              let closest = paletteRgb[0];

              for (const pColor of paletteRgb) {
                const dist = getColorDistance({r, g, b}, pColor);
                if (dist < minDist) {
                  minDist = dist;
                  closest = pColor;
                }
              }
              r = closest.r;
              g = closest.g;
              b = closest.b;
              hex = closest.hex;
            }

            row.push({ r, g, b, hex });
          }
          newPixels.push(row);
        }
        setPixels(newPixels);
      };
    };

    processImage();
  }, [imageSrc, gridConfig.cols, gridConfig.rows, gridConfig.contrast, gridConfig.usePalette, gridConfig.palette]);

  // --- Handlers ---

  const loadImageAndConfig = (src: string) => {
    isProcessingBlockedRef.current = false; 
    const img = new Image();
    img.onload = () => {
        const aspect = img.height / img.width;
        let newCols = 60;
        if (img.width < 150) newCols = img.width;
        else newCols = 100; 

        const newRows = Math.round(newCols * aspect);
        
        const ratios: Record<string, number> = { "1:1": 1, "3:4": 4/3, "4:3": 3/4, "9:16": 16/9, "16:9": 9/16 };
        let bestRatio = "1:1";
        let minError = Infinity;
        for (const [rStr, rVal] of Object.entries(ratios)) {
             const error = Math.abs(aspect - rVal);
             if (error < minError) { minError = error; bestRatio = rStr; }
        }
        setAspectRatio(bestRatio);
        
        setGridConfig(prev => ({ ...prev, cols: newCols, rows: newRows }));
        setImageSrc(src);
    };
    img.src = src;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        loadImageAndConfig(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerateDesign = async () => {
    setIsGenerating(true);
    isProcessingBlockedRef.current = false;
    try {
      let model = 'gemini-2.5-flash-image';
      if (useProModel) {
        model = 'gemini-3-pro-image-preview';
        // Only trigger AI Studio key if no user key is set
        if (!userApiKey) {
             // @ts-ignore
            if (window.aistudio && window.aistudio.hasSelectedApiKey) {
                // @ts-ignore
                const hasKey = await window.aistudio.hasSelectedApiKey();
                if (!hasKey) {
                    // @ts-ignore
                    if (window.aistudio.openSelectKey) await window.aistudio.openSelectKey();
                }
            }
        }
      }

      const prompt = "A traditional Persian rug pattern design, top down view, flat, intricate floral motifs, high contrast, red and cream dominant colors";
      
      // Pass the userApiKey to the service
      const generatedImage = await generateRugDesign(prompt, aspectRatio, model, imageSize, userApiKey);
      
      if (generatedImage) {
        loadImageAndConfig(generatedImage);
      }
    } catch (error) {
      console.error("Failed to generate rug:", error);
      alert("متاسفانه در تولید طرح خطایی رخ داد. لطفا کلید API را از دکمه کلید (بالا) بررسی کنید.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveProject = () => {
    if (pixels.length === 0) {
      alert("طرحی برای ذخیره وجود ندارد.");
      return;
    }
    const projectData = {
      pixels,
      gridConfig,
      imageSrc,
      aspectRatio,
      timestamp: new Date().toISOString()
    };
    try {
      localStorage.setItem('rugProject', JSON.stringify(projectData));
      alert("پروژه با موفقیت ذخیره شد.");
    } catch (e) {
      alert("خطا در ذخیره سازی. ممکن است حجم طرح زیاد باشد.");
    }
  };

  const handleLoadProject = () => {
    const saved = localStorage.getItem('rugProject');
    if (!saved) {
      alert("پروژه ذخیره شده‌ای یافت نشد.");
      return;
    }
    try {
      const data = JSON.parse(saved);
      // Block auto-processing to prevent overwriting pixels with imageSrc re-process
      isProcessingBlockedRef.current = true; 
      
      setGridConfig(data.gridConfig);
      setImageSrc(data.imageSrc);
      setAspectRatio(data.aspectRatio || '3:4');
      setPixels(data.pixels);
      
      alert("پروژه بازیابی شد.");
    } catch (e) {
      console.error(e);
      alert("خطا در بارگذاری پروژه.");
    }
  };

  const handleDownloadPDF = async () => {
    const canvas = printRef.current?.querySelector('canvas');
    if (!canvas) {
      alert("بوم طراحی پیدا نشد.");
      return;
    }
    try {
        const isLandscape = canvas.width > canvas.height;
        const pdf = new jsPDF({ orientation: isLandscape ? 'l' : 'p', unit: 'mm', format: 'a3' });
        const imgData = canvas.toDataURL('image/jpeg', 1.0);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const margin = 15;
        const maxWidth = pdfWidth - (margin * 2);
        const maxHeight = pdfHeight - (margin * 2);
        const imgProps = pdf.getImageProperties(imgData);
        const imgRatio = imgProps.width / imgProps.height;
        const pageRatio = maxWidth / maxHeight;
        let finalWidth, finalHeight;

        if (imgRatio > pageRatio) {
            finalWidth = maxWidth;
            finalHeight = maxWidth / imgRatio;
        } else {
            finalHeight = maxHeight;
            finalWidth = maxHeight * imgRatio;
        }
        const x = (pdfWidth - finalWidth) / 2;
        const y = (pdfHeight - finalHeight) / 2;

        pdf.addImage(imgData, 'JPEG', x, y, finalWidth, finalHeight);
        pdf.setFontSize(10);
        pdf.setTextColor(150);
        pdf.text(`Naghsh-e-Farsh AI | ${gridConfig.cols}x${gridConfig.rows}`, pdfWidth / 2, pdfHeight - 8, { align: 'center' });
        pdf.save(`rug-design-${gridConfig.cols}x${gridConfig.rows}.pdf`);
    } catch (err) {
        alert("خطا در ایجاد PDF");
    }
  };

  const updatePaletteColor = (index: number, newColor: string) => {
    const newPalette = [...gridConfig.palette];
    newPalette[index] = newColor;
    setGridConfig({ ...gridConfig, palette: newPalette });
  };

  const addColorToPalette = () => {
    setGridConfig({ ...gridConfig, palette: [...gridConfig.palette, '#000000'] });
  };

  const removeColorFromPalette = (index: number) => {
    if (gridConfig.palette.length <= 2) return;
    const newPalette = gridConfig.palette.filter((_, i) => i !== index);
    setGridConfig({ ...gridConfig, palette: newPalette });
  };

  const extractPaletteFromImage = () => {
    if (!imageSrc) return;
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageSrc;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if(!ctx) return;
      
      // Limit processing size for performance
      const maxDim = 200;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      
      const pixels: RGB[] = [];
      for(let i = 0; i < imageData.length; i += 4) {
        pixels.push({r: imageData[i], g: imageData[i+1], b: imageData[i+2]});
      }

      // Use Median Cut to get best 16 colors (depth 4)
      const quantizedColors = medianCutQuantization(pixels, 4);
      
      const uniqueColors = [...new Set(quantizedColors.map(c => rgbToHex(c.r, c.g, c.b)))];

      setGridConfig(prev => ({ ...prev, palette: uniqueColors, usePalette: true }));
    };
  };

  const handleColorPick = (hex: string) => {
    setBrushColor(hex);
    setActiveTool('brush');
  };

  return (
    <div className="min-h-screen flex flex-col text-slate-800">

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95">
             <div className="bg-rug-red text-white p-4 flex justify-between items-center">
                <h3 className="font-bold flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  تنظیمات کلید API
                </h3>
                <button onClick={() => setShowKeyModal(false)} className="hover:bg-white/20 p-1 rounded-full"><X className="w-5 h-5"/></button>
             </div>
             <div className="p-6 space-y-4">
                <p className="text-sm text-gray-600">برای استفاده از هوش مصنوعی، لطفاً کلید API جمینای خود را وارد کنید. این کلید فقط در مرورگر شما ذخیره می‌شود.</p>
                <input 
                  type="text" 
                  value={userApiKey}
                  onChange={(e) => setUserApiKey(e.target.value)}
                  placeholder="کلید API خود را اینجا وارد کنید (AIza...)"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rug-gold outline-none ltr text-center font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <button onClick={saveApiKey} className="flex-1 bg-rug-navy text-white py-2 rounded-lg hover:bg-blue-900 transition-colors">ذخیره</button>
                  {userApiKey && (
                    <button onClick={clearApiKey} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors">حذف</button>
                  )}
                </div>
                <div className="text-xs text-gray-400 text-center pt-2">
                   <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline hover:text-rug-navy">دریافت کلید از گوگل</a>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-rug-red text-rug-cream shadow-xl border-b-4 border-rug-gold relative overflow-hidden no-print">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/arabesque.png')]"></div>
        <div className="container mx-auto px-4 py-6 relative z-10 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rug-gold rounded-full shadow-lg">
              <Grid className="w-8 h-8 text-rug-darkRed" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-wide">نقش فرش هوشمند</h1>
              <p className="text-sm text-rug-gold opacity-90">تبدیل عکس به نقشه شطرنجی قالی</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center justify-center gap-3">
             <div className="flex items-center bg-white/10 rounded-lg p-1 border border-rug-gold/30">
                <Ratio className="w-4 h-4 mx-2 opacity-70" />
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="bg-transparent text-white text-sm outline-none cursor-pointer [&>option]:text-black border-none focus:ring-0 py-1"
                  disabled={isGenerating}
                >
                  <option value="1:1">مربع (1:1)</option>
                  <option value="3:4">قالی (3:4)</option>
                  <option value="4:3">کناره افقی (4:3)</option>
                  <option value="9:16">باریک (9:16)</option>
                  <option value="16:9">افقی عریض (16:9)</option>
                </select>
             </div>

             <button
               onClick={() => setUseProModel(!useProModel)}
               className={`flex items-center gap-2 px-3 py-1 rounded-lg border transition-all ${useProModel ? 'bg-amber-100 border-amber-400 text-amber-900' : 'bg-white/10 border-rug-gold/30 text-white'}`}
               title={useProModel ? "مدل پیشرفته فعال است" : "مدل استاندارد"}
               disabled={isGenerating}
             >
               <Crown className={`w-4 h-4 ${useProModel ? 'fill-amber-500 text-amber-600' : 'opacity-70'}`} />
               <span className="text-sm font-medium">{useProModel ? 'Pro' : 'Fast'}</span>
             </button>

             {useProModel && (
                <div className="flex items-center bg-amber-100 rounded-lg p-1 border border-amber-400 animate-in fade-in slide-in-from-left-2">
                    <select
                      value={imageSize}
                      onChange={(e) => setImageSize(e.target.value)}
                      className="bg-transparent text-amber-900 text-sm outline-none cursor-pointer border-none focus:ring-0 py-1 px-2 font-bold"
                      disabled={isGenerating}
                    >
                      <option value="1K">1K</option>
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                    </select>
                </div>
             )}

            {/* API Key Button */}
            <button
               onClick={() => setShowKeyModal(true)}
               className={`p-2 rounded-lg border transition-all ${userApiKey ? 'bg-green-600 border-green-400 text-white' : 'bg-white/10 border-rug-gold/30 text-white hover:bg-white/20'}`}
               title="تنظیمات کلید API"
             >
               <Key className="w-5 h-5" />
             </button>

             <button 
              onClick={handleGenerateDesign}
              disabled={isGenerating}
              className="flex items-center gap-2 bg-rug-navy hover:bg-blue-900 text-white px-4 py-2 rounded-lg transition-all shadow-md disabled:opacity-50"
            >
              <Wand2 className={`w-5 h-5 ${isGenerating ? 'animate-spin' : ''}`} />
              {isGenerating ? 'طراحی' : 'طراحی هوشمند'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8 flex flex-col gap-8 print:block print:p-0 print:gap-0">
        
        {/* Controls Section */}
        <section className="bg-white rounded-xl shadow-lg border border-rug-gold/30 no-print overflow-hidden">
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-end border-b border-gray-100 pb-6">
            
            {/* Upload & Save/Load */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-rug-darkRed">بارگذاری تصویر</label>
                <div className="relative">
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleImageUpload}
                    className="hidden" 
                    id="img-upload"
                  />
                  <label 
                    htmlFor="img-upload" 
                    className="flex items-center justify-center gap-2 w-full p-3 border-2 border-dashed border-rug-gold rounded-lg cursor-pointer hover:bg-rug-cream/20 transition-colors text-rug-darkRed"
                  >
                    <Upload className="w-5 h-5" />
                    <span>انتخاب عکس فرش</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-2">
                 <button 
                   onClick={handleSaveProject}
                   className="flex-1 flex items-center justify-center gap-1 bg-gray-100 text-gray-700 p-2 rounded hover:bg-gray-200 border border-gray-300 text-xs transition-colors"
                   title="ذخیره پروژه"
                 >
                   <Save className="w-4 h-4" />
                   ذخیره
                 </button>
                 <button 
                   onClick={handleLoadProject}
                   className="flex-1 flex items-center justify-center gap-1 bg-gray-100 text-gray-700 p-2 rounded hover:bg-gray-200 border border-gray-300 text-xs transition-colors"
                   title="بارگذاری پروژه"
                 >
                   <FolderOpen className="w-4 h-4" />
                   بازیابی
                 </button>
              </div>
            </div>

            {/* Grid Settings */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-rug-darkRed">ابعاد شبکه (گره)</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-gray-500 block mb-0.5">عرض (ستون)</label>
                  <input 
                    type="number" 
                    value={gridConfig.cols}
                    onChange={(e) => setGridConfig({...gridConfig, cols: Math.max(1, parseInt(e.target.value) || 10)})} 
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-rug-gold outline-none text-center ltr text-sm"
                    min="1" max="500"
                  />
                </div>
                <div className="flex-1">
                   <label className="text-[10px] text-gray-500 block mb-0.5">ارتفاع (ردیف)</label>
                   <input 
                    type="number" 
                    value={gridConfig.rows}
                    onChange={(e) => setGridConfig({...gridConfig, rows: Math.max(1, parseInt(e.target.value) || 10)})} 
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-rug-gold outline-none text-center ltr text-sm"
                    min="1" max="500"
                  />
                </div>
              </div>
            </div>

            {/* Contrast */}
             <div className="space-y-2">
              <label className="block text-sm font-medium text-rug-darkRed">وضوح رنگ (کنتراست)</label>
              <input 
                type="range" 
                min="0.5" 
                max="2.0" 
                step="0.1"
                value={gridConfig.contrast}
                onChange={(e) => setGridConfig({...gridConfig, contrast: parseFloat(e.target.value)})}
                className="w-full accent-rug-red"
              />
            </div>

             {/* Toggles */}
             <div className="flex gap-4 pb-2">
                <button 
                  onClick={() => setGridConfig(p => ({...p, showGrid: !p.showGrid}))}
                  className={`flex-1 flex flex-col items-center justify-center p-2 rounded-lg border ${gridConfig.showGrid ? 'bg-rug-cream border-rug-gold text-rug-darkRed' : 'border-gray-200 text-gray-400'}`}
                >
                  <Grid className="w-5 h-5 mb-1" />
                  <span className="text-xs">خطوط</span>
                </button>
                <button 
                  onClick={handleDownloadPDF}
                  disabled={!imageSrc}
                  className="flex-1 flex flex-col items-center justify-center p-2 rounded-lg border border-rug-gold bg-rug-teal text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-5 h-5 mb-1" />
                  <span className="text-xs">دانلود PDF</span>
                </button>
             </div>
          </div>

          {/* Palette Controls */}
          <div className="p-6 bg-rug-cream/30">
            <div className="flex flex-col md:flex-row gap-6">
              
              {/* Enable Palette Mode */}
              <div className="md:w-1/4 space-y-3">
                <button 
                  onClick={() => setGridConfig(p => ({...p, usePalette: !p.usePalette}))}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all ${
                    gridConfig.usePalette 
                      ? 'border-rug-red bg-rug-red text-white shadow-md' 
                      : 'border-gray-300 bg-white text-gray-500 hover:border-rug-gold'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Palette className="w-5 h-5" />
                    <span className="font-bold text-sm">حالت بافت (رنگ محدود)</span>
                  </div>
                  {gridConfig.usePalette && <Check className="w-4 h-4" />}
                </button>

                 <button
                   onClick={extractPaletteFromImage}
                   disabled={!imageSrc}
                   className="w-full flex items-center justify-center gap-2 p-2 text-xs text-rug-navy border border-rug-navy/30 rounded hover:bg-rug-navy hover:text-white transition-colors disabled:opacity-50"
                 >
                   <RefreshCcw className="w-3 h-3" />
                   استخراج رنگ از تصویر
                 </button>
              </div>

              {/* Palette Editor */}
              <div className={`flex-1 transition-opacity ${gridConfig.usePalette ? 'opacity-100 pointer-events-auto' : 'opacity-40 pointer-events-none grayscale'}`}>
                <div className="space-y-4">
                  
                  {/* Presets */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className="text-xs font-bold text-rug-darkRed ml-2 self-center">پالت‌های آماده:</span>
                    {Object.entries(PRESET_PALETTES).map(([key, preset]) => (
                      <button
                        key={key}
                        onClick={() => setGridConfig({...gridConfig, palette: [...preset.colors]})}
                        className="px-3 py-1 text-xs rounded-full border border-rug-gold/50 hover:bg-rug-gold hover:text-white transition-colors bg-white text-rug-darkRed"
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>

                  {/* Active Colors */}
                  <div className="flex flex-wrap gap-3 items-center">
                    {gridConfig.palette.map((color, index) => (
                      <div key={index} className="group relative">
                        <button
                          onClick={() => { setBrushColor(color); setActiveTool('brush'); }}
                          className={`w-10 h-10 rounded-full cursor-pointer border-2 shadow-md overflow-hidden p-0 transition-transform hover:scale-110 ${brushColor === color ? 'border-rug-navy ring-2 ring-offset-1 ring-rug-navy' : 'border-white'}`}
                          style={{backgroundColor: color}}
                        />
                         <input 
                           type="color"
                           value={color}
                           onChange={(e) => updatePaletteColor(index, e.target.value)}
                           className="absolute inset-0 opacity-0 cursor-pointer"
                         />
                        <button
                          onClick={(e) => { e.stopPropagation(); removeColorFromPalette(index); }}
                          className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
                          title="حذف رنگ"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button onClick={addColorToPalette} className="w-10 h-10 rounded-full border-2 border-dashed border-gray-400 flex items-center justify-center text-gray-500 hover:border-rug-gold hover:text-rug-gold transition-colors"><Plus className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Workspace */}
        <div className="flex flex-col lg:flex-row gap-8 print:block">
           <div className="w-full lg:w-1/3 flex flex-col gap-4 no-print">
             {imageSrc && (
               <div className="bg-white rounded-xl shadow-md border border-gray-200 p-2">
                 <h3 className="font-bold text-rug-darkRed flex items-center gap-2 mb-2 px-2">
                   <ImageIcon className="w-4 h-4" />
                   تصویر اصلی
                 </h3>
                 <div className="rug-border p-1 bg-white rounded-sm">
                   <img src={imageSrc} alt="Original" className="w-full h-auto object-cover" />
                 </div>
               </div>
             )}

             <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4">
                <h3 className="text-sm font-bold text-gray-600 mb-3 flex items-center gap-2">
                   <Paintbrush className="w-4 h-4" />
                   ابزار طراحی دستی
                </h3>
                <div className="flex gap-2 mb-4">
                    <button onClick={() => setActiveTool(activeTool === 'brush' ? 'none' : 'brush')} className={`flex-1 p-2 rounded flex flex-col items-center gap-1 transition-colors ${activeTool === 'brush' ? 'bg-rug-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><Paintbrush className="w-5 h-5" /><span className="text-xs">قلم‌مو</span></button>
                    <button onClick={() => setActiveTool(activeTool === 'eraser' ? 'none' : 'eraser')} className={`flex-1 p-2 rounded flex flex-col items-center gap-1 transition-colors ${activeTool === 'eraser' ? 'bg-rug-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><Eraser className="w-5 h-5" /><span className="text-xs">پاک‌کن</span></button>
                    <button onClick={() => setActiveTool(activeTool === 'dropper' ? 'none' : 'dropper')} className={`flex-1 p-2 rounded flex flex-col items-center gap-1 transition-colors ${activeTool === 'dropper' ? 'bg-rug-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><Pipette className="w-5 h-5" /><span className="text-xs">قطره‌چکان</span></button>
                     <button onClick={() => setActiveTool('none')} className={`flex-1 p-2 rounded flex flex-col items-center gap-1 transition-colors ${activeTool === 'none' ? 'bg-rug-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><MousePointer2 className="w-5 h-5" /><span className="text-xs">حرکت</span></button>
                </div>
                
                {(activeTool === 'brush' || activeTool === 'eraser') && (
                  <div className="mb-4 space-y-3 bg-gray-50 p-3 rounded border border-gray-100">
                     <div>
                       <div className="flex justify-between text-xs text-gray-500 mb-1"><span>اندازه قلم</span><span>{brushSize}</span></div>
                       <input type="range" min="1" max="10" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-full accent-rug-navy h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"/>
                     </div>
                     <div>
                       <div className="flex justify-between text-xs text-gray-500 mb-1"><span>شفافیت (Opacity)</span><span>{brushOpacity}%</span></div>
                       <input type="range" min="10" max="100" step="10" value={brushOpacity} onChange={(e) => setBrushOpacity(parseInt(e.target.value))} className="w-full accent-rug-navy h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"/>
                     </div>
                  </div>
                )}

                <div className="flex items-center gap-3 border-t pt-3">
                   <div className="w-8 h-8 rounded-full border border-gray-300 shadow-inner" style={{backgroundColor: brushColor}}></div>
                   <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="flex-1 h-8 cursor-pointer"/>
                </div>
             </div>
           </div>

           <div className={`w-full ${imageSrc ? 'lg:w-2/3' : 'lg:w-full'} print:w-full`} ref={printRef}>
              <div className="bg-white rounded-xl shadow-2xl overflow-hidden print:overflow-visible h-[80vh] min-h-[500px] print:h-auto print:min-h-0 flex flex-col relative rug-container print:shadow-none print:border-none">
                <div className="p-4 bg-rug-cream border-b border-rug-gold/20 flex justify-between items-center print:hidden">
                  <h3 className="font-bold text-rug-darkRed flex items-center gap-2"><Settings2 className="w-4 h-4" />نقشه فنی (خروجی)</h3>
                  <div className="flex items-center gap-4">
                     {gridConfig.usePalette && (<div className="text-xs font-bold text-rug-navy px-2 py-1 bg-blue-50 rounded border border-blue-100 hidden md:block">تعداد رنگ: {gridConfig.palette.length}</div>)}
                     <div className="text-xs text-gray-500 font-mono" dir="ltr">{gridConfig.cols}x{gridConfig.rows} Knots</div>
                  </div>
                </div>
                
                <div className="flex-1 p-4 overflow-auto print:overflow-visible flex justify-center bg-gray-50 print:p-0 print:bg-white touch-none print:block">
                  {imageSrc ? (
                    <GridCanvas 
                      pixels={pixels}
                      setPixels={setPixels}
                      config={gridConfig}
                      activeTool={activeTool}
                      brushColor={brushColor}
                      brushSize={brushSize}
                      brushOpacity={brushOpacity / 100}
                      onColorPick={handleColorPick}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-gray-400 h-full py-20">
                      <Upload className="w-16 h-16 mb-4 opacity-20" />
                      <p>لطفا یک تصویر بارگذاری کنید یا از هوش مصنوعی استفاده کنید</p>
                    </div>
                  )}
                </div>
              </div>
           </div>
        </div>
      </main>

      <footer className="bg-rug-darkRed text-rug-cream py-6 mt-auto border-t-4 border-rug-gold no-print">
         <div className="container mx-auto px-4 text-center">
            <p className="opacity-80 text-sm">طراحی شده برای هنر اصیل ایرانی</p>
         </div>
      </footer>
    </div>
  );
}