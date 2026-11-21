import { createHash } from 'node:crypto';
import { validDate } from './domain.js';
import { recordGeminiUsage } from './hermes-usage.js';

export const MAX_MEDIA_BYTES = 14_000_000;
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
];
const AUDIO_RESULT_CACHE = new Map();
const AUDIO_CACHE_TTL_MS = 10 * 60 * 1000;
const IMAGE_FORMATS = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AUDIO_FORMATS = new Set([
  'audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg',
  'audio/flac', 'audio/mpeg', 'audio/m4a', 'audio/opus', 'audio/webm',
]);
const FORMATS = new Set([...IMAGE_FORMATS, ...AUDIO_FORMATS]);
const MIME_ALIASES = {
  'audio/x-m4a': 'audio/m4a',
  'audio/mp4': 'audio/m4a',
  'video/mp4': 'audio/m4a',
  'audio/mp4a-latm': 'audio/m4a',
  'audio/mp3': 'audio/mpeg',
  'audio/x-mpeg': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-pn-wav': 'audio/wav',
  'audio/x-aac': 'audio/aac',
  'audio/aacp': 'audio/aac',
  'audio/x-flac': 'audio/flac',
  'audio/x-aiff': 'audio/aiff',
  'application/ogg': 'audio/ogg',
  'audio/x-ogg': 'audio/ogg',
  'video/webm': 'audio/webm',
  'image/jpg': 'image/jpeg',
};
const EXT_MIME = {
  wav: 'audio/wav', mp3: 'audio/mpeg', aif: 'audio/aiff', aiff: 'audio/aiff',
  aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac',
  m4a: 'audio/m4a', mp4: 'audio/m4a', opus: 'audio/opus', webm: 'audio/webm',
  weba: 'audio/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

const fields = ['costumeName', 'size', 'customerName', 'phone', 'pickupDate', 'dueDate'];
const text = value => typeof value === 'string' ? value.trim().slice(0, 120) : '';
const stringSchema = { type: 'STRING', nullable: true };
const rentalProperties = Object.fromEntries(fields.map(name => [name, stringSchema]).concat([['priceCents', { type: 'INTEGER', nullable: true }]]));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date());

function normalizeBaseMime(value) {
  const base = String(value || '').split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[base] || base;
}

function detectMimeFromBase64(data) {
  if (typeof data !== 'string' || data.length < 8) return '';
  const head = Buffer.from(data.slice(0, 24).replace(/\s+/g, ''), 'base64');
  if (head.length < 4) return '';
  const ascii4 = head.subarray(0, 4).toString('latin1');
  const ascii8_12 = head.length >= 12 ? head.subarray(8, 12).toString('latin1') : '';
  if (ascii4 === 'RIFF' && ascii8_12 === 'WAVE') return 'audio/wav';
  if (ascii4 === 'RIFF' && ascii8_12 === 'WEBP') return 'image/webp';
  if (ascii4 === 'OggS') return 'audio/ogg';
  if (ascii4 === 'fLaC') return 'audio/flac';
  if (ascii4 === 'FORM' && (ascii8_12 === 'AIFF' || ascii8_12 === 'AIFC')) return 'audio/aiff';
  if (head.length >= 8 && head.subarray(4, 8).toString('latin1') === 'ftyp') return 'audio/m4a';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'audio/webm';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.subarray(0, 3).toString('latin1') === 'ID3') return 'audio/mpeg';
  if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return 'audio/aac';
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return '';
}

export function resolveMediaMime(mimeType, fileName = '', data = '') {
  const normalized = normalizeBaseMime(mimeType);
  const magic = detectMimeFromBase64(data);
  if (normalized === 'audio/opus' && magic === 'audio/ogg') return 'audio/ogg';
  if (FORMATS.has(normalized)) return normalized;
  if (magic && FORMATS.has(magic)) return magic;
  const ext = String(fileName || '').trim().toLowerCase().split('.').pop();
  if (ext && EXT_MIME[ext]) return EXT_MIME[ext];
  return normalized;
}

