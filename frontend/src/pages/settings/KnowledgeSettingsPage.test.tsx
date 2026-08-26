import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as userEventLib from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { ActionDialogProvider } from "@/components/ActionDialogProvider";

const { callResourceMock } = vi.hoisted(() => ({
  callResourceMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ callResource: callResourceMock }));

import KnowledgeSettingsPage from "./KnowledgeSettingsPage";

const userEvent = (userEventLib as any).default || userEventLib;

const embeddingSpaceFingerprint = "a".repeat(64);
const instructionFingerprint =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const embeddingContract = {
  dense: {
    provider: "fastembed",
    model: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    modelRevision: "faf4aa4225822f3bc6376869cb1164e8e3feedd0",
    artifactRepo: "qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q",
    tokenizer: {
      id: "qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q",
      revision: "faf4aa4225822f3bc6376869cb1164e8e3feedd0",
    },
    instructions: {
      document: {
        id: "none",
        fingerprint: instructionFingerprint,
      },
      query: { id: "none", fingerprint: instructionFingerprint },
    },
    dimensions: 384,
    normalization: "l2",
    options: {
      artifactFile: "model_optimized.onnx",
      fastembedVersion: "0.8.0",
      pooling: "model-defined",
    },
  },
  sparse: {
    provider: "fastembed",
    model: "Qdrant/bm25",
    modelRevision: "22b8d2af71a76161e18dd432d2cee0eefa66e412",
    artifactRepo: "Qdrant/bm25",
    tokenizer: {
      id: "fastembed-bm25-tokenization",
      revision: "fastembed-0.8.0",
    },
    instructions: {
      document: {
        id: "none",
        fingerprint: instructionFingerprint,
      },
      query: { id: "none", fingerprint: instructionFingerprint },
    },
    dimensions: null,
    normalization: "none",
    options: { k: 1.2, b: 0.75 },
  },
};

const readyStatus = {
  state: "ready",
  paused: false,
  degraded: false,
  authMode: "current-user",
  activeProjectionId: "rag-v3",
  projection: {
    id: "rag-v3",
    state: "ready",
    fingerprint: "projection:abc123",
    collectionName: "mycelia_rag_v3",
    createdAt: "2026-08-26T10:00:00.000Z",
    activatedAt: "2026-08-26T11:00:00.000Z",
    denseModel: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    denseDimensions: 384,
    sparseModel: "Qdrant/bm25",
    modelFingerprint: embeddingSpaceFingerprint,
    inferenceContract: {
      profileId: "fastembed-minilm-bm25-v1",
      contractVersion: 1,
      ...embeddingContract,
    },
    chunkerVersion: "bounded-v1",
  },
  inference: {
    profileId: "fastembed-minilm-bm25-v1",
    contractVersion: 1,
    embeddingSpaceFingerprint,
    activeProjectionCompatible: true,
    executor: {
      kind: "local",
      label: "FastEmbed 0.8.0 (local)",
      transport: "in_process",
      denseLoaded: true,
      sparseLoaded: true,
      remoteExecutor: null,
    },
    contract: embeddingContract,
    reranker: {
      enabled: false,
      provider: null,
      model: null,
      modelRevision: null,
    },
  },
  candidateProjection: null,
  operation: null,
  progress: {
    phase: "ready",
    processedSources: 120,
    totalSources: 120,
    indexedChunks: 350,
    deletedChunks: 2,
    failedSources: 0,
    updatedAt: "2026-08-26T11:00:00.000Z",
  },
  sources: [{
    kind: "object",
    collection: "objects",
    documents: 120,
    indexedDocuments: 120,
    chunks: 350,
    lastCheckpoint: "objects:120",
    lastReconciledAt: "2026-08-26T10:59:00.000Z",
    error: null,
    changeStream: {
      state: "watching",
      resumeTokenPresent: true,
      updatedAt: "2026-08-26T11:00:00.000Z",
      lagSeconds: 3,
      error: null,
    },
  }],
  qdrant: {
    reachable: true,
    collection: "mycelia_rag_v3",
    pointsCount: 350,
    indexedVectorsCount: 350,
    status: "green",
    error: null,
    capabilities: {
      dense: true,
      sparse: true,
      hybridRrf: true,
      filters: true,
    },
  },
};

