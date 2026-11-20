import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAudioBatch, resolveMediaMime, MAX_MEDIA_BYTES } from '../src/gemini.js';

const audio = { mimeType: 'audio/webm;codecs=opus', data: 'ZmFrZQ==', apiKey: 'teste' };
const response = value => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }) });

test('separa os dois aluguéis e mantém telefone ausente para revisão', async () => {
  const result = await extractAudioBatch({ ...audio, kind: 'rentals', fetchImpl: response({
    transcript: 'Aluguei Homem Aranha PP para Edvalda por 150 e Gato de Botas GG para Augusto da Unicesumar por 300.',
    items: [
      { costumeName: 'Homem Aranha', size: 'PP', customerName: 'Edvalda', pickupDate: '2026-11-19', dueDate: '2026-11-21', priceCents: 15000 },
      { costumeName: 'Gato de Botas', size: 'GG', customerName: 'Augusto da Unicesumar', pickupDate: '2026-11-20', dueDate: '2026-11-27', priceCents: 30000 },
    ],
  }) });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].priceCents, 15000);
  assert.equal(result.items[1].customerName, 'Augusto da Unicesumar');
  assert.equal(result.items[0].phone, '');
  assert.equal(result.items[1].dueDate, '2026-11-27');
  assert.match(result.transcript, /Edvalda/);
});

test('acervo mantém quantidades por tamanho e não inventa campos', async () => {
  const result = await extractAudioBatch({ ...audio, kind: 'costumes', fetchImpl: response({ transcript: 'Tenho duas bruxas M e um pirata.', items: [
    { name: 'Bruxa', size: 'M', quantity: 2 }, { name: 'Pirata', size: null, quantity: 1 }, { name: 'Fada', size: 'P', quantity: -1 },
  ] }) });
  assert.deepEqual(result.items.map(i => [i.name, i.size, i.quantity]), [['Bruxa', 'M', 2], ['Pirata', '', 1], ['Fada', 'P', null]]);
});

test('recusa lote truncado, modalidade inválida e mídia não sonora', async () => {
  await assert.rejects(extractAudioBatch({ ...audio, kind: 'other' }), /Tipo/);
  await assert.rejects(extractAudioBatch({ ...audio, kind: 'costumes', mimeType: 'image/png' }), /áudio/);
  await assert.rejects(extractAudioBatch({ ...audio, kind: 'costumes', fetchImpl: response({ transcript: 'texto', items: Array(51).fill({ name: 'Pirata' }) }) }), /50/);
  await assert.rejects(extractAudioBatch({ ...audio, kind: 'costumes', fetchImpl: response({ transcript: 'texto', items: [null] }) }), /legíveis/);
});

test('resolve MIME vazio ou variante por extensão e magic bytes para formatos reais de áudio', () => {
  const wav = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1').toString('base64');
  const ogg = Buffer.from('OggS\x00\x02\x00\x00\x00\x00\x00\x00', 'latin1').toString('base64');
  const m4a = Buffer.from('\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00', 'latin1').toString('base64');
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]).toString('base64');
  const flac = Buffer.from('fLaC\x00\x00\x00\x22', 'latin1').toString('base64');

  assert.equal(resolveMediaMime('audio/x-m4a', '', m4a), 'audio/m4a');
  assert.equal(resolveMediaMime('audio/mp4', 'gravacao.m4a', m4a), 'audio/m4a');
  assert.equal(resolveMediaMime('', 'nota-whatsapp.opus', ogg), 'audio/ogg');
  assert.equal(resolveMediaMime('', 'nota-whatsapp.opus', 'ZmFrZQ=='), 'audio/opus');
  assert.equal(resolveMediaMime('', 'voz.wav', wav), 'audio/wav');
  assert.equal(resolveMediaMime('application/octet-stream', 'sem-extensao', wav), 'audio/wav');
  assert.equal(resolveMediaMime('', 'sem-extensao', webm), 'audio/webm');
  assert.equal(resolveMediaMime('', 'sem-extensao', flac), 'audio/flac');
  assert.equal(resolveMediaMime('audio/x-aac', 'nota.aac', 'ZmFrZQ=='), 'audio/aac');
});

