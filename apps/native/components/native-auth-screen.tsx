import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SignIn } from "./sign-in";
import { SignUp } from "./sign-up";

export function NativeAuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="px-5"
      >
        <View className="mx-auto w-full max-w-md">
          <View className="mb-8 items-center">
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-neutral-900">
              <Text className="text-2xl text-amber-50">✦</Text>
            </View>
            <Text className="mt-5 text-3xl font-semibold tracking-tight text-foreground">lattice</Text>
            <Text className="mt-2 text-center text-sm leading-6 text-muted">
              Your knowledge, connected. A local-first companion for capture, reading, and review.
            </Text>
          </View>

          <View className="mb-4 flex-row rounded-xl border border-border bg-surface-secondary p-1">
            {(
              [
                ["signin", "Sign in"],
                ["signup", "Create account"],
              ] as const
            ).map(([value, label]) => (
              <Text
                key={value}
                onPress={() => setMode(value)}
                className={`flex-1 rounded-lg py-2 text-center text-xs font-medium ${
                  mode === value ? "bg-surface text-foreground" : "text-muted"
                }`}
              >
                {label}
              </Text>
            ))}
          </View>

          {mode === "signin" ? <SignIn /> : <SignUp />}

          <View className="mt-8 flex-row items-center justify-center gap-4">
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="shield-checkmark-outline" size={13} color="#6b9a80" />
              <Text className="text-xs text-muted">Secure sync</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="phone-portrait-outline" size={13} color="#6b9a80" />
              <Text className="text-xs text-muted">Offline on device</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
