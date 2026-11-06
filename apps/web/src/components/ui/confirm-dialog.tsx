"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@notes-learning/ui/components/button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-8" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 bg-destructive/10 text-destructive hover:bg-destructive/20"
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        This keeps the data recoverable — nothing is purged instantly.
      </p>
    </Modal>
  );
}
