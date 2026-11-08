import { BottomSheet } from "heroui-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { View } from "react-native";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  snapPoints?: string[];
  scroll?: boolean;
  detached?: boolean;
};

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  snapPoints,
  scroll = true,
  detached,
}: Props) {
  return (
    <BottomSheet isOpen={open} onOpenChange={onOpenChange}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          detached={detached}
          {...(snapPoints
            ? {
                snapPoints,
                enableOverDrag: false,
                enableDynamicSizing: false,
                contentContainerClassName: "h-full",
              }
            : {})}
        >
          <BottomSheet.Close />
          {title ? <BottomSheet.Title>{title}</BottomSheet.Title> : null}
          {scroll ? (
            <BottomSheetScrollView
              contentContainerStyle={{ paddingBottom: 28, paddingHorizontal: 16 }}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </BottomSheetScrollView>
          ) : (
            <View className="px-4 pb-6">{children}</View>
          )}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
