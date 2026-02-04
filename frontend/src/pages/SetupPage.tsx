import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore } from "@/stores/settingsStore";
import { exchangeApiKeyForJWT } from "@/lib/auth";
import { Loader2, CheckCircle2, XCircle, Terminal, Copy, Check, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ServerType = "docker" | "deno" | "custom";

const SERVER_ENDPOINTS: Record<Exclude<ServerType, "custom">, string> = {
  docker: "https://localhost:4433",
  deno: "http://localhost:5173",
};

type SetupStatus = "idle" | "verifying" | "creating_new" | "success" | "error" | "keys_exist";

interface SetupResponse {
  created: boolean;
  clientId?: string;
  clientSecret?: string;
  error?: string;
}

function getFriendlyAuthError(error: string | null): string {
  if (!error) return "Something went wrong. Please try again.";

  switch (error) {
    case "invalid_client":
      return "The MYCELIA_CLIENT_ID or MYCELIA_TOKEN you entered is incorrect.";
    case "invalid_request":
      return "Missing required fields. Please enter both MYCELIA_CLIENT_ID and MYCELIA_TOKEN.";
    case "invalid_grant":
      return "Your authorization has expired. Please request new credentials.";
    default:
      if (error.includes("Failed to fetch") || error.includes("NetworkError")) {
        return "Could not reach the server. Make sure it's running and try again.";
      }
      return error;
  }
}

export default function SetupPage() {
  const navigate = useNavigate();
  const {
    apiEndpoint,
    clientId,
    clientSecret,
    setApiEndpoint,
    setClientId,
    setClientSecret,
  } = useSettingsStore();

  const [serverType, setServerType] = useState<ServerType>("docker");
  const [localEndpoint, setLocalEndpoint] = useState(apiEndpoint || SERVER_ENDPOINTS.docker);
  const [localClientId, setLocalClientId] = useState("");
  const [localToken, setLocalToken] = useState("");
  const [pastedCredentials, setPastedCredentials] = useState("");
  const [status, setStatus] = useState<SetupStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleServerTypeChange = (value: ServerType) => {
    setServerType(value);
    if (value !== "custom") {
      setLocalEndpoint(SERVER_ENDPOINTS[value]);
    }
  };

  const parseCredentials = () => {
    const lines = pastedCredentials.trim().split("\n");
    let foundClientId = "";
    let foundToken = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("MYCELIA_CLIENT_ID=")) {
        foundClientId = trimmed.replace("MYCELIA_CLIENT_ID=", "").trim();
      } else if (trimmed.startsWith("MYCELIA_TOKEN=")) {
        foundToken = trimmed.replace("MYCELIA_TOKEN=", "").trim();
      }
    }

    if (foundClientId) setLocalClientId(foundClientId);
    if (foundToken) setLocalToken(foundToken);
    
    if (!foundClientId && !foundToken) {
      setErrorMessage("Could not find MYCELIA_CLIENT_ID or MYCELIA_TOKEN in the pasted text");
    } else {
      setPastedCredentials("");
      setErrorMessage(null);
    }
  };

  // Redirect if already configured
  useEffect(() => {
    if (clientId && clientSecret) {
      navigate("/setup/inference", { replace: true });
    }
  }, [clientId, clientSecret, navigate]);

  const verifyAndSaveCredentials = async () => {
    if (!localClientId || !localToken) {
      setErrorMessage("Please enter both MYCELIA_CLIENT_ID and MYCELIA_TOKEN");
      return;
    }

    setStatus("verifying");
    setErrorMessage(null);
    setApiEndpoint(localEndpoint);

    try {
      const result = await exchangeApiKeyForJWT(
        localEndpoint,
        localClientId,
        localToken
      );

      if (result.jwt) {
        setClientId(localClientId);
        setClientSecret(localToken);
        setStatus("success");

        setTimeout(() => {
          navigate("/setup/inference", { replace: true });
        }, 1500);
      } else {
        setErrorMessage(result.error || "Invalid credentials");
        setStatus("error");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Verification failed");
      setStatus("error");
    }
  };

  const createNewCredentials = async () => {
    setStatus("creating_new");
    setErrorMessage(null);
    setApiEndpoint(localEndpoint);

    try {
      const response = await fetch(`${localEndpoint}/api/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ create: true }),
      });

      const data: SetupResponse = await response.json();

      // Handle keys_exist error specifically
      if (data.error === "keys_exist") {
        setStatus("keys_exist");
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || `Server returned ${response.status}`);
      }

      if (data.created && data.clientId && data.clientSecret) {
        setClientId(data.clientId);
        setClientSecret(data.clientSecret);
        setStatus("success");

        setTimeout(() => {
          navigate("/setup/inference", { replace: true });
        }, 1500);
      } else {
        setErrorMessage("Failed to create new credentials");
        setStatus("error");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create credentials");
      setStatus("error");
    }
  };

  const isLoading = status === "verifying" || status === "creating_new";
  const [copiedCommand, setCopiedCommand] = useState(false);

  const copyCommand = async (command: string) => {
    await navigator.clipboard.writeText(command);
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  const isRemoteServer = !localEndpoint.includes("localhost") && !localEndpoint.includes("127.0.0.1");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo and Welcome */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
            Welcome to Mycelia
          </h1>
          <p className="text-slate-300 text-lg">
            Your personal AI memory system
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-3 h-3 rounded-full bg-purple-400 ring-2 ring-purple-400/50" />
          <div className="w-8 h-0.5 bg-slate-600" />
          <div className="w-3 h-3 rounded-full bg-slate-600" />
        </div>

        {/* Setup Card */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20 shadow-2xl">
          {status === "success" ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
              <p className="text-white text-lg font-medium">
                Connected!
              </p>
              <p className="text-slate-400 text-sm mt-2">
                Continuing to next step...
              </p>
            </div>
          ) : status === "keys_exist" ? (
            <div className="space-y-6">
              <div className="text-center">
                <Terminal className="w-12 h-12 text-purple-400 mx-auto mb-4" />
                <h2 className="text-white text-lg font-medium mb-2">
                  Generate Credentials via CLI
                </h2>
                <p className="text-slate-400 text-sm">
                  API keys already exist on this server. Generate new credentials using the command line.
                </p>
              </div>

              <div className="space-y-4">
                {isRemoteServer ? (
                  <>
                    <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                      <p className="text-amber-300 text-sm">
                        <strong>Remote server detected.</strong> SSH into your server and run:
                      </p>
                    </div>
                    <div className="relative">
                      <pre className="bg-slate-900/80 rounded-lg p-4 text-sm font-mono text-slate-300 overflow-x-auto">
                        <code>docker compose exec backend deno run -A server.ts token-create --name browser-ui</code>
                      </pre>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="absolute top-2 right-2 text-slate-400 hover:text-white"
                        onClick={() => copyCommand("docker compose exec backend deno run -A server.ts token-create --name browser-ui")}
                      >
                        {copiedCommand ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                    <p className="text-slate-500 text-xs">
                      Server endpoint: <code className="text-purple-400">{localEndpoint}</code>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-slate-400 text-sm">
                      Run one of these commands in your terminal:
                    </p>
                    
                    {/* Docker option */}
                    <div className="space-y-2 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                      <p className="text-slate-300 text-xs font-medium">Docker (recommended)</p>
                      <div className="relative">
                        <pre className="bg-slate-900/80 rounded-lg p-3 text-sm font-mono text-slate-300 overflow-x-auto">
                          <code>docker compose exec backend deno run -A server.ts token-create --name browser-ui</code>
                        </pre>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="absolute top-2 right-2 text-slate-400 hover:text-white"
                          onClick={() => copyCommand("docker compose exec backend deno run -A server.ts token-create --name browser-ui")}
                        >
                          {copiedCommand ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                      <p className="text-slate-500 text-xs">
                        Server endpoint: <code className="text-purple-400">https://localhost:4433</code>
                      </p>
                    </div>
                    
                    {/* Non-Docker option */}
                    <div className="space-y-2 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                      <p className="text-slate-300 text-xs font-medium">Local development (deno task dev)</p>
                      <div className="relative">
                        <pre className="bg-slate-900/80 rounded-lg p-3 text-sm font-mono text-slate-300 overflow-x-auto">
                          <code>cd backend && deno run -A server.ts token-create --name browser-ui</code>
                        </pre>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="absolute top-2 right-2 text-slate-400 hover:text-white"
                          onClick={() => copyCommand("cd backend && deno run -A server.ts token-create --name browser-ui")}
                        >
                          {copiedCommand ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                      <p className="text-slate-500 text-xs">
                        Server endpoint: <code className="text-purple-400">http://localhost:5173</code>
                      </p>
                    </div>
                  </>
                )}

                <div className="text-slate-400 text-sm space-y-2">
                  <p>This will output your credentials:</p>
                  <pre className="bg-slate-900/80 rounded-lg p-3 text-xs font-mono text-slate-500">
{`MYCELIA_CLIENT_ID=abc123...
MYCELIA_TOKEN=mycelia_xyz...`}
                  </pre>
                </div>
              </div>

              <div className="border-t border-white/10 pt-4">
                <Button
                  type="button"
                  onClick={() => setStatus("idle")}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-medium py-5 rounded-xl"
                >
                  I have my credentials
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); verifyAndSaveCredentials(); }}>
              {errorMessage && (
                <div className="mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/30">
                  <div className="flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-300 text-sm">{getFriendlyAuthError(errorMessage)}</p>
                  </div>
                </div>
              )}

              <div className="space-y-4 mb-6">
                <div>
                  <Label htmlFor="serverType" className="text-slate-200 mb-2 block">
                    Server Type
                  </Label>
                  <Select value={serverType} onValueChange={(v) => handleServerTypeChange(v as ServerType)}>
                    <SelectTrigger className="bg-white/10 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="docker">Docker (default)</SelectItem>
                      <SelectItem value="deno">Deno (local dev)</SelectItem>
                      <SelectItem value="custom">Custom server</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {serverType === "custom" && (
                  <div>
                    <Label htmlFor="endpoint" className="text-slate-200 mb-2 block">
                      Server Endpoint
                    </Label>
                    <Input
                      id="endpoint"
                      type="url"
                      value={localEndpoint}
                      onChange={(e) => setLocalEndpoint(e.target.value)}
                      placeholder="https://your-server.com"
                      disabled={isLoading}
                      className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:border-purple-400 disabled:opacity-50"
                    />
                  </div>
                )}

                {serverType !== "custom" && (
                  <p className="text-slate-500 text-xs">
                    Server endpoint: <code className="text-purple-400">{localEndpoint}</code>
                  </p>
                )}

                {/* Paste credentials section */}
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 space-y-3">
                  <Label className="text-slate-300 text-xs font-medium block">
                    Paste credentials
                  </Label>
                  <textarea
                    value={pastedCredentials}
                    onChange={(e) => setPastedCredentials(e.target.value)}
                    placeholder={`MYCELIA_CLIENT_ID=abc123...\nMYCELIA_TOKEN=mycelia_xyz...`}
                    disabled={isLoading}
                    rows={3}
                    className="w-full bg-slate-900/80 border border-white/10 rounded-lg p-3 text-sm font-mono text-slate-300 placeholder:text-slate-600 focus:border-purple-400 focus:outline-none disabled:opacity-50 resize-none"
                  />
                  <Button
                    type="button"
                    onClick={parseCredentials}
                    disabled={!pastedCredentials.trim() || isLoading}
                    variant="outline"
                    size="sm"
                    className="w-full border-purple-500/50 text-purple-300 hover:bg-purple-500/20 hover:text-white disabled:opacity-50"
                  >
                    <ClipboardPaste className="w-4 h-4 mr-2" />
                    I have credentials
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2 bg-transparent text-slate-500">or enter manually</span>
                  </div>
                </div>

                <div>
                  <Label htmlFor="clientId" className="text-slate-200 mb-2 block font-mono text-sm">
                    MYCELIA_CLIENT_ID
                  </Label>
                  <Input
                    id="clientId"
                    type="text"
                    value={localClientId}
                    onChange={(e) => setLocalClientId(e.target.value)}
                    placeholder="e.g. 695c4437205e4cbcef78776e"
                    disabled={isLoading}
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:border-purple-400 disabled:opacity-50 font-mono"
                  />
                </div>

                <div>
                  <Label htmlFor="token" className="text-slate-200 mb-2 block font-mono text-sm">
                    MYCELIA_TOKEN
                  </Label>
                  <Input
                    id="token"
                    type="password"
                    value={localToken}
                    onChange={(e) => setLocalToken(e.target.value)}
                    placeholder="mycelia_..."
                    disabled={isLoading}
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:border-purple-400 disabled:opacity-50 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  type="submit"
                  disabled={!localClientId || !localToken || isLoading}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-medium py-6 text-lg rounded-xl shadow-lg shadow-purple-500/30 transition-all hover:shadow-purple-500/50 disabled:opacity-80"
                >
                  {status === "verifying" ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : "Connect"}
                </Button>

                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/20" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-transparent text-slate-400">or</span>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={createNewCredentials}
                  disabled={isLoading}
                  variant="outline"
                  className="w-full border-purple-500/50 text-purple-300 hover:bg-purple-500/20 hover:text-white py-5 rounded-xl disabled:opacity-50"
                >
                  {status === "creating_new" ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Terminal className="w-5 h-5 mr-2" />
                      First-time setup
                    </>
                  )}
                </Button>

                <div className="text-slate-500 text-xs text-center mt-4 space-y-1">
                  <p>
                    Find these values in your <code className="text-slate-400">.env</code> file
                  </p>
                  <p className="text-slate-600">
                    Don't have credentials? <button
                      type="button"
                      onClick={() => setStatus("keys_exist")}
                      className="text-purple-400 hover:text-purple-300 underline underline-offset-2"
                    >
                      See how to generate them
                    </button>
                  </p>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
