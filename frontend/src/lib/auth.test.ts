import { beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeApiKeyForJWT, getCurrentJWT } from "./auth";
import { useSettingsStore } from "@/stores/settingsStore";

(globalThis as any).fetch = vi.fn();

describe("exchangeApiKeyForJWT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully exchanges credentials for JWT", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: "mock-jwt-token" }),
    };
    ((globalThis as any).fetch as any).mockResolvedValue(mockResponse);

    const result = await exchangeApiKeyForJWT(
      "http://localhost:8000",
      "client-id",
      "client-secret",
    );

    expect(result).toEqual({
      jwt: "mock-jwt-token",
      error: null,
    });
    expect((globalThis as any).fetch).toHaveBeenCalledWith(
      "http://localhost:8000/oauth/token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
  });

  it("returns error when server responds with error", async () => {
    const mockResponse = {
      ok: false,
      json: vi.fn().mockResolvedValue({ error: "invalid_client" }),
    };
    ((globalThis as any).fetch as any).mockResolvedValue(mockResponse);

    const result = await exchangeApiKeyForJWT(
      "http://localhost:8000",
      "bad-client",
      "bad-secret",
    );

    expect(result).toEqual({
      jwt: null,
      error: "invalid_client",
    });
  });

  it("returns generic error when server response has no error field", async () => {
    const mockResponse = {
      ok: false,
      json: vi.fn().mockResolvedValue({}),
    };
    ((globalThis as any).fetch as any).mockResolvedValue(mockResponse);

    const result = await exchangeApiKeyForJWT(
      "http://localhost:8000",
      "client-id",
      "client-secret",
    );

    expect(result).toEqual({
      jwt: null,
      error: "Failed to exchange token",
    });
  });

  it("handles JSON parse errors gracefully", async () => {
    const mockResponse = {
      ok: false,
      json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
    };
    ((globalThis as any).fetch as any).mockResolvedValue(mockResponse);

    const result = await exchangeApiKeyForJWT(
      "http://localhost:8000",
      "client-id",
      "client-secret",
    );

    expect(result).toEqual({
      jwt: null,
      error: "Failed to exchange token",
    });
  });

  it("handles network errors", async () => {
    ((globalThis as any).fetch as any).mockRejectedValue(
      new Error("Network error"),
    );

    const result = await exchangeApiKeyForJWT(
      "http://localhost:8000",
      "client-id",
      "client-secret",
    );

    expect(result.jwt).toBeNull();
    expect(result.error).toContain("Network error");
  });

  it("sends correct request body with URL encoded parameters", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: "token" }),
    };
    ((globalThis as any).fetch as any).mockResolvedValue(mockResponse);

    await exchangeApiKeyForJWT("http://localhost:8000", "id", "secret");

    const callArgs = ((globalThis as any).fetch as any).mock.calls[0];
    const body = callArgs[1].body;
    expect(body.toString()).toContain("grant_type=client_credentials");
    expect(body.toString()).toContain("client_id=id");
    expect(body.toString()).toContain("client_secret=secret");
  });
});

describe("getCurrentJWT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      apiEndpoint: "http://localhost:8000",
      clientId: "",
      clientSecret: "",
    });
  });

  it("returns JWT when credentials are valid", async () => {
    useSettingsStore.setState({
      apiEndpoint: "http://localhost:8000",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: "jwt-token" }),
    };
    ((globalThis as any).fetch as any).mockResolvedValue(mockResponse);

    const jwt = await getCurrentJWT();
    expect(jwt).toBe("jwt-token");
  });

  it("returns null when clientId is missing", async () => {
    useSettingsStore.setState({
      apiEndpoint: "http://localhost:8000",
      clientId: "",
      clientSecret: "client-secret",
    });

    const jwt = await getCurrentJWT();
    expect(jwt).toBeNull();
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it("returns null when clientSecret is missing", async () => {
    useSettingsStore.setState({
      apiEndpoint: "http://localhost:8000",
      clientId: "client-id",
      clientSecret: "",
    });

    const jwt = await getCurrentJWT();
    expect(jwt).toBeNull();
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it("returns null when both credentials are missing", async () => {
    useSettingsStore.setState({
      apiEndpoint: "http://localhost:8000",
      clientId: "",
      clientSecret: "",
    });

    const jwt = await getCurrentJWT();
    expect(jwt).toBeNull();
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it("returns null when exchange fails", async () => {
    useSettingsStore.setState({
      apiEndpoint: "http://localhost:8000",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    const mockResponse = {
      ok: false,
      json: vi.fn().mockResolvedValue({ error: "invalid_client" }),
    };
    ((globalThis as any).fetch as any).mockResolvedValue(mockResponse);

    const jwt = await getCurrentJWT();
    expect(jwt).toBeNull();
  });
});
