
import { config } from './config.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Small helper: POST JSON to Gemini with automatic retry on rate-limit/overload.
async function callGemini(model, method, body, retries = 3) {
  const url = `${BASE_URL}/${model}:${method}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey, 
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return res.json();

    // 429 = free-tier rate limit, 500/503 = model overloaded -> wait and retry
    if ([429, 500, 503].includes(res.status) && attempt < retries) {
      const waitMs = 1500 * 2 ** attempt; 
      console.warn(`[gemini] ${res.status} - retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }
}


export async function generate(contents, { system, tools, jsonSchema, temperature = 0.6 } = {}) {
  const body = {
    contents,
    generationConfig: { temperature },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools) body.tools = [{ functionDeclarations: tools }];
  if (jsonSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = jsonSchema;
  }
  // Newer Gemini models "think" before answering. For a live voice call we
  // want low latency, so we keep thinking to the minimum.
  //   Gemini 2.5 -> thinkingBudget: 0      Gemini 3.x -> thinkingLevel: "minimal"
  if (config.chatModel.startsWith('gemini-2.5')) {
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  } else if (config.chatModel.startsWith('gemini-3')) {
    body.generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
  }

  let data;
  try {
    data = await callGemini(config.chatModel, 'generateContent', body);
  } catch (err) {
    // Some models don't support the "minimal" thinking setting -> retry with model defaults
    if (!/thinking/i.test(err.message) || !body.generationConfig.thinkingConfig) throw err;
    delete body.generationConfig.thinkingConfig;
    data = await callGemini(config.chatModel, 'generateContent', body);
  }
  const content = data.candidates?.[0]?.content;
  if (!content || !content.parts) {
    // Can happen if the response was blocked by safety filters
    return { role: 'model', parts: [{ text: "Sorry, could you please repeat that?" }] };
  }
  return content;
}

/** Turn many texts into vectors (used once, when indexing the knowledge base). */
export async function embedMany(texts) {
  const model = config.embeddingModel;
  const vectors = [];
  // Batch in groups of 50 to respect API limits
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    const data = await callGemini(model, 'batchEmbedContents', {
      requests: batch.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768,
      })),
    });
    vectors.push(...data.embeddings.map((e) => e.values));
  }
  return vectors;
}

/** Turn one user question into a vector (used on every RAG search). */
export async function embedQuery(text) {
  const data = await callGemini(config.embeddingModel, 'embedContent', {
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: 768,
  });
  return data.embedding.values;
}
