import React from "react";
import { Input } from "@/components/ui/input.tsx";

interface ColorInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const ColorInput: React.FC<ColorInputProps> = (props) => {
  return (
    <div className="flex items-center gap-3">
      <Input type="color" className="h-9 w-14 p-1" {...props} />
    </div>
  );
};
