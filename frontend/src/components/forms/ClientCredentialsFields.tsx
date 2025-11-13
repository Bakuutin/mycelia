import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ClientCredentialsFieldsProps {
  clientId: string;
  clientSecret: string;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
}

export function ClientCredentialsFields({
  clientId,
  clientSecret,
  onClientIdChange,
  onClientSecretChange,
}: ClientCredentialsFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="clientId">Client ID</Label>
        <Input
          id="clientId"
          type="text"
          placeholder="MongoDB ObjectId"
          value={clientId}
          onChange={(e) => onClientIdChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          The ObjectId of your API key (logged when token is created)
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="clientSecret">Client Secret</Label>
        <Input
          id="clientSecret"
          type="password"
          placeholder="mycelia_..."
          value={clientSecret}
          onChange={(e) => onClientSecretChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Your API key (starts with mycelia_)
        </p>
      </div>
    </div>
  );
}