export function getGeminiModelCandidates(env = process.env) {
  const primary = (env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const configuredFallbacks = env.GEMINI_FALLBACK_MODELS
    ? env.GEMINI_FALLBACK_MODELS.split(',').map(m => m.trim()).filter(Boolean)
    : DEFAULT_FALLBACK_MODELS;
  return [...new Set([primary, ...configuredFallbacks])];
}

function makeGeminiError(status, detail = '') {
  if (status === 429) {
    return Object.assign(
      new Error('Limite de uso da API Gemini atingido no momento. Aguarde alguns instantes ou ajuste GEMINI_MODEL no .env.'),
      { httpStatus: 429, detail },
    );
  }
  if (status === 503 || status === 504 || status === 'TIMEOUT') {
    return Object.assign(
      new Error('O serviço Gemini está sobrecarregado ou demorou demais. Tente novamente em instantes.'),
      { httpStatus: 503, detail },
    );
  }
  if (status === 401 || status === 403) {
    return Object.assign(
      new Error('Chave ou permissão do Gemini recusada. Confira GEMINI_API_KEY no .env.'),
      { httpStatus: 502, detail },
    );
  }
  return Object.assign(new Error(`Gemini indisponível (${status})`), { httpStatus: 502, detail });
}

function stripCodeFences(raw) {
  return typeof raw === 'string' ? raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : '';
}

function parseCandidateJson(result) {
  const parts = result?.candidates?.[0]?.content?.parts || [];
  const ordered = [
    ...parts.filter(part => typeof part?.text === 'string' && !part.thought),
    ...parts.filter(part => typeof part?.text === 'string' && part.thought),
  ];
  for (const part of ordered) {
    try {
      const parsed = JSON.parse(stripCodeFences(part.text));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  throw Object.assign(new Error('Gemini não retornou dados legíveis'), { httpStatus: 502 });
}

export async function callGeminiJson({ apiKey, contents, schema, task = 'fantasia-mvp', fetchImpl = fetch, timeoutMs = 10_000, env = process.env, maxOutputTokens = 2048, onAttempt }) {
  if (!apiKey) throw Object.assign(new Error('Gemini não configurado'), { httpStatus: 503 });
  const models = getGeminiModelCandidates(env);
  let lastStatus = 502;
  let lastDetail = '';

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const supportsThinkingLevel = /^gemini-(3|4)/.test(model);
    let useThinkingConfig = supportsThinkingLevel;
    const maxAttempts = 1;

    for (let attempt = 0; attempt < maxAttempts + 1; attempt++) {
      const generationConfig = {
        temperature: 0,
        maxOutputTokens,
        responseMimeType: 'application/json',
        ...(schema ? { responseSchema: schema } : {}),
        ...(useThinkingConfig ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}),
      };
      let response;
      const started = Date.now();
      const report = (status, usage) => onAttempt?.({ model, task, status, durationMs: Date.now() - started, apiKey, usage });
      try {
        response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ contents, generationConfig }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastStatus = error?.name === 'TimeoutError' ? 'TIMEOUT' : 503;
        lastDetail = error?.message || 'Erro de rede';
        report(String(lastStatus));
        if (i < models.length - 1) console.warn(`[gemini] modelo ${model} falhou (${lastStatus}), tentando próximo.`);
        break;
      }

      if (response.ok) {
        const result = await response.json();
        recordGeminiUsage(model, result.usageMetadata, task);
        let parsed;
        try { parsed = parseCandidateJson(result); } catch (error) { report('invalid_response', result.usageMetadata); throw error; }
        report('ok', result.usageMetadata);
        const meta = result.usageMetadata || {};
        const details = Array.isArray(meta.promptTokensDetails) ? meta.promptTokensDetails : [];
        const audioTokens = details.find(d => d?.modality === 'AUDIO')?.tokenCount || 0;
        const textTokens = details.find(d => d?.modality === 'TEXT')?.tokenCount || 0;
        Object.defineProperty(parsed, '_usage', {
          value: {
            model,
            inputTokens: meta.promptTokenCount || 0,
            audioTokens,
            textTokens,
            outputTokens: meta.candidatesTokenCount || 0,
            reasoningTokens: meta.thoughtsTokenCount || 0,
            totalTokens: meta.totalTokenCount ?? (Number.isFinite(meta.promptTokenCount) && Number.isFinite(meta.candidatesTokenCount) ? meta.promptTokenCount + meta.candidatesTokenCount + (meta.thoughtsTokenCount || 0) : null),
          },
          enumerable: false,
        });
        return parsed;
      }

      const rawError = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
      lastStatus = response.status;
      report(String(response.status));
      lastDetail = rawError.slice(0, 240);

      if (response.status === 400 && useThinkingConfig && /thinking/i.test(rawError)) {
        useThinkingConfig = false;
        continue;
      }
      if ([404, 429, 500, 503, 504].includes(response.status)) {
        if (i < models.length - 1) console.warn(`[gemini] modelo ${model} retornou ${response.status}, tentando próximo.`);
        break;
      }
      throw makeGeminiError(response.status, lastDetail);
    }
  }
  throw makeGeminiError(lastStatus, lastDetail);
}

