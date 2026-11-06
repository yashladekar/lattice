"use client";

import { Button } from "@notes-learning/ui/components/button";
import { Input } from "@notes-learning/ui/components/input";
import { Label } from "@notes-learning/ui/components/label";
import { useEffect, useId, useState } from "react";

import { Modal } from "@/components/ui/modal";

/**
 * A styled replacement for window.prompt: one labelled field, a hint, inline
 * validation, Enter to confirm, Cancel and Escape to leave.
 */
export function PromptDialog({
  open,
  title,
  description,
  label,
  placeholder,
  defaultValue = "",
  confirmLabel = "Insert",
  validate,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setError(null);
    }
  }, [open, defaultValue]);

  const submit = () => {
    const trimmed = value.trim();
    const message = validate ? validate(trimmed) : trimmed ? null : `Enter ${label.toLowerCase()}.`;
    if (message) {
      setError(message);
      return;
    }
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-9 rounded-lg px-3 text-xs" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-9 rounded-lg px-3 text-xs" onClick={submit}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor={fieldId}>{label}</Label>
        <Input
          id={fieldId}
          autoFocus
          value={value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        {error ? (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
