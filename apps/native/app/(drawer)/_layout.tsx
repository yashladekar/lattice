import { Drawer } from "expo-router/drawer";
import { useThemeColor } from "heroui-native";
import { useWindowDimensions } from "react-native";

import { Sidebar } from "@/components/nav/sidebar";

export default function DrawerLayout() {
  const { width } = useWindowDimensions();
  const background = useThemeColor("background");
  const border = useThemeColor("border");
  const tablet = width >= 900;

  return (
    <Drawer
      drawerContent={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: tablet ? "permanent" : "front",
        drawerStyle: {
          width: tablet ? 300 : 288,
          backgroundColor: background,
          borderRightColor: border,
          borderRightWidth: 1,
        },
        overlayColor: "rgba(0,0,0,0.35)",
        swipeEdgeWidth: 56,
        swipeMinDistance: 24,
        sceneStyle: { backgroundColor: background },
      }}
    >
      <Drawer.Screen name="(tabs)" options={{ title: "Lattice" }} />
      <Drawer.Screen name="inbox" options={{ title: "Inbox" }} />
      <Drawer.Screen name="canvases" options={{ title: "Canvases" }} />
      <Drawer.Screen name="graph" options={{ title: "Knowledge graph" }} />
      <Drawer.Screen name="assistant" options={{ title: "Assistant" }} />
      <Drawer.Screen name="timeline" options={{ title: "Timeline" }} />
      <Drawer.Screen name="templates" options={{ title: "Templates" }} />
      <Drawer.Screen name="trash" options={{ title: "Trash" }} />
      <Drawer.Screen name="settings" options={{ title: "Settings" }} />
    </Drawer>
  );
}
