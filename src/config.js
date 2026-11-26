
import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  chatModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  embeddingModel: process.env.EMBEDDING_MODEL || 'gemini-embedding-001',
  companyName: process.env.COMPANY_NAME || 'NovaTech Solutions',
  agentName: process.env.AGENT_NAME || 'Aria',
};

export function hasValidKey() {
  return config.geminiApiKey && !config.geminiApiKey.includes('paste_your_key');
}
