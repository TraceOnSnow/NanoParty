import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GeminiAgentModel } from "../src/agent/geminiModel.ts";
import { defineTool } from "../src/agent/model.ts";
import { loadConfig } from "../src/config.ts";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("GeminiAgentModel", () => {
  it("runs tool calls, feeds results back and returns the final text", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: raw request bodies
    const requests: { url: string; headers: Record<string, string>; body: any }[] = [];
    const answers = [
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ functionCall: { name: "echo", args: { text: "hi" } }, thoughtSignature: "sig" }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
      },
      {
        candidates: [{ content: { role: "model", parts: [{ text: "想一下", thought: true }, { text: "好了" }] } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 3 },
      },
    ];
    const ran: unknown[] = [];
    const model = new GeminiAgentModel({
      apiKey: "secret-key",
      model: "gemini-test",
      fetch: (async (url: string, init: RequestInit) => {
        requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
        return reply(answers.shift());
      }) as typeof fetch,
    });
    const result = await model.run({
      system: "sys",
      prompt: "hello",
      signal: new AbortController().signal,
      tools: [
        defineTool({
          name: "echo",
          description: "echo",
          inputSchema: z.object({ text: z.string() }),
          run: async (input) => {
            ran.push(input);
            return "done";
          },
        }),
      ],
    });
    expect(result).toEqual({ text: "好了", inputTokens: 30, outputTokens: 5 });
    expect(ran).toEqual([{ text: "hi" }]);
    expect(requests[0]?.url).toContain("/models/gemini-test:generateContent");
    expect(requests[0]?.url).not.toContain("secret-key");
    expect(requests[0]?.headers["x-goog-api-key"]).toBe("secret-key");
    expect(requests[0]?.body.tools[0].functionDeclarations[0].parametersJsonSchema.properties.text.type).toBe("string");
    const second = requests[1]?.body.contents;
    expect(second[1].parts[0].thoughtSignature).toBe("sig"); // model turn echoed unchanged
    expect(second[2].parts[0].functionResponse).toEqual({ name: "echo", response: { result: "done" } });
  });

  it("reports bad tool input to the model and surfaces API errors", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: raw request bodies
    const bodies: any[] = [];
    const answers = [
      reply({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "echo", args: {} } }] } }] }),
      reply({ error: { message: "API key not valid" } }, 400),
    ];
    const model = new GeminiAgentModel({
      apiKey: "k",
      model: "m",
      fetch: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return answers.shift() as Response;
      }) as typeof fetch,
    });
    const tools = [
      defineTool({ name: "echo", description: "", inputSchema: z.object({ text: z.string() }), run: async () => "x" }),
    ];
    await expect(model.run({ system: "", prompt: "p", tools, signal: new AbortController().signal })).rejects.toThrow(
      "API key not valid",
    );
    expect(bodies[1].contents[2].parts[0].functionResponse.response.result).toContain("参数格式不对");
  });
});

describe("AI provider config", () => {
  const base = { ADMIN_PASSWORD: "password-1234" };
  it("picks Google when only its key is set and Anthropic otherwise", () => {
    const google = loadConfig({ ...base, GOOGLE_API_KEY: "g" }).ai;
    expect([google.provider, google.apiKey, google.model]).toEqual(["google", "g", "gemini-2.5-flash"]);
    expect(loadConfig({ ...base, GEMINI_API_KEY: "g2", AI_MODEL: "gemini-x" }).ai.model).toBe("gemini-x");
    const both = loadConfig({ ...base, GOOGLE_API_KEY: "g", ANTHROPIC_API_KEY: "a" }).ai;
    expect([both.provider, both.apiKey, both.model]).toEqual(["anthropic", "a", "claude-opus-5-5"]);
    expect(loadConfig({ ...base, GOOGLE_API_KEY: "g", ANTHROPIC_API_KEY: "a", AI_PROVIDER: "google" }).ai.apiKey).toBe(
      "g",
    );
    expect(loadConfig(base).ai.apiKey).toBeUndefined();
  });
});
