import "@/global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { HeroUINativeProvider, useThemeColor } from "heroui-native";
import { ActivityIndicator, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StatusBar } from "expo-status-bar";

import { NativeAuthScreen } from "@/components/native-auth-screen";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";

export const unstable_settings = {
  anchor: "(drawer)",
};

function RootStack() {
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const border = useThemeColor("border");

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: background },
        headerTintColor: foreground,
        headerTitleStyle: { color: foreground, fontWeight: "600" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
      <Stack.Screen
        name="page/[id]"
        options={{
          title: "Note",
          headerShown: true,
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: background },
          headerTintColor: foreground,
          headerShadowVisible: false,
        }}
      />
    </Stack>
  );
}

function AppRoot() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#e8892f" />
        <Text className="mt-3 text-xs text-muted">Opening Lattice…</Text>
      </View>
    );
  }

  if (!session?.user) {
    return <NativeAuthScreen />;
  }

  return (
    <WorkspaceProvider>
      <RootStack />
    </WorkspaceProvider>
  );
}

export default function Layout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <HeroUINativeProvider>
              <StatusBar style="auto" />
              <AppRoot />
            </HeroUINativeProvider>
          </AppThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
