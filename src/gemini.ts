import Constants from 'expo-constants';

export type GeminiSection = {
  title: 'Directions' | 'Active ingredients' | 'Inactive ingredients' | 'Warnings' | 'Uses' | 'Storage' | 'Other label information';
  content: string;
};

const apiKey = Constants.expoConfig?.extra?.geminiApiKey || process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const model = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-2.5-flash';
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const translationModel = process.env.EXPO_PUBLIC_GEMINI_TRANSLATION_MODEL || 'gemini-2.5-flash-lite';
const translationEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${translationModel}:generateContent`;
const visionModel = process.env.EXPO_PUBLIC_GEMINI_OCR_MODEL || model;
const visionEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${visionModel}:generateContent`;

export const isGeminiConfigured = Boolean(apiKey);

async function generateJSON<T>(prompt: string, schema: object, requestEndpoint = endpoint, fast = false): Promise<T> {
  if (!apiKey) throw new Error('Gemini API key is not configured');

  const response = await fetch(requestEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: fast ? 0 : 0.1,
        responseMimeType: 'application/json',
        responseSchema: schema,
        ...(fast ? { maxOutputTokens: 64, thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('');
  if (!text) throw new Error('Gemini returned no content');
  return JSON.parse(text) as T;
}

async function generateImageJSON<T>(prompt: string, imageBase64: string, mimeType: string, schema: object): Promise<T> {
  if (!apiKey) throw new Error('Gemini API key is not configured');
  const response = await fetch(visionEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini image request failed (${response.status}): ${body.slice(0, 200)}`);
  }
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('');
  if (!text) throw new Error('Gemini returned no image analysis');
  return JSON.parse(text) as T;
}

export async function analyzeMedicineLabel(labelText: string): Promise<GeminiSection[]> {
  const result = await generateJSON<{ sections: GeminiSection[] }>(
    `You organize OCR text from a medicine package for accessibility.

Rules:
- Use only facts explicitly present in the OCR text. Never invent, infer, or recommend a dose.
- Preserve every number, unit, age, interval, temperature, contraindication, and negation exactly.
- Correct obvious OCR spacing only when unambiguous.
- Put content into the allowed section titles. Omit empty sections.
- Keep warnings prominent and concise, but do not weaken their meaning.
- Content should be easy to scan in a large-font mobile interface.
- Put one distinct fact, instruction, ingredient, dose, or warning on each newline. Do not combine unrelated facts into a paragraph.
- Start a line with a concise label followed by a colon when the OCR provides a natural label (for example, "Adults:" or "Storage:").
- Do not include Markdown bullets or formatting characters; the app formats each line accessibly.

OCR label text:
${labelText.slice(0, 12000)}`,
    {
      type: 'OBJECT',
      properties: {
        sections: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              title: {
                type: 'STRING',
                enum: ['Directions', 'Active ingredients', 'Inactive ingredients', 'Warnings', 'Uses', 'Storage', 'Other label information'],
              },
              content: { type: 'STRING' },
            },
            required: ['title', 'content'],
          },
        },
      },
      required: ['sections'],
    },
  );
  return result.sections.filter((section) => section.content.trim().length > 0);
}

export async function translateMedicineWord(word: string, targetLanguage = 'Korean'): Promise<string> {
  const result = await generateJSON<{ translation: string }>(
    `Translate the English medicine-label word or short phrase below into natural ${targetLanguage}.
Return only its context-appropriate ${targetLanguage} equivalent. Do not add medical advice.

Text: ${word}`,
    {
      type: 'OBJECT',
      properties: { translation: { type: 'STRING' } },
      required: ['translation'],
    },
    translationEndpoint,
    true,
  );
  return result.translation;
}

export async function recognizeAndTranslateHighlightedWord(
  imageBase64: string,
  ocrHint: string,
  labelContext: string,
  targetLanguage?: string,
): Promise<{ sourceText: string; translation: string; boundingBox: { x: number; y: number; width: number; height: number }; contours: Array<{ points: Array<{ x: number; y: number }> }> }> {
  return generateImageJSON<{ sourceText: string; translation: string; boundingBox: { x: number; y: number; width: number; height: number }; contours: Array<{ points: Array<{ x: number; y: number }> }> }>(
    `This image is a tight crop around a single word that a user highlighted on a medicine label.
Read the English word directly underneath the center of the highlighted region.
${targetLanguage ? `Translate it into natural ${targetLanguage}.` : 'Translation is disabled, so return an empty string for translation.'}

Rules:
- Trust the pixels over the OCR hint.
- If neighboring words are visible, choose only the word closest to the crop center.
- Return boundingBox around the complete chosen word only. Include the full outer edges of the first and last letters, attached punctuation, ascenders, and descenders; do not crop any glyph.
- Leave a very small safety margin around the chosen word, but do not include any part of neighboring words.
- Express boundingBox x, y, width, and height as integers in a 0-to-1000 coordinate system relative to the crop.
- Semantically segment the visible ink belonging to the chosen word. Return simplified polygon contours around its letters and attached punctuation, excluding background and neighboring text.
- Return each contour as points in clockwise order. Express every contour x and y as integers from 0 to 1000 relative to the entire crop. Keep enough points to follow the text shape, but use no more than 120 points total.
- Preserve numbers, units, punctuation, and capitalization in sourceText.
- ${targetLanguage ? `Return a concise, context-appropriate ${targetLanguage} equivalent without medical advice.` : 'Do not translate; translation must be an empty string.'}

Possible OCR hint: ${ocrHint}
Nearby medicine-label context: ${labelContext.slice(0, 3000)}`,
    imageBase64,
    'image/jpeg',
    {
      type: 'OBJECT',
      properties: {
        sourceText: { type: 'STRING' },
        translation: { type: 'STRING' },
        boundingBox: {
          type: 'OBJECT',
          properties: {
            x: { type: 'INTEGER' },
            y: { type: 'INTEGER' },
            width: { type: 'INTEGER' },
            height: { type: 'INTEGER' },
          },
          required: ['x', 'y', 'width', 'height'],
        },
        contours: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              points: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    x: { type: 'INTEGER' },
                    y: { type: 'INTEGER' },
                  },
                  required: ['x', 'y'],
                },
              },
            },
            required: ['points'],
          },
        },
      },
      required: ['sourceText', 'translation', 'boundingBox', 'contours'],
    },
  );
}

export async function translateMedicineWords(
  words: Array<{ id: string; text: string }>,
  labelText: string,
): Promise<Array<{ id: string; translation: string }>> {
  if (words.length === 0) return [];

  const result = await generateJSON<{ translations: Array<{ id: string; translation: string }> }>(
    `Translate each English medicine-label word into a concise, context-appropriate Korean equivalent.
Use the complete OCR label only to disambiguate meaning. Preserve the supplied id exactly, include every item once, and do not add medical advice.

Complete label context:
${labelText.slice(0, 10000)}

Words:
${JSON.stringify(words)}`,
    {
      type: 'OBJECT',
      properties: {
        translations: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              translation: { type: 'STRING' },
            },
            required: ['id', 'translation'],
          },
        },
      },
      required: ['translations'],
    },
  );
  return result.translations;
}

export type TranslatedSummarySection = {
  sourceTitle: string;
  title: string;
  content: string;
};

export async function translateMedicineSummary(
  sections: Array<{ title: string; content: string }>,
  targetLanguage = 'Korean',
): Promise<TranslatedSummarySection[]> {
  const result = await generateJSON<{ sections: TranslatedSummarySection[] }>(
    `Translate this complete medicine-label transcription into clear, natural ${targetLanguage} for accessibility.

Rules:
- This is a transcription, not a summary. Translate every line and every word without condensing, paraphrasing away, combining, or omitting content.
- Translate every section without adding or inferring medical advice.
- Preserve every number, dose, unit, age, interval, temperature, warning, contraindication, and negation exactly.
- Preserve the original section title in sourceTitle exactly so the app can match sections.
- Preserve the original line breaks and repeated wording, even when it appears redundant.

Complete transcription:
${JSON.stringify(sections)}`,
    {
      type: 'OBJECT',
      properties: {
        sections: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              sourceTitle: { type: 'STRING' },
              title: { type: 'STRING' },
              content: { type: 'STRING' },
            },
            required: ['sourceTitle', 'title', 'content'],
          },
        },
      },
      required: ['sections'],
    },
  );
  return result.sections;
}
