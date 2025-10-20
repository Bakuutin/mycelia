import React from "react";
import { Input } from "@/components/ui/input.tsx";

export interface CategoryInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'list'> {
  categories: string[];
  listId?: string;
}

export const CategoryInput: React.FC<CategoryInputProps> = ({
  categories,
  listId = "category-options",
  ...props
}) => {
  return (
    <>
      <Input list={listId} {...props} />
      <datalist id={listId}>
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </>
  );
};
