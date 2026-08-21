import { useEffect, useState } from "react";
import { Cloud, Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

type GoogleProfile = {
  id: string;
  name: string;
  providerType: "google-cloud";
  enabled: boolean;
  concurrency: number;
  projectId: string;
  location: "eu";
  vertexModel: "gemini-3.5-flash-lite";
  embeddingModel: "gemini-embedding-001";
  documentAiProcessorId?: string;
  documentAiProcessorVersion: "pretrained-ocr-v2.1-2024-08-07";
  allowGlobalPhotoAnalysis: boolean;
};

type SelfHostedProfile = {
  id: string;
  name: string;
  providerType: "self-hosted";
  enabled: boolean;
  concurrency: number;
  baseUrl: string;
};

type MediaConfig = {
  enabled: boolean;
  activeProfileId?: string;
  profiles: Array<GoogleProfile | SelfHostedProfile>;
  promoGuard: {
    mode: "promo_guarded";
    promotionExpiresAt: string;
    stopBeforeHours: number;
    monthlyGrossLimitUsd: number;
    dailyGrossLimitUsd: number;
    perImportGrossLimitUsd: number;
    creditVerifiedAt?: string;
    creditVerifiedProjectId?: string;
    verifiedRemainingUsd?: number;
  };
  limits: {
    maxFilesPerImport: number;
    maxImageBytes: number;
    maxPdfBytes: number;
    maxPdfPages: number;
  };
};

type ConnectorStatus = {
  enabled: boolean;
  sourceConfigured: boolean;
  adc: {
    configured: boolean;
    credentialPathConfigured: boolean;
    error?: string;
  };
  promoGuard: MediaConfig["promoGuard"] & {
    creditVerificationFresh: boolean;
  };
  usage: {
    month: string;
    day: string;
    grossCommittedUsd: number;
    grossReservedUsd: number;
    grossMonthUsd: number;
    grossTodayUsd: number;
    monthlyLimitUsd: number;
    dailyLimitUsd: number;
    monthlyRemainingUsd: number;
    dailyRemainingUsd: number;
  };
  connectorTestEstimateUsd: {
    vertexAndVision: number;
    withDocumentAi: number;
  };
};

const defaultConfig: MediaConfig = {
  enabled: false,
  profiles: [],
  promoGuard: {
    mode: "promo_guarded",
    promotionExpiresAt: "2026-09-24T00:00:00.000Z",
    stopBeforeHours: 72,
    monthlyGrossLimitUsd: 1,
    dailyGrossLimitUsd: 0.1,
    perImportGrossLimitUsd: 0.01,
  },
  limits: {
    maxFilesPerImport: 200,
    maxImageBytes: 20_000_000,
    maxPdfBytes: 32_000_000,
    maxPdfPages: 15,
  },
};

function normalizeConfig(value: Partial<MediaConfig> | null): MediaConfig {
  const stored = value ?? {};
  return {
    ...defaultConfig,
    ...stored,
    profiles: (stored.profiles ?? []).map((profile) =>
      profile.providerType === "google-cloud"
        ? {
          ...profile,
          vertexModel: profile.vertexModel ??
            ("gemini-3.5-flash-lite" as const),
          embeddingModel: profile.embeddingModel ??
            ("gemini-embedding-001" as const),
        }
        : profile
    ),
    promoGuard: {
      ...defaultConfig.promoGuard,
      ...(stored.promoGuard ?? {}),
    },
    limits: { ...defaultConfig.limits, ...(stored.limits ?? {}) },
  };
}

export default function GoogleCloudSettingsPage() {
  const [config, setConfig] = useState<MediaConfig>(defaultConfig);
  const [status, setStatus] = useState<ConnectorStatus>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [verifiedBalance, setVerifiedBalance] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [stored, connector] = await Promise.all([
        callResource("config", { action: "get", path: "mediaKnowledge" }),
        callResource("media", { action: "status" }),
      ]);
      setConfig(normalizeConfig(stored));
      setStatus(connector);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load media settings",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const google = config.profiles.find((profile) =>
    profile.providerType === "google-cloud"
  ) as GoogleProfile | undefined;
  const selfHosted = config.profiles.find((profile) =>
    profile.providerType === "self-hosted"
  ) as SelfHostedProfile | undefined;
  const activeProfile = config.profiles.find((profile) =>
    profile.id === config.activeProfileId
  );

  const updateProfile = (profile: GoogleProfile | SelfHostedProfile) => {
    setConfig((current) => ({
      ...current,
      profiles: current.profiles.some((entry) => entry.id === profile.id)
        ? current.profiles.map((entry) =>
          entry.id === profile.id ? profile : entry
        )
        : [...current.profiles, profile],
      activeProfileId: current.activeProfileId ?? profile.id,
    }));
  };

  const addGooglePreset = () =>
    updateProfile({
      id: "google-cloud-media",
      name: "Google Cloud EU Photo Knowledge",
      providerType: "google-cloud",
      enabled: false,
      concurrency: 1,
      projectId: "",
      location: "eu",
      vertexModel: "gemini-3.5-flash-lite",
      embeddingModel: "gemini-embedding-001",
      documentAiProcessorVersion: "pretrained-ocr-v2.1-2024-08-07",
      allowGlobalPhotoAnalysis: false,
    });

  const addSelfHostedPreset = () =>
    updateProfile({
      id: "self-hosted-media",
      name: "Self-hosted media recognition",
      providerType: "self-hosted",
      enabled: false,
      concurrency: 1,
      baseUrl: "http://host.docker.internal:8090",
    });

  const save = async (next = config) => {
    setSaving(true);
    try {
      await callResource("config", {
        action: "patch",
        path: "mediaKnowledge",
        updates: next,
      });
      setConfig(next);
      toast.success("Media recognition settings saved");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const verifyCredit = async () => {
    const remaining = Number(verifiedBalance);
    if (!google?.projectId || !Number.isFinite(remaining) || remaining <= 0) {
      toast.error(
        "Enter the Google project ID and remaining promotional credit shown in Cloud Console",
      );
      return;
    }
    const next = {
      ...config,
      promoGuard: {
        ...config.promoGuard,
        creditVerifiedAt: new Date().toISOString(),
        creditVerifiedProjectId: google.projectId,
        verifiedRemainingUsd: remaining,
      },
    };
    await save(next);
  };

  const test = async () => {
    if (!config.activeProfileId) return;
    setTesting(true);
    try {
      const result = await callResource("media", {
        action: "testConnector",
        profileId: config.activeProfileId,
        includeDocumentAi: Boolean(google?.documentAiProcessorId),
      });
      toast.success(`Connector works (${result.latencyMs ?? "?"} ms)`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Connector test failed",
      );
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="p-6">Loading media settings…</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" /> Google Cloud / media recognition
          </CardTitle>
          <CardDescription>
            Visual understanding uses Gemini on Vertex AI through server-side
            Application Default Credentials. Gemini API / AI Studio keys are not
            accepted or stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant={status?.sourceConfigured ? "default" : "secondary"}>
              Media folder{" "}
              {status?.sourceConfigured ? "mounted" : "not mounted"}
            </Badge>
            <Badge
              variant={status?.adc?.configured ? "default" : "destructive"}
            >
              ADC {status?.adc?.configured ? "ready" : "unavailable"}
            </Badge>
            <Badge
              variant={status?.promoGuard?.creditVerificationFresh
                ? "default"
                : "secondary"}
            >
              Credit check{" "}
              {status?.promoGuard?.creditVerificationFresh
                ? "fresh"
                : "required"}
            </Badge>
          </div>
          {!status?.adc?.configured && status?.adc?.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              ADC check failed: {status.adc.error}
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Enable Media Knowledge</Label>
              <p className="text-sm text-muted-foreground">
                Allows confirmed imports to call the selected provider.
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
            />
          </div>

          {!google && (
            <Button variant="outline" onClick={addGooglePreset}>
              Add Google Cloud preset
            </Button>
          )}
          {google && (
            <div className="space-y-4 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{google.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Primary: Vertex AI Flash-Lite visual understanding in EU.
                    OCR is optional; labels/objects are a separate global
                    opt-in.
                  </div>
                </div>
                <Switch
                  checked={google.enabled}
                  onCheckedChange={(enabled) =>
                    updateProfile({ ...google, enabled })}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="google-cloud-project-id">
                    Google project ID
                  </Label>
                  <Input
                    id="google-cloud-project-id"
                    value={google.projectId}
                    onChange={(event) =>
                      updateProfile({
                        ...google,
                        projectId: event.target.value,
                      })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="google-cloud-document-ai-processor-id">
                    Document AI EU processor ID (optional PDF OCR)
                  </Label>
                  <Input
                    id="google-cloud-document-ai-processor-id"
                    value={google.documentAiProcessorId ?? ""}
                    onChange={(event) =>
                      updateProfile({
                        ...google,
                        documentAiProcessorId: event.target.value || undefined,
                      })}
                  />
                </div>
              </div>
              <div className="text-sm">
                Vertex endpoint: <code>eu</code> · visual model:{" "}
                <code>{google.vertexModel}</code> · semantic embeddings:{" "}
                <code>{google.embeddingModel}</code>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted p-3">
                <div>
                  <Label>Allow global labels and objects</Label>
                  <p className="text-xs text-muted-foreground">
                    Still requires per-import confirmation.
                  </p>
                </div>
                <Switch
                  checked={google.allowGlobalPhotoAnalysis}
                  onCheckedChange={(allowGlobalPhotoAnalysis) =>
                    updateProfile({ ...google, allowGlobalPhotoAnalysis })}
                />
              </div>
            </div>
          )}

          {!selfHosted && (
            <Button variant="outline" onClick={addSelfHostedPreset}>
              Add future self-hosted preset
            </Button>
          )}
          {selfHosted && (
            <div className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">{selfHosted.name}</div>
                <Switch
                  checked={selfHosted.enabled}
                  onCheckedChange={(enabled) =>
                    updateProfile({ ...selfHosted, enabled })}
                />
              </div>
              <Label>Open media API base URL</Label>
              <Input
                value={selfHosted.baseUrl}
                onChange={(event) =>
                  updateProfile({ ...selfHosted, baseUrl: event.target.value })}
              />
            </div>
          )}

          {config.profiles.length > 0 && (
            <div className="space-y-2">
              <Label>Active provider</Label>
              <select
                className="w-full rounded-md border bg-background p-2"
                value={config.activeProfileId ?? ""}
                onChange={(event) =>
                  setConfig({ ...config, activeProfileId: event.target.value })}
              >
                <option value="">Choose provider</option>
                {config.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-4 md:grid-cols-3">
            {status?.usage && (
              <div className="grid gap-2 rounded-md bg-background/80 p-3 text-sm md:col-span-3 md:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Month used / stop
                  </div>
                  <div className="font-medium">
                    ${status.usage.grossMonthUsd.toFixed(4)}{" "}
                    / ${status.usage.monthlyLimitUsd.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Today used / stop
                  </div>
                  <div className="font-medium">
                    ${status.usage.grossTodayUsd.toFixed(4)}{" "}
                    / ${status.usage.dailyLimitUsd.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Committed</div>
                  <div className="font-medium">
                    ${status.usage.grossCommittedUsd.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Reserved</div>
                  <div className="font-medium">
                    ${status.usage.grossReservedUsd.toFixed(4)}
                  </div>
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="google-cloud-monthly-stop">
                Monthly gross stop, USD
              </Label>
              <Input
                id="google-cloud-monthly-stop"
                type="number"
                value={config.promoGuard.monthlyGrossLimitUsd}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    promoGuard: {
                      ...config.promoGuard,
                      monthlyGrossLimitUsd: Number(event.target.value),
                    },
                  })}
              />
            </div>
            <div>
              <Label htmlFor="google-cloud-daily-stop">Daily stop, USD</Label>
              <Input
                id="google-cloud-daily-stop"
                type="number"
                value={config.promoGuard.dailyGrossLimitUsd}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    promoGuard: {
                      ...config.promoGuard,
                      dailyGrossLimitUsd: Number(event.target.value),
                    },
                  })}
              />
            </div>
            <div>
              <Label htmlFor="google-cloud-per-import-stop">
                Per import, USD
              </Label>
              <Input
                id="google-cloud-per-import-stop"
                type="number"
                value={config.promoGuard.perImportGrossLimitUsd}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    promoGuard: {
                      ...config.promoGuard,
                      perImportGrossLimitUsd: Number(event.target.value),
                    },
                  })}
              />
            </div>
            <p className="text-xs text-muted-foreground md:col-span-3">
              This is a fail-closed application guard, not a Google billing
              guarantee. Processing stops 72 hours before the configured
              promotion expiry. Defaults are $1/month, $0.10/day, and
              $0.01/import.
            </p>
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div>
              <Label>Promotional-credit confirmation</Label>
              <p className="text-xs text-muted-foreground">
                In Cloud Console, verify that the selected project is linked to
                the billing account with the active $300 promotional credit,
                then enter the remaining balance. The confirmation expires after
                24 hours and is locked to this project ID.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="google-cloud-verified-project">
                  Verified project
                </Label>
                <Input
                  id="google-cloud-verified-project"
                  value={google?.projectId ?? ""}
                  readOnly
                  placeholder="Add the Google preset and project ID first"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="google-cloud-remaining-credit">
                  Remaining promotional credit, USD
                </Label>
                <Input
                  id="google-cloud-remaining-credit"
                  type="number"
                  min="0.01"
                  max="300"
                  step="0.01"
                  value={verifiedBalance}
                  onChange={(event) => setVerifiedBalance(event.target.value)}
                  placeholder={config.promoGuard.verifiedRemainingUsd
                    ?.toString() ?? "300"}
                />
              </div>
            </div>
            {config.promoGuard.creditVerifiedAt && (
              <p className="text-xs text-muted-foreground">
                Last confirmation: {config.promoGuard.creditVerifiedAt}{" "}
                · project {config.promoGuard.creditVerifiedProjectId ?? "?"}
                {" "}
                · remaining ${config.promoGuard.verifiedRemainingUsd ?? "?"}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save()} disabled={saving}>
              {saving
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Save className="mr-2 h-4 w-4" />} Save
            </Button>
            <Button variant="outline" onClick={verifyCredit} disabled={saving}>
              <ShieldCheck className="mr-2 h-4 w-4" /> Confirm promo credit now
            </Button>
            <Button
              variant="outline"
              onClick={test}
              disabled={testing || !config.activeProfileId}
            >
              {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {" "}
              {activeProfile?.providerType === "google-cloud"
                ? "Test Vertex + Vision OCR"
                : "Test selected visual provider"}
            </Button>
          </div>
          {activeProfile?.providerType === "google-cloud" &&
            status?.connectorTestEstimateUsd && (
            <p className="text-xs text-muted-foreground">
              The synthetic test sends a generated 1×1 PNG to Vertex AI and
              Cloud Vision EU OCR. It reserves at most ${status
                .connectorTestEstimateUsd.vertexAndVision.toFixed(4)}.
              {google?.documentAiProcessorId && (
                <>
                  {" "}With the optional Document AI test, the maximum is
                  ${status.connectorTestEstimateUsd.withDocumentAi.toFixed(4)}.
                </>
              )} No user photo is used.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