const chunksResponse = {
  projectionId: "rag-v3",
  total: 60,
  limit: 25,
  offset: 0,
  items: [{
    pointId: "object:o1:0",
    text: "Canonical evidence stored in a bounded projection chunk.",
    source: {
      kind: "object",
      collection: "objects",
      id: "o1",
      uri: "/objects/o1",
      title: "Migration evidence",
    },
    chunk: { index: 0, contentHash: "sha256:one" },
  }],
};

const emptyStatus = {
  ...readyStatus,
  state: "empty",
  activeProjectionId: null,
  projection: null,
  progress: {
    ...readyStatus.progress,
    phase: "empty",
    processedSources: 0,
    totalSources: null,
    indexedChunks: 0,
  },
  sources: [],
  qdrant: {
    ...readyStatus.qdrant,
    collection: null,
    pointsCount: 0,
    indexedVectorsCount: 0,
  },
};

function projectionStatus(id: string) {
  return {
    ...readyStatus,
    activeProjectionId: id,
    projection: {
      ...readyStatus.projection,
      id,
      collectionName: `mycelia_${id}`,
      fingerprint: `projection:${id}`,
    },
    qdrant: {
      ...readyStatus.qdrant,
      collection: `mycelia_${id}`,
    },
  };
}

function chunksForProjection(
  projectionId: string,
  offset = 0,
  text = `Chunk from ${projectionId}`,
) {
  return {
    ...chunksResponse,
    projectionId,
    offset,
    items: [{ ...chunksResponse.items[0], text }],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ActionDialogProvider>
        <KnowledgeSettingsPage />
      </ActionDialogProvider>
    </MemoryRouter>,
  );
}

