const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const LLM_MODEL = 'llama-3.3-70b-versatile';

export interface TranslationResult {
  index: number;
  ipa: string;
  vietnamese: string;
}

export class AITranslationService {
  /**
   * Dịch và tạo phiên âm IPA Mỹ hàng loạt cho danh sách các câu.
   * Xử lý tuần tự từng batch để tránh rate limit từ Groq API.
   */
  static async translateAndPhoneticsBatch(
    sentences: { index: number; text: string }[],
    apiKey: string,
    onProgress?: (msg: string) => void
  ): Promise<TranslationResult[]> {
    if (sentences.length === 0) return [];

    // Chia nhỏ danh sách câu thành các cụm 20 câu
    const batchSize = 20;
    const batches: { index: number; text: string }[][] = [];
    for (let i = 0; i < sentences.length; i += batchSize) {
      batches.push(sentences.slice(i, i + batchSize));
    }

    // Xử lý TUẦN TỰ từng batch để tránh rate limit
    const allResults: TranslationResult[] = [];
    for (let i = 0; i < batches.length; i++) {
      onProgress?.(`Đang dịch & phiên âm nhóm ${i + 1}/${batches.length}...`);
      const batchResults = await this.processBatchSafe(batches[i], apiKey);
      allResults.push(...batchResults);

      // Delay 500ms giữa các batch để tránh rate limit
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return allResults.sort((a, b) => a.index - b.index);
  }

  /**
   * Xử lý 1 batch — nếu lỗi (bao gồm rate limit 429) thì skip, không retry
   */
  private static async processBatchSafe(
    batch: { index: number; text: string }[],
    apiKey: string
  ): Promise<TranslationResult[]> {
    try {
      return await this.processBatch(batch, apiKey);
    } catch (error: any) {
      console.warn(`[AIService] Batch failed (skipping):`, error?.message || error);
      // Return empty results so we don't break the whole flow
      return batch.map(s => ({
        index: s.index,
        ipa: '',
        vietnamese: ''
      }));
    }
  }

  private static async processBatch(
    batch: { index: number; text: string }[],
    apiKey: string
  ): Promise<TranslationResult[]> {
    const formattedList = batch.map(s => `${s.index}: ${s.text}`).join('\n');

    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a professional linguistics assistant specializing in English phonology and translation. Translate the provided list of English sentences into natural Vietnamese and generate the highly accurate General American (US) IPA (International Phonetic Alphabet) transcription for each. Return a JSON object with key "results" which is an array of objects. Each object in the array must contain: "index" (number, corresponding to the 1-based index), "ipa" (string, General American IPA transcription starting/ending with /), and "vietnamese" (string, natural, accurate Vietnamese translation).'
          },
          {
            role: 'user',
            content: `List of English sentences:\n${formattedList}`
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[AIService] API error status:', response.status, errText);
      throw new Error(`Groq LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Groq LLM response was empty');
    }

    const parsed = JSON.parse(content);
    const results: TranslationResult[] = parsed.results || [];
    return results;
  }
}
