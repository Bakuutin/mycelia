import React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose } from "@/components/ui/sheet.tsx";
import { Button } from "@/components/ui/button.tsx";

export interface EntityEditSheetProps<T> {
  entity: T | null;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function EntityEditSheet<T>({
  entity,
  title,
  onClose,
  children,
}: EntityEditSheetProps<T>) {
  return (
    <Sheet open={!!entity} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        {children}
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
