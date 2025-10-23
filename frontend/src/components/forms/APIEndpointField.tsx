import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface APIEndpointFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function APIEndpointField({ value, onChange }: APIEndpointFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="apiEndpoint">API Endpoint</Label>
      <Input
        id="apiEndpoint"
        type="url"
        placeholder="http://localhost:8000"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        The base URL of your Mycelia backend server
      </p>
    </div>
  );
}
