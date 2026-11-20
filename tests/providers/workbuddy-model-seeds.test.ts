import { describe, expect, test } from "bun:test";
import {
  WORKBUDDY_MODELS,
  WORKBUDDY_MODEL_CONTEXT_WINDOWS,
  WORKBUDDY_MODEL_INPUT_MODALITIES,
  WORKBUDDY_MODEL_MAX_OUTPUT_TOKENS,
  WORKBUDDY_NO_VISION_MODELS,
} from "../../src/providers/registry/workbuddy-seeds";
import { getProviderRegistryEntry } from "../../src/providers/registry";
import { enrichProviderFromRegistry, providerConfigSeed } from "../../src/providers/derive";
import { buildDshClientConfig } from "../../src/clients/config-export/dsh";
import { listManagementModelRows, toExportModel } from "../../src/server/management/model-rows";
import type { OcxConfig, OcxProviderConfig } from "../../src/types";

const DEEPSEEK = "deepseek-v4.1-flash";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

describe("workbuddy model seeds", () => {
  test("every roster model carries modalities, context and output limits", () => {
    for (const id of WORKBUDDY_MODELS) {
      expect(WORKBUDDY_MODEL_INPUT_MODALITIES[id]).toBeDefined();
      expect(WORKBUDDY_MODEL_CONTEXT_WINDOWS[id]).toBeGreaterThan(0);
      expect(WORKBUDDY_MODEL_MAX_OUTPUT_TOKENS[id]).toBeGreaterThan(0);
    }
  });

  test("noVisionModels is exactly the text-only modality rows", () => {
    const textOnly = WORKBUDDY_MODELS.filter(id => !WORKBUDDY_MODEL_INPUT_MODALITIES[id]!.includes("image"));
    expect([...WORKBUDDY_NO_VISION_MODELS].sort()).toEqual([...textOnly].sort());
  });

  test("deepseek-v4.1-flash and glm-5.3-flash are image-capable", () => {
    for (const id of ["deepseek-v4.1-flash", "glm-5.3-flash"]) {
      expect(WORKBUDDY_MODEL_INPUT_MODALITIES[id]).toEqual(["text", "image"]);
      expect(WORKBUDDY_NO_VISION_MODELS).not.toContain(id);
    }
  });

  test("the registry row publishes the seeds", () => {
    const entry = getProviderRegistryEntry("workbuddy");
    expect(entry?.models).toEqual([...WORKBUDDY_MODELS]);
    expect(entry?.modelInputModalities?.["deepseek-v4.1-flash"]).toEqual(["text", "image"]);
    expect(entry?.noVisionModels).toEqual([...WORKBUDDY_NO_VISION_MODELS]);
  });

  test("new and existing WorkBuddy providers inherit DeepSeek efforts without replacing overrides", () => {
    const entry = getProviderRegistryEntry("workbuddy")!;
    expect(providerConfigSeed(entry).modelReasoningEfforts?.[DEEPSEEK]).toEqual(EFFORTS);
    for (const override of [undefined, ["high"], []]) {
      const provider: OcxProviderConfig = {
        adapter: "workbuddy", baseUrl: entry.baseUrl, authMode: "oauth",
        ...(override ? { modelReasoningEfforts: { [DEEPSEEK]: override } } : {}),
      };
      enrichProviderFromRegistry("workbuddy", provider);
      expect(provider.modelReasoningEfforts?.[DEEPSEEK]).toEqual(override ?? EFFORTS);
    }
    expect(entry.modelReasoningEfforts?.["auto"]).toBeUndefined();
  });

  test("a supplied roster exports five DSH efforts on every refresh without provider config edits", async () => {
    const config: OcxConfig = {
      port: 10100, hostname: "127.0.0.1", defaultProvider: "workbuddy", fastRows: false,
      providers: { workbuddy: {
        adapter: "workbuddy", baseUrl: "https://copilot.tencent.com/v2", authMode: "oauth",
        models: [DEEPSEEK], liveModels: false,
      } },
    };
    const before = JSON.stringify(config);
    for (let refresh = 0; refresh < 2; refresh++) {
      const rows = await listManagementModelRows(config, { models: [{ id: DEEPSEEK, provider: "workbuddy" }] });
      const models = rows.map(toExportModel);
      const doc = buildDshClientConfig({ config, baseUrl: "http://127.0.0.1:10100/v1", models });
      const model = doc["llm-pi-ai"].providers.opencodex!.models.find(row => row.id === `workbuddy/${DEEPSEEK}`);
      expect(model?.reasoningEfforts).toEqual(Object.fromEntries(EFFORTS.map(effort => [effort, effort])));
    }
    expect(JSON.stringify(config)).toBe(before);
  });
});
