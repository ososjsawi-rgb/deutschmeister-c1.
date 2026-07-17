export const PROVIDERS = {
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-realtime-2.1", label: "GPT Realtime 2.1 · höchste Qualität" },
      { id: "gpt-realtime-2.1-mini", label: "GPT Realtime 2.1 mini · sparsam" },
    ],
    voices: [
      ["marin", "Marin · natürlich und klar"],
      ["cedar", "Cedar · ruhig und klar"],
      ["coral", "Coral · warm"],
      ["sage", "Sage · ausgewogen"],
      ["verse", "Verse · lebendig"],
      ["alloy", "Alloy · neutral"],
      ["ash", "Ash · tief"],
      ["ballad", "Ballad · weich"],
      ["echo", "Echo · kräftig"],
      ["shimmer", "Shimmer · hell"],
    ].map(([id, label]) => ({ id, label })),
  },
  google: {
    label: "Google Gemini",
    models: [
      { id: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live · Free Tier" },
      { id: "gemini-2.5-flash-native-audio-preview-12-2025", label: "Gemini 2.5 Native Audio · Alternative" },
    ],
    voices: [
      ["Kore", "Kore · stabil und klar"],
      ["Charon", "Charon · didaktisch"],
      ["Iapetus", "Iapetus · klar"],
      ["Schedar", "Schedar · ausgewogen"],
      ["Gacrux", "Gacrux · reif"],
      ["Puck", "Puck · lebendig"],
      ["Aoede", "Aoede · leicht"],
      ["Achird", "Achird · freundlich"],
      ["Sulafat", "Sulafat · warm"],
      ["Zephyr", "Zephyr · hell"],
    ].map(([id, label]) => ({ id, label })),
  },
};

const OPENAI_PRICING = {
  "gpt-realtime-2.1": {
    input: { text: 4, audio: 32, image: 5 },
    cached: { text: 0.4, audio: 0.4, image: 0.5 },
    output: { text: 24, audio: 64 },
  },
  "gpt-realtime-2.1-mini": {
    input: { text: 0.6, audio: 10, image: 0.8 },
    cached: { text: 0.06, audio: 0.3, image: 0.08 },
    output: { text: 2.4, audio: 20 },
  },
};

const GEMINI_PRICING = {
  "gemini-3.1-flash-live-preview": {
    input: { text: 0.75, audio: 3, image: 1, video: 1 },
    output: { text: 4.5, audio: 12 },
  },
  "gemini-2.5-flash-native-audio-preview-12-2025": {
    input: { text: 0.5, audio: 3, image: 3, video: 3 },
    output: { text: 2, audio: 12 },
  },
};

const perMillion = (tokens, rate) => (Number(tokens || 0) * rate) / 1_000_000;

export function calculateOpenAIResponseCost(modelId, usage = {}) {
  const rates = OPENAI_PRICING[modelId] || OPENAI_PRICING["gpt-realtime-2.1"];
  const input = usage.input_token_details || {};
  const cached = input.cached_tokens_details || {};
  const output = usage.output_token_details || {};
  let cost = 0;
  for (const modality of ["text", "audio", "image"]) {
    const total = Number(input[`${modality}_tokens`] || 0);
    const cachedTokens = Number(cached[`${modality}_tokens`] || 0);
    cost += perMillion(Math.max(0, total - cachedTokens), rates.input[modality]);
    cost += perMillion(cachedTokens, rates.cached[modality]);
  }
  cost += perMillion(output.text_tokens, rates.output.text);
  cost += perMillion(output.audio_tokens, rates.output.audio);
  return cost;
}

function modalityCounts(details = []) {
  const result = {};
  for (const detail of details || []) {
    const key = String(detail.modality || "text").toLowerCase();
    result[key] = (result[key] || 0) + Number(detail.tokenCount || detail.token_count || 0);
  }
  return result;
}

export function calculateGeminiPaidEquivalent(modelId, usage = {}) {
  const rates = GEMINI_PRICING[modelId] || GEMINI_PRICING["gemini-3.1-flash-live-preview"];
  const prompt = modalityCounts(usage.promptTokensDetails || usage.prompt_tokens_details);
  const response = modalityCounts(usage.responseTokensDetails || usage.response_tokens_details);
  let cost = 0;
  const promptTotal = Number(usage.promptTokenCount || usage.prompt_token_count || 0);
  const responseTotal = Number(usage.responseTokenCount || usage.response_token_count || 0);
  if (Object.keys(prompt).length === 0) prompt.text = promptTotal;
  if (Object.keys(response).length === 0) response.audio = responseTotal;
  for (const [modality, tokens] of Object.entries(prompt)) {
    cost += perMillion(tokens, rates.input[modality] ?? rates.input.text);
  }
  for (const [modality, tokens] of Object.entries(response)) {
    cost += perMillion(tokens, rates.output[modality] ?? rates.output.audio);
  }
  return cost;
}

export function normalizeUsage(usage = {}, provider = "openai") {
  if (provider === "google") {
    return {
      total: Number(usage.totalTokenCount || usage.total_token_count || 0),
      input: Number(usage.promptTokenCount || usage.prompt_token_count || 0),
      output: Number(usage.responseTokenCount || usage.response_token_count || 0),
    };
  }
  return {
    total: Number(usage.total_tokens || 0),
    input: Number(usage.input_tokens || 0),
    output: Number(usage.output_tokens || 0),
  };
}

export function defaultRuntimeSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("aspekte-runtime") || "{}");
    const provider = PROVIDERS[saved.provider] ? saved.provider : "openai";
    const providerConfig = PROVIDERS[provider];
    const model = providerConfig.models.some((item) => item.id === saved.model)
      ? saved.model : providerConfig.models[0].id;
    const voice = providerConfig.voices.some((item) => item.id === saved.voice)
      ? saved.voice : providerConfig.voices[0].id;
    return { provider, model, voice };
  } catch {
    return { provider: "openai", model: PROVIDERS.openai.models[0].id, voice: "marin" };
  }
}

export function saveRuntimeSettings(settings) {
  try { localStorage.setItem("aspekte-runtime", JSON.stringify(settings)); } catch {}
}