describe("KnowledgeSettingsPage", () => {
  beforeEach(() => {
    callResourceMock.mockReset();
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "status") return Promise.resolve(readyStatus);
      if (body.action === "listChunks") return Promise.resolve(chunksResponse);
      if (body.action === "rebuild" || body.action === "reconcile") {
        return Promise.resolve({
          accepted: true,
          operation: {
            id: "op-1",
            type: body.action,
            state: "queued",
            createdAt: "2026-08-26T12:00:00.000Z",
          },
        });
      }
      if (body.action === "pause" || body.action === "resume") {
        return Promise.resolve({
          state: body.action === "pause" ? "paused" : "ready",
          paused: body.action === "pause",
        });
      }
      return Promise.reject(new Error(`Unexpected action ${body.action}`));
    });
  });

  it("shows projection lifecycle, source freshness, and inspectable chunks", async () => {
    renderPage();

    expect(await screen.findByText("projection:abc123")).toBeTruthy();
    const inferenceCard = screen.getByTestId("rag-inference-status");
    expect(inferenceCard.textContent).toContain("Stage 1 baseline");
    expect(inferenceCard.textContent).toContain("fastembed-minilm-bm25-v1");
    expect(inferenceCard.textContent).toContain("aaaaaaaaaaaa");
    expect(inferenceCard.textContent).toContain("FastEmbed 0.8.0 (local)");
    expect(inferenceCard.textContent).toContain("local · in_process");
    expect(inferenceCard.textContent).toContain(
      "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    );
    expect(inferenceCard.textContent).toContain(
      "revision faf4aa4225822f3bc6376869cb1164e8e3feedd0",
    );
    expect(inferenceCard.textContent).toContain("normalization l2");
    expect(inferenceCard.textContent).toContain(
      "artifact qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q",
    );
    expect(inferenceCard.textContent).toContain(
      "instructions doc:none@e3b0c44298fc · query:none@e3b0c44298fc",
    );
    expect(inferenceCard.textContent).toContain("Qdrant/bm25");
    expect(inferenceCard.textContent).toContain("Reranker disabled");
    expect(inferenceCard.textContent).toContain(
      "Remote executor: not configured",
    );
    expect(inferenceCard.textContent).toContain("Projection compatible");
    expect(inferenceCard.textContent).not.toContain("Qwen");
    expect(screen.getByText("watching")).toBeTruthy();
    expect(
      await screen.findByText(/Canonical evidence stored/),
    ).toBeTruthy();
    expect(screen.getByTestId("rag-chunks-projection").textContent).toContain(
      "chunks projection rag-v3",
    );
    expect(
      screen.getByRole("link", { name: /Source/ }).getAttribute("href"),
    ).toBe("/objects/o1");

    expect(callResourceMock).toHaveBeenCalledWith(
      "rag",
      { action: "status" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(callResourceMock).toHaveBeenCalledWith(
      "rag",
      { action: "listChunks", limit: 25, offset: 0 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not infer executor or reranker state from a legacy projection", async () => {
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "status") {
        return Promise.resolve({
          ...readyStatus,
          inference: undefined,
          projection: {
            ...readyStatus.projection,
            inferenceContract: undefined,
          },
        });
      }
      if (body.action === "listChunks") return Promise.resolve(chunksResponse);
      return Promise.reject(new Error(`Unexpected action ${body.action}`));
    });

    renderPage();

    const inferenceCard = await screen.findByTestId("rag-inference-status");
    expect(inferenceCard.textContent).toContain("Inference not reported");
    expect(inferenceCard.textContent).toContain("Execution unknown");
    expect(inferenceCard.textContent).toContain("Provider not reported");
    expect(inferenceCard.textContent).toContain("Reranker not reported");
    expect(inferenceCard.textContent).toContain(
      "Remote executor: not reported",
    );
    expect(inferenceCard.textContent).toContain(
      "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    );
  });

  it("renders future remote executor identity only when runtime reports it", async () => {
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "status") {
        return Promise.resolve({
          ...readyStatus,
          inference: {
            ...readyStatus.inference,
            profileId: "qwen3-embedding-0.6b-768-v2",
            executor: {
              kind: "remote",
              label: "Remote embedding executor",
              transport: "http",
              denseLoaded: null,
              sparseLoaded: null,
              remoteExecutor: { label: "GPU pool eu-1" },
            },
          },
        });
      }
      if (body.action === "listChunks") return Promise.resolve(chunksResponse);
      return Promise.reject(new Error(`Unexpected action ${body.action}`));
    });

    renderPage();

    const inferenceCard = await screen.findByTestId("rag-inference-status");
    expect(inferenceCard.textContent).toContain("Versioned profile");
    expect(inferenceCard.textContent).not.toContain("Stage 1 baseline");
    expect(inferenceCard.textContent).toContain("Remote execution");
    expect(inferenceCard.textContent).toContain("Remote embedding executor");
    expect(inferenceCard.textContent).toContain(
      "Remote executor: GPU pool eu-1",
    );
  });

  it("does not claim zero update lag for a manual snapshot index", async () => {
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "status") {
        return Promise.resolve({
          ...readyStatus,
          degraded: true,
          warnings: [
            "continuous updates are disabled; freshness depends on manual reconcile",
          ],
          sources: readyStatus.sources.map((source) => ({
            ...source,
            lagSeconds: null,
            changeStream: {
              ...source.changeStream,
              state: "disabled",
              lagSeconds: null,
            },
          })),
        });
      }
      if (body.action === "listChunks") return Promise.resolve(chunksResponse);
      return Promise.reject(new Error(`Unexpected action ${body.action}`));
    });

    renderPage();

    const metric = (await screen.findByText("Update lag")).parentElement;
    expect(metric?.textContent).toContain("—");
    expect(metric?.textContent).not.toContain("0s");
    expect(screen.getByText("disabled")).toBeTruthy();
  });

  it("requires confirmation before starting a blue-green rebuild", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("projection:abc123");

    await user.click(
      screen.getByRole("button", { name: "Rebuild projection" }),
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      "Rebuild the Qdrant projection?",
    );
    expect(
      callResourceMock.mock.calls.some(([, body]) => body.action === "rebuild"),
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: "Start rebuild" }));

    await waitFor(() => {
      expect(callResourceMock).toHaveBeenCalledWith("rag", {
        action: "rebuild",
      });
    });
  });

  it("shows a blue-green candidate separately from the active projection", async () => {
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "status") {
        return Promise.resolve({
          ...readyStatus,
          state: "building",
          candidateProjection: {
            ...readyStatus.projection,
            id: "rag-v4-candidate",
            state: "building",
            collectionName: "mycelia_rag_v4_candidate",
            fingerprint: "projection:candidate",
            activatedAt: null,
          },
        });
      }
      if (body.action === "listChunks") return Promise.resolve(chunksResponse);
      return Promise.reject(new Error(`Unexpected action ${body.action}`));
    });

    renderPage();

    const candidate = await screen.findByTestId("rag-candidate-projection");
    expect(candidate.textContent).toContain("rag-v4-candidate");
    expect(candidate.textContent).toContain("projection:candidate");
    expect(screen.getByText("rag-v3")).toBeTruthy();
  });

  it("uses bounded offset pagination for chunk inspection", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/Canonical evidence stored/);

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(callResourceMock).toHaveBeenCalledWith(
        "rag",
        { action: "listChunks", limit: 25, offset: 25 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("waits for the initial empty index and loads chunks when a projection becomes active", async () => {
    let statusCalls = 0;
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "status") {
        statusCalls += 1;
        return Promise.resolve(statusCalls === 1 ? emptyStatus : readyStatus);
      }
      if (body.action === "listChunks") {
        return Promise.resolve(chunksResponse);
      }
      return Promise.reject(new Error(`Unexpected action ${body.action}`));
    });

    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText(/Build one before inspecting chunks/),
    ).toBeTruthy();
    expect(
      callResourceMock.mock.calls.some(([, body]) =>
        body.action === "listChunks"
      ),
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText(/Canonical evidence stored/)).toBeTruthy();
    expect(screen.getByTestId("rag-chunks-projection").textContent).toContain(
      "chunks projection rag-v3",
    );
    expect(callResourceMock).toHaveBeenCalledWith(
      "rag",
      { action: "listChunks", limit: 25, offset: 0 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("resets chunk pagination and reloads after an active projection cutover", async () => {
    let statusCalls = 0;
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "status") {
        statusCalls += 1;
        return Promise.resolve(
          projectionStatus(statusCalls === 1 ? "rag-v3" : "rag-v4"),
        );
      }
      if (body.action === "listChunks") {
        const projectionId = statusCalls === 1 ? "rag-v3" : "rag-v4";
        return Promise.resolve(
          chunksForProjection(projectionId, body.offset),
        );
      }
      return Promise.reject(new Error(`Unexpected action ${body.action}`));
    });

    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("Chunk from rag-v3")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(callResourceMock).toHaveBeenCalledWith(
        "rag",
        { action: "listChunks", limit: 25, offset: 25 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Chunk from rag-v4")).toBeTruthy();
    expect(screen.getByTestId("rag-chunks-projection").textContent).toContain(
      "chunks projection rag-v4",
    );
    await waitFor(() => {
      const chunkCalls = callResourceMock.mock.calls.filter(([, body]) =>
        body.action === "listChunks"
      );
      expect(chunkCalls.at(-1)?.[1]).toEqual({
        action: "listChunks",
        limit: 25,
        offset: 0,
      });
    });
  });

  it("shows and rejects chunks from a projection that differs from active status", async () => {
    callResourceMock.mockImplementation((_resource, body) => {
      if (body.action === "status") return Promise.resolve(readyStatus);
      if (body.action === "listChunks") {
        return Promise.resolve(
          chunksForProjection("rag-v2", 0, "Stale projection chunk"),
        );
      }
      return Promise.reject(new Error(`Unexpected action ${body.action}`));
    });

    renderPage();

    expect(
      await screen.findByText(/Chunk response belongs to projection rag-v2/),
    ).toBeTruthy();
    expect(screen.getByTestId("rag-chunks-projection").textContent).toContain(
      "chunks projection rag-v2",
    );
    expect(screen.queryByText("Stale projection chunk")).toBeNull();
  });

  it("routes pause through the RAG Resource control action", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("projection:abc123");

    await user.click(screen.getByRole("button", { name: "Pause updates" }));

    await waitFor(() => {
      expect(callResourceMock).toHaveBeenCalledWith("rag", {
        action: "pause",
      });
    });
  });
});
