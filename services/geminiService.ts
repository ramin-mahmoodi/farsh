import { GoogleGenAI } from "@google/genai";

// Initialize Gemini Client with prioritized key sourcing
const getClient = (userApiKey?: string) => {
    // 1. User provided key (from UI)
    if (userApiKey) {
        return new GoogleGenAI({ apiKey: userApiKey });
    }

    // 2. Environment variable (for standard deployment)
    try {
        if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
            return new GoogleGenAI({ apiKey: process.env.API_KEY });
        }
    } catch (e) {
        // Ignore in environments where process is undefined
    }
    
    // 3. Hardcoded fallback (Demo/Dev only)
    // Using the key provided in previous context to fix 403 errors for the user
    const fallbackKey = "AIzaSyDDnrjaywKBJTqa2M7bHgAjTWAXKzr2zdw";
    if (fallbackKey) {
       return new GoogleGenAI({ apiKey: fallbackKey });
    }

    throw new Error("API Key not found");
}

export const generateRugDesign = async (
    promptText: string, 
    aspectRatio: string = "3:4", 
    model: string = 'gemini-2.5-flash-image', 
    imageSize: string = '1K',
    apiKey?: string
): Promise<string | null> => {
  try {
    const ai = getClient(apiKey);
    
    // Construct config based on model
    const config: any = {
        imageConfig: {
            aspectRatio: aspectRatio,
        }
    };

    // 'gemini-3-pro-image-preview' (Nano Banana Pro) supports imageSize
    if (model === 'gemini-3-pro-image-preview') {
        config.imageConfig.imageSize = imageSize;
    }
    
    const response = await ai.models.generateContent({
      model: model,
      contents: [
        {
          text: `Generate a high quality image of a ${promptText}. The image should be flat, 2D, top-down view, suitable for a rug pattern.`,
        }
      ],
      config: config
    });

    if (response.candidates && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
           return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        }
      }
    }
    
    // Fallback if no image found in response parts
    console.warn("No image data found in Gemini response");
    return null;

  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};