test('aceita áudio WAV de 40s (~7,7 MB) com folga e recusa acima de 14 MB ou vazio', async () => {
  assert.equal(MAX_MEDIA_BYTES, 14_000_000);
  const wavHeader = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1');
  const sevenPointSevenMb = Buffer.concat([wavHeader, Buffer.alloc(7_700_000 - wavHeader.length)]).toString('base64');
  let sentMime;
  const result = await extractAudioBatch({
    kind: 'costumes',
    mimeType: '',
    fileName: 'gravacao-40s.wav',
    data: sevenPointSevenMb,
    apiKey: 'teste',
    fetchImpl: async (_url, options) => {
      sentMime = JSON.parse(options.body).contents[0].parts[1].inlineData.mimeType;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ thought: true, text: 'pensando' }, { text: JSON.stringify({ transcript: 'Duas bruxas M', items: [{ name: 'Bruxa', size: 'M', quantity: 2, notes: null }] }) }] } }] }) };
    },
  });
  assert.equal(sentMime, 'audio/wav');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'Bruxa');

  const tooBig = Buffer.alloc(MAX_MEDIA_BYTES + 128).toString('base64');
  await assert.rejects(extractAudioBatch({ ...audio, kind: 'costumes', data: tooBig }), /14 MB/);
  await assert.rejects(extractAudioBatch({ ...audio, kind: 'costumes', data: '' }), /Formato/);
});

test('faz fallback de modelo Gemini em 429/503 e preserva erro tipado quando todos falham', async () => {
  const tried = [];
  const result = await extractAudioBatch({
    ...audio,
    kind: 'costumes',
    fetchImpl: async (url, options) => {
      tried.push({ url, body: JSON.parse(options.body) });
      if (tried.length === 1) return { ok: false, status: 429, text: async () => '{"error":{"message":"Quota exceeded"}}' };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript: 'Pirata M', items: [{ name: 'Pirata', size: 'M', quantity: 1, notes: null }] }) }] } }] }) };
    },
  });
  assert.equal(tried.length, 2);
  assert.notEqual(tried[0].url, tried[1].url);
  assert.equal(tried[0].body.generationConfig.thinkingConfig?.thinkingLevel, 'minimal');
  assert.equal(tried[0].body.generationConfig.temperature, 0);
  assert.equal(tried[0].body.generationConfig.maxOutputTokens, 2048);
  assert.equal(result.items[0].name, 'Pirata');

  await assert.rejects(
    extractAudioBatch({ ...audio, kind: 'costumes', fetchImpl: async () => ({ ok: false, status: 429, text: async () => '{"error":{"message":"Quota exceeded"}}' }) }),
    err => err.httpStatus === 429 && /Limite/i.test(err.message),
  );
});

test('recupera sobrecarga multimodal usando fallback em duas etapas com gemini-3.5-transcribe', async () => {
  const urls = [];
  const result = await extractAudioBatch({
    ...audio,
    kind: 'rentals',
    fetchImpl: async (url, options) => {
      urls.push(url);
      if (url.includes('gemini-3.5-transcribe')) {
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ audioTranscription: { text: 'Aluguel de Pirata M para Marina Teste por 150 reais.' } }] } }] }) };
      }
      if (options.body.includes('inlineData')) {
        return { ok: false, status: 503, text: async () => '{"error":{"message":"High demand"}}' };
      }
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript: 'Aluguel de Pirata M para Marina Teste por 150 reais.', items: [{ costumeName: 'Pirata', size: 'M', customerName: 'Marina Teste', phone: null, pickupDate: '2026-11-20', dueDate: '2026-11-22', priceCents: 15000, notes: null }] }) }] } }] }) };
    },
  });
  assert.ok(urls.some(u => u.includes('gemini-3.5-transcribe')));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].customerName, 'Marina Teste');
  assert.equal(result.items[0].priceCents, 15000);
});
