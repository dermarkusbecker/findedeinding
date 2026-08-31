import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export const CV_EXTRACTION_VERSION = '2026-08-31.1';

export async function extractDocumentText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const text = String(result.text || '').trim();
      return { text, method: text.length >= 80 ? 'pdf_text' : null, needsOcr: text.length < 80 };
    } finally { await parser.destroy(); }
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return { text: String(result.value || '').trim(), method: 'docx_text', needsOcr: false };
  }
  if (['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) return { text: '', method: null, needsOcr: true };
  throw Object.assign(new Error('Dieses Dateiformat wird nicht unterstützt.'), { status: 415 });
}