async function transcribeWithDedicatedModel({ mimeType, data, apiKey, fetchImpl = fetch, timeoutMs = 10_000, onAttempt }) {
  const model = 'gemini-3.5-transcribe';
  const started = Date.now();
  let status = 'failed', usage;
  try {
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Transcreva em pt-BR.' }, { inlineData: { mimeType, data } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) { status = String(response.status); throw makeGeminiError(response.status); }
  const result = await response.json();
  recordGeminiUsage(model, result.usageMetadata, 'audio-transcribe');
  usage = result.usageMetadata;
  const parts = result?.candidates?.[0]?.content?.parts || [];
  const transcript = parts.find(p => typeof p?.audioTranscription?.text === 'string')?.audioTranscription?.text
    ?? parts.find(p => typeof p?.text === 'string' && !p.thought)?.text;
  if (typeof transcript !== 'string' || !transcript.trim()) throw Object.assign(new Error('Gemini não retornou transcrição legível'), { httpStatus: 502 });
  status = 'ok';
  return transcript.trim();
  } finally { onAttempt?.({ model, task: 'audio-transcribe', status, apiKey, usage, durationMs: Date.now() - started }); }
}

async function generateJson({ mimeType, fileName = '', data, apiKey, fetchImpl = fetch, onAttempt, env }, prompt, schema, task = 'fantasia-mvp') {
  const cleanData = typeof data === 'string' ? data.replace(/\s+/g, '') : '';
  const resolvedMime = resolveMediaMime(mimeType, fileName, cleanData);
  const byteLength = cleanData && /^[A-Za-z0-9+/]+={0,2}$/.test(cleanData) ? Buffer.byteLength(cleanData, 'base64') : 0;
  if (!FORMATS.has(resolvedMime) || byteLength === 0 || byteLength > MAX_MEDIA_BYTES) {
    throw Object.assign(new Error('Formato de mídia inválido ou arquivo maior que 14 MB'), { httpStatus: 422 });
  }
  return callGeminiJson({
    apiKey,
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: resolvedMime, data: cleanData } }] }],
    schema,
    task,
    fetchImpl, onAttempt, env,
  });
}

function rentalDraft(parsed) {
  const draft = { ...Object.fromEntries(fields.map(name => [name, text(parsed[name])])), priceCents: Number.isSafeInteger(parsed.priceCents) && parsed.priceCents >= 0 ? parsed.priceCents : null };
  for (const key of ['pickupDate', 'dueDate']) if (!validDate(draft[key])) draft[key] = '';
  if (draft.pickupDate && draft.dueDate && draft.dueDate < draft.pickupDate) draft.dueDate = '';
  return draft;
}

export async function extractRentalDraft(options) {
  const prompt = `Extraia aluguel de fantasia. Não invente dados (ausentes/ambíguos=null). Datas AAAA-MM-DD, telefone só dígitos, priceCents inteiro. Hoje: ${today()}.`;
  return rentalDraft(await generateJson(options, prompt, { type: 'OBJECT', properties: rentalProperties, required: [...fields, 'priceCents'] }, 'rental-draft'));
}

