import { useEffect, useState } from "react";
import { callResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key, Plus, Copy, Check, Edit2, Save, X } from "lucide-react";
import { ObjectId } from "bson";

interface ApiKey {
  _id: ObjectId;
  name: string;
  owner: string;
  openPrefix: string;
  isActive: boolean;
  createdAt: Date;
  policiesYaml: string;
}

const defaultPolicyYaml = `- resource: "**"
  action: "**"
  effect: allow`;

const APIKeysPage = () => {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyOwner, setNewKeyOwner] = useState("system");
  const [newKeyPolicies, setNewKeyPolicies] = useState(defaultPolicyYaml);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<{ clientId: string; apiKey: string } | null>(null);
  const [copiedClientId, setCopiedClientId] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editedPolicies, setEditedPolicies] = useState<string>("");
  const [updating, setUpdating] = useState(false);

  const fetchApiKeys = async () => {
    try {
      setLoading(true);
      const result = await callResource("apikeys", {
        action: "list",
      });
      setApiKeys(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch API keys",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      setError("Name is required");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const result = await callResource("apikeys", {
        action: "create",
        name: newKeyName,
        owner: newKeyOwner,
        policiesYaml: newKeyPolicies,
      });

      setCreatedKey({ clientId: result.clientId, apiKey: result.apiKey });
      setNewKeyName("");
      setNewKeyPolicies(defaultPolicyYaml);
      await fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string, owner: string) => {
    if (!confirm("Are you sure you want to revoke this API key?")) {
      return;
    }

    try {
      await callResource("apikeys", {
        action: "revoke",
        id,
        owner,
      });
      await fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API key");
    }
  };

  const handleStartEdit = (key: ApiKey) => {
    setEditingKeyId(key._id.toString());
    setEditedPolicies(key.policiesYaml);
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingKeyId(null);
    setEditedPolicies("");
    setError(null);
  };

  const handleUpdate = async (id: string, owner: string) => {
    setUpdating(true);
    setError(null);

    try {
      await callResource("apikeys", {
        action: "update",
        id,
        owner,
        policiesYaml: editedPolicies,
      });
      setEditingKeyId(null);
      setEditedPolicies("");
      await fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update API key policies");
    } finally {
      setUpdating(false);
    }
  };

  const copyToClipboard = async (text: string, type: 'clientId' | 'secret') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'clientId') {
        setCopiedClientId(true);
        setTimeout(() => setCopiedClientId(false), 2000);
      } else {
        setCopiedSecret(true);
        setTimeout(() => setCopiedSecret(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-2">API Keys</h2>
          <p className="text-muted-foreground">
            Manage API keys and their access policies.
          </p>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading API keys...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold mb-2">API Keys</h2>
          <p className="text-muted-foreground">
            Manage API keys and their access policies.
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)}>
          <Plus className="w-4 h-4 mr-2" />
          Create API Key
        </Button>
      </div>

      {error && (
        <div className="border border-red-500 rounded-lg p-4 bg-red-50 dark:bg-red-950">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {createdKey && (
        <Card className="p-6 border-green-500 bg-green-50 dark:bg-green-950">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Key className="w-5 h-5 text-green-600 dark:text-green-400" />
              <h3 className="font-semibold text-green-900 dark:text-green-100">
                API Key Created Successfully
              </h3>
            </div>
            <p className="text-sm text-green-700 dark:text-green-300">
              Save these credentials securely. You won't be able to see the secret again.
            </p>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold text-green-800 dark:text-green-200">
                  Client ID
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={createdKey.clientId}
                    readOnly
                    className="font-mono text-sm bg-white dark:bg-gray-900"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(createdKey.clientId, 'clientId')}
                  >
                    {copiedClientId ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-semibold text-green-800 dark:text-green-200">
                  Client Secret (API Key)
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={createdKey.apiKey}
                    readOnly
                    className="font-mono text-sm bg-white dark:bg-gray-900"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(createdKey.apiKey, 'secret')}
                  >
                    {copiedSecret ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreatedKey(null)}
            >
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      {showCreateForm && (
        <Card className="p-6">
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Create New API Key</h3>

            <div className="space-y-2">
              <Label htmlFor="keyName">Name</Label>
              <Input
                id="keyName"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="My API Key"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="keyOwner">Owner</Label>
              <Input
                id="keyOwner"
                value={newKeyOwner}
                onChange={(e) => setNewKeyOwner(e.target.value)}
                placeholder="system"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="policies">Policies</Label>
              <textarea
                id="policies"
                value={newKeyPolicies}
                onChange={(e) => setNewKeyPolicies(e.target.value)}
                className="flex min-h-[200px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={defaultPolicyYaml}
              />
              <p className="text-xs text-muted-foreground">
                Define access policies in YAML format.
              </p>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? "Creating..." : "Create Key"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Existing API Keys</h3>
        {apiKeys.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <Key className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">
              No API keys yet. Create one to get started.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {apiKeys.map((key) => (
              <Card key={key._id.toString()} className="p-3">
                <details className="group" open={editingKeyId === key._id.toString()}>
                  <summary className="list-none cursor-pointer">
                    <div className="flex items-center gap-2">
                      {/* Name column - fixed width */}
                      <div className="w-[160px] shrink-0 truncate">
                        <h3 className="font-semibold text-sm truncate">{key.name}</h3>
                      </div>

                      {/* ID column - fixed width */}
                      <div className="w-[120px] shrink-0 flex items-center gap-1 text-xs">
                        <span className="text-muted-foreground">ID:</span>
                        <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded truncate">
                          {key._id.toString().slice(0, 8)}...
                        </code>
                      </div>

                      {/* Secret column - fixed width */}
                      <div className="w-[160px] shrink-0 flex items-center gap-1 text-xs">
                        <span className="text-muted-foreground">Secret:</span>
                        <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded truncate">
                          {key.openPrefix}...
                        </code>
                      </div>

                      {/* Owner column - fixed width */}
                      <div className="w-[80px] shrink-0 flex items-center gap-1 text-xs">
                        <span className="text-muted-foreground">Owner:</span>
                        <span className="truncate">{key.owner}</span>
                      </div>

                      {/* Date column - fixed width */}
                      <div className="w-[90px] shrink-0 text-xs text-muted-foreground">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </div>

                      {/* Spacer */}
                      <div className="flex-1" />

                      {/* Details toggle - fixed width */}
                      <div className="w-[60px] shrink-0">
                        <span className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                          <span className="group-open:hidden">▶</span>
                          <span className="hidden group-open:inline">▼</span>
                          Details
                        </span>
                      </div>

                      {/* Action column - fixed width */}
                      <div className="w-[70px] shrink-0 flex justify-end">
                        {key.isActive ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRevoke(key._id.toString(), key.owner);
                            }}
                            title="Revoke this API key"
                          >
                            Revoke
                          </Button>
                        ) : (
                          <span className="inline-flex items-center justify-center h-7 px-2 text-[11px] rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                            Revoked
                          </span>
                        )}
                      </div>
                    </div>
                  </summary>

                  {/* Expandable policies section */}
                  <div className="pt-2 mt-2 border-t">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground">Policies</span>
                      {key.isActive && editingKeyId !== key._id.toString() && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(key);
                          }}
                          title="Edit policies"
                        >
                          <Edit2 className="w-3 h-3 mr-1" />
                          Edit
                        </Button>
                      )}
                    </div>
                    {editingKeyId === key._id.toString() ? (
                      <div className="space-y-2">
                        <textarea
                          value={editedPolicies}
                          onChange={(e) => setEditedPolicies(e.target.value)}
                          className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs shadow-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          placeholder={defaultPolicyYaml}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdate(key._id.toString(), key.owner);
                            }}
                            disabled={updating}
                          >
                            <Save className="w-3 h-3 mr-1" />
                            {updating ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelEdit();
                            }}
                            disabled={updating}
                          >
                            <X className="w-3 h-3 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <pre className="p-2 bg-muted rounded text-[11px] font-mono overflow-x-auto">
                        {key.policiesYaml}
                      </pre>
                    )}
                  </div>
                </details>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default APIKeysPage;
