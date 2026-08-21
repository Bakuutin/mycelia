const port = Number(Deno.env.get("PORT") ?? "8090");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function vectorForText(value: string): number[] {
  const vector = Array.from({ length: 16 }, () => 0);
  for (const [index, symbol] of [...value.toLowerCase()].entries()) {
    vector[index % vector.length] += symbol.codePointAt(0) ?? 0;
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return vector.map((item) => norm ? item / norm : 0);
}

Deno.serve({ hostname: "0.0.0.0", port }, async (request) => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ status: "ok" });
  }
  if (request.method === "GET" && url.pathname === "/v1/capabilities") {
    return json({
      schemaVersion: "v1",
      features: ["visual-understanding", "ocr", "labels", "objects"],
      provider: { service: "mycelia-media-contract-mock", version: "1" },
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/media/analyze") {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "multipart form data is required" }, 400);
    }
    const file = form.get("file");
    const requestId = String(form.get("request_id") ?? "");
    if (!(file instanceof File) || file.size === 0 || !requestId) {
      return json({ error: "file and request_id are required" }, 400);
    }
    let features: string[] = [];
    try {
      const parsed = JSON.parse(String(form.get("features") ?? "[]"));
      features = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return json({ error: "features must be a JSON array" }, 400);
    }
    console.log(
      JSON.stringify({ requestId, receivedBytes: file.size, features }),
    );
    const visualUnderstanding = {
      shortCaption: "Тестовое изображение Mycelia с крупной надписью",
      description:
        "Синтетическое тестовое изображение с контрастной крупной надписью MYCELIA CLOUD VISION 2026 на простом фоне.",
      scene: {
        summary: "Графический тестовый кадр",
        environment: "unknown",
        placeType: "тестовое изображение",
        timeOfDay: "unknown",
        confidence: 0.99,
      },
      objects: [{
        name: "текстовая надпись",
        count: 1,
        attributes: ["крупная", "контрастная"],
        confidence: 0.99,
      }],
      activities: [],
      peopleCount: 0,
      keywords: ["Mycelia", "тест", "надпись", "облако"],
      possibleEvent: null,
      confidence: 0.99,
      warnings: ["Результат создан локальным контрактным mock-провайдером"],
    };
    const searchText = [
      visualUnderstanding.shortCaption,
      visualUnderstanding.description,
      visualUnderstanding.scene.summary,
      ...visualUnderstanding.keywords,
    ].join("\n");
    return json({
      pages: features.includes("ocr")
        ? [{
          pageNumber: 1,
          text: "MYCELIA CLOUD VISION 2026",
          width: 1600,
          height: 900,
          blocks: [{
            text: "MYCELIA CLOUD VISION 2026",
            confidence: 0.99,
          }],
          languages: ["en"],
        }]
        : [],
      annotations: [
        ...(features.includes("labels")
          ? [{ type: "label", label: "test pattern", confidence: 0.98 }]
          : []),
        ...(features.includes("objects")
          ? [{ type: "object", label: "text region", confidence: 0.97 }]
          : []),
      ],
      ...(features.includes("visual-understanding")
        ? {
          visualUnderstanding,
          searchText,
          embedding: {
            model: "fixture-embedding-v1",
            values: vectorForText(searchText),
            tokenCount: 24,
          },
        }
        : {}),
      provider: {
        service: "mycelia-media-contract-mock",
        modelVersion: "fixture-v1",
        processedAt: new Date().toISOString(),
      },
      usage: {
        requestId,
        receivedBytes: file.size,
      },
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/media/embed") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON body is required" }, 400);
    }
    const value = String(body?.text ?? "").trim();
    if (!value) return json({ error: "text is required" }, 400);
    return json({
      model: "fixture-embedding-v1",
      values: vectorForText(value),
      tokenCount: Math.max(1, value.split(/\s+/).length),
    });
  }
  return json({ error: "not found" }, 404);
});
