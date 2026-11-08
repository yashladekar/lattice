import "@/global.css";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { HeroUINativeProvider, useThemeColor } from "heroui-native";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StatusBar } from "expo-status-bar";

import { NativeAuthScreen } from "@/components/native-auth-screen";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { OutboxProvider } from "@/contexts/outbox-context";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { authClient } from "@/lib/auth-client";
import { registerDevice } from "@/lib/device";
import { QUERY_CACHE_MAX_AGE, queryPersister } from "@/lib/query-cache";
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
      <Stack.Screen
        name="canvas/[id]"
        options={{
          title: "Canvas",
          headerShown: false,
          contentStyle: { backgroundColor: background },
        }}
      />
      <Stack.Screen
        name="notifications"
        options={{
          title: "Notifications",
          headerShown: false,
          presentation: "modal",
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
  const accent = useThemeColor("accent");

  useEffect(() => {
    if (session?.user?.id) void registerDevice();
  }, [session?.user?.id]);

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={accent} />
        <Text className="mt-3 text-xs text-muted">Opening Lattice…</Text>
      </View>
    );
  }

  if (!session?.user) {
    return <NativeAuthScreen />;
  }

  return (
    <WorkspaceProvider>
      <OutboxProvider>
        <RootStack />
      </OutboxProvider>
    </WorkspaceProvider>
  );
}

export default function Layout() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: QUERY_CACHE_MAX_AGE,
        buster: "v1",
      }}
    >
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
    </PersistQueryClientProvider>
  );
}
