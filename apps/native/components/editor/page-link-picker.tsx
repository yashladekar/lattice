import { Input } from "heroui-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Sheet } from "@/components/ui/sheet";
import { usePages } from "@/hooks/use-workspace-data";

export function PageLinkPicker({
  open,
  onOpenChange,
  onSelect,
  title = "Link a page",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (pageId: string, pageTitle: string) => void;
  title?: string;
}) {
  const pages = usePages();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (pages.data ?? [])
      .filter((page) => !needle || page.title.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [pages.data, query]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <View className="mt-3">
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search pages…"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <View className="mt-3 gap-1">
        {results.map((page) => (
          <Pressable
            key={page.id}
            onPress={() => {
              onSelect(page.id, page.title);
              onOpenChange(false);
            }}
            className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            <Text className="text-sm">{page.icon ?? "◇"}</Text>
            <Text numberOfLines={1} className="min-w-0 flex-1 text-[13px] text-foreground">
              {page.title}
            </Text>
          </Pressable>
        ))}
        {!results.length ? (
          <Text className="py-6 text-center text-[11px] text-muted">No pages match.</Text>
        ) : null}
      </View>
    </Sheet>
  );
}
