import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { toLocalDateTime } from './DateTimeInput';

interface SmartDateInputProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  id?: string;
  className?: string;
}

function parseSmartDate(input: string): Date | null {
  const trimmed = input.trim();

  if (!trimmed) return null;

  const numericOnly = /^\d+$/.test(trimmed);
  if (numericOnly) {
    const num = parseInt(trimmed, 10);

    if (num < 10000000000) {
      return new Date(num * 1000);
    }

    if (num < 100000000000000) {
      return new Date(num);
    }
  }

  try {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export const SmartDateInput: React.FC<SmartDateInputProps> = ({
  value,
  onChange,
  id,
  className,
}) => {
  const [inputValue, setInputValue] = useState(value ? toLocalDateTime(value) : '');
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    if (value) {
      setInputValue(toLocalDateTime(value));
      setIsValid(true);
    } else {
      setInputValue('');
      setIsValid(true);
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);

    if (!newValue.trim()) {
      setIsValid(true);
      onChange(null);
      return;
    }

    const parsed = parseSmartDate(newValue);
    if (parsed) {
      setIsValid(true);
      onChange(parsed);
      setTimeout(() => {
        setInputValue(toLocalDateTime(parsed));
      }, 500);
    } else {
      setIsValid(false);
    }
  };

  const handleBlur = () => {
    if (!inputValue.trim()) {
      setIsValid(true);
      return;
    }

    const parsed = parseSmartDate(inputValue);
    if (parsed) {
      setInputValue(toLocalDateTime(parsed));
      setIsValid(true);
    } else {
      setIsValid(false);
    }
  };

  return (
    <div className="space-y-1">
      <Input
        id={id}
        type="text"
        value={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        className={`${className || ''} ${!isValid ? 'border-red-500' : ''}`}
        placeholder="ISO, timestamp, or datetime"
      />
      {!isValid && (
        <p className="text-xs text-red-500">
          Invalid date format. Try: ISO string, Unix timestamp, or YYYY-MM-DDTHH:mm
        </p>
      )}
    </div>
  );
};
