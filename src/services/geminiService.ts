import { GoogleGenAI, Type } from "@google/genai";

const apiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) || (process.env.GEMINI_API_KEY as string | undefined) || "";

function getGeminiClient(): GoogleGenAI | null {
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

export interface LocationData {
  latitude: number;
  longitude: number;
  altitude: number;
  summerDesignTemp: number;
  summerDesignHumidity: number;
  monsoonDesignTemp?: number;
  monsoonDesignHumidity?: number;
  winterDesignTemp: number;
  winterDesignHumidity: number;
}

export async function checkApiStatus(): Promise<{ status: 'ok' | 'error' | 'missing' | 'busy'; message: string }> {
  if (!apiKey) {
    return { status: 'missing', message: 'API Key not set (VITE_GEMINI_API_KEY)' };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return { status: 'missing', message: 'API Key not set (VITE_GEMINI_API_KEY)' };
  }

  try {
    // Perform a very small, cheap call to verify the key
    await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "hi",
      config: { maxOutputTokens: 1 }
    });
    return { status: 'ok', message: 'API Connected' };
  } catch (error: any) {
    console.error("API Status Check Failed:", error);
    const errorStr = JSON.stringify(error);
    
    if (error.message?.includes("API_KEY_INVALID")) {
      return { status: 'error', message: 'Invalid API Key' };
    }
    
    if (errorStr.includes("503") || errorStr.includes("high demand") || errorStr.includes("UNAVAILABLE")) {
      return { status: 'busy', message: 'API Busy (High Demand)' };
    }
    
    return { status: 'error', message: 'Connection Error' };
  }
}
export async function fetchLocationData(location: string): Promise<LocationData | null> {
  if (!apiKey) {
    // Key is optional in local/offline mode. Caller can fall back to saved/manual data.
    return null;
  }

  const ai = getGeminiClient();
  if (!ai) {
    return null;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `Provide geographical and HVAC design conditions (Summer, Monsoon & Winter) for the following location: "${location}". 
      Include:
      - Latitude & Longitude
      - Altitude (in feet)
      - Summer Design Dry Bulb Temperature (in °F)
      - Summer Design Relative Humidity (in %)
      - Monsoon Design Dry Bulb Temperature (in °F)
      - Monsoon Design Relative Humidity (in %)
      - Winter Design Dry Bulb Temperature (in °F)
      - Winter Design Relative Humidity (in %)
      Return the data in JSON format.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            latitude: { type: Type.NUMBER },
            longitude: { type: Type.NUMBER },
            altitude: { type: Type.NUMBER },
            summerDesignTemp: { type: Type.NUMBER },
            summerDesignHumidity: { type: Type.NUMBER },
            monsoonDesignTemp: { type: Type.NUMBER },
            monsoonDesignHumidity: { type: Type.NUMBER },
            winterDesignTemp: { type: Type.NUMBER },
            winterDesignHumidity: { type: Type.NUMBER },
          },
          required: [
            "latitude", "longitude", "altitude", 
            "summerDesignTemp", "summerDesignHumidity",
            "monsoonDesignTemp", "monsoonDesignHumidity",
            "winterDesignTemp", "winterDesignHumidity"
          ],
        },
      },
    });

    const text = response.text;
    if (!text) {
      console.error("Gemini returned an empty response.");
      return null;
    }

    // Clean the response text in case it contains markdown backticks
    const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    try {
      return JSON.parse(cleanJson) as LocationData;
    } catch (parseError) {
      console.error("Failed to parse Gemini JSON response:", text);
      return null;
    }
  } catch (error: any) {
    console.error("Error fetching location data from Gemini:", error);
    // Re-throw with more context if possible
    if (error.message?.includes("API_KEY_INVALID")) {
      throw new Error("Invalid API Key. Please verify your Gemini API key.");
    }
    throw error;
  }
}
