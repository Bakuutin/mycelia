import React from "react";
import { Label } from "@/components/ui/label.tsx";

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  error,
  children,
  required = false
}) => {
  return (
    <div className="grid grid-cols-4 items-center gap-4">
      <Label htmlFor={htmlFor} className="text-right">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      <div className="col-span-3">
        {children}
        {error && (
          <p id={`${htmlFor}-error`} className="text-xs text-red-500 mt-1">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};
