import { Text, View, type ViewProps } from "react-native";

export function Section({
  title,
  action,
  children,
  ...props
}: ViewProps & { title?: string; action?: React.ReactNode }) {
  return (
    <View className="mt-6" {...props}>
      {title || action ? (
        <View className="mb-2 flex-row items-center justify-between">
          {title ? (
            <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              {title}
            </Text>
          ) : (
            <View />
          )}
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <View className="flex-1 rounded-2xl border border-border bg-surface p-3">
      <Text className="text-lg font-semibold text-foreground">{value}</Text>
      <Text className="text-[9px] uppercase tracking-wider text-muted">{label}</Text>
    </View>
  );
}