export async function extractAudioBatch(options) {
  const { kind } = options;
  if (!['costumes', 'rentals'].includes(kind)) throw Object.assign(new Error('Tipo de importação inválido'), { httpStatus: 422 });
  const cleanData = typeof options.data === 'string' ? options.data.replace(/\s+/g, '') : '';
  const resolvedMime = resolveMediaMime(options.mimeType, options.fileName, cleanData);
  if (!AUDIO_FORMATS.has(resolvedMime)) throw Object.assign(new Error('Formato inválido: envie um arquivo de áudio (OGG, Opus, MP3, M4A, MP4, WebM, WAV, AAC ou FLAC).'), { httpStatus: 422 });

  const useCache = options.cache !== false && (!options.fetchImpl || options.fetchImpl === fetch) && cleanData.length > 32;
  const cacheKey = useCache ? createHash('sha256').update(`${kind}:${today()}:${options.apiKey}:${getGeminiModelCandidates(options.env).join(',')}:${cleanData}`).digest('hex') : '';
  if (cacheKey) {
    const cached = AUDIO_RESULT_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < AUDIO_CACHE_TTL_MS) {
      const cloned = structuredClone(cached.value);
      if (cloned.usage) cloned.usage = { ...cloned.usage, cached: true, totalTokens: 0 };
      return cloned;
    }
  }

  const itemShape = kind === 'costumes'
    ? '{"name":string|null,"size":string|null,"quantity":int|null,"notes":string|null}'
    : '{"costumeName":string|null,"size":string|null,"customerName":string|null,"phone":string|null,"pickupDate":"AAAA-MM-DD"|null,"dueDate":"AAAA-MM-DD"|null,"priceCents":int|null,"notes":string|null}';
  const rules = kind === 'costumes'
    ? 'Acervo: 1 item por fantasia+tamanho; quantity=unidades a somar (null se omitida/ambígua).'
    : 'Aluguéis: mantenha identificador no customerName (ex: Augusto da Unicesumar); R$150=15000; Datas AAAA-MM-DD (ano omitido=ano atual com aviso em notes).';
  const prompt = `Transcreva em pt-BR (transcript) e extraia TODOS os itens na ordem falada. Retorne SÓ JSON {"transcript":string,"items":[${itemShape}]}. Não invente dados (use null). Correções/dúvidas em notes (vale a correção final). Máx 50 itens. Hoje: ${today()}. ${rules}`;

  let parsed;
  try {
    parsed = await generateJson({ ...options, mimeType: resolvedMime, data: cleanData }, prompt, null, `audio-batch-${kind}`);
  } catch (error) {
    if (error?.httpStatus !== 503) throw error;
    try {
      console.warn('[gemini] tentando fallback de transcrição em duas etapas com gemini-3.5-transcribe.');
      const transcript = await transcribeWithDedicatedModel({ mimeType: resolvedMime, data: cleanData, apiKey: options.apiKey, fetchImpl: options.fetchImpl, onAttempt: options.onAttempt });
      parsed = await callGeminiJson({
        apiKey: options.apiKey,
        contents: [{ parts: [{ text: `Extraia JSON {"transcript":string,"items":[${itemShape}]}. Não invente dados (null). Hoje: ${today()}. ${rules}\nTexto: ${transcript}` }] }],
        schema: null,
        task: `audio-batch-${kind}-struct`,
        fetchImpl: options.fetchImpl, onAttempt: options.onAttempt, env: options.env,
        timeoutMs: 8_000,
      });
      if (!parsed.transcript) parsed.transcript = transcript;
    } catch {
      throw error;
    }
  }
  if (typeof parsed.transcript !== 'string' || !Array.isArray(parsed.items) || parsed.items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw Object.assign(new Error('Gemini não retornou dados legíveis'), { httpStatus: 502 });
  if (parsed.items.length > 50) throw Object.assign(new Error('Divida o áudio em até 50 registros por vez'), { httpStatus: 422 });
  if (parsed.transcript.length > 20000) throw Object.assign(new Error('Divida o áudio em trechos menores'), { httpStatus: 422 });
  const output = {
    transcript: parsed.transcript,
    items: parsed.items.map(item => ({
      ...(kind === 'rentals' ? rentalDraft(item) : { name: text(item.name), size: text(item.size), quantity: Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : null }),
      notes: text(item.notes),
    })),
    ...(parsed._usage ? { usage: parsed._usage } : {}),
  };
  if (cacheKey) {
    if (AUDIO_RESULT_CACHE.size >= 20) {
      const oldestKey = AUDIO_RESULT_CACHE.keys().next().value;
      if (oldestKey) AUDIO_RESULT_CACHE.delete(oldestKey);
    }
    AUDIO_RESULT_CACHE.set(cacheKey, { at: Date.now(), value: structuredClone(output) });
  }
  return output;
}
