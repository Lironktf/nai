import { useState } from "react";
import { View, Text, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import WebView from "react-native-webview";

import { PrimaryButton } from "../components/PrimaryButton";
import { api } from "../lib/api";

type Step =
  | "idle"
  | "validating"
  | "liveness_loading"
  | "liveness_webview"
  | "finalizing"
  | "done"
  | "error";

export default function TelegramAuthScreen() {
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [livenessSessionId, setLivenessSessionId] = useState<string | null>(
    null,
  );
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [participantLabel, setParticipantLabel] = useState<string | null>(null);

  async function beginAuth() {
    const normalizedCode = code.trim().toUpperCase();
    if (normalizedCode.length !== 4) {
      setError("Enter the 4-character code from Telegram.");
      return;
    }

    setError("");
    setStep("validating");
    try {
      const info = await api.telegramStartAuth(normalizedCode);
      setParticipantLabel(
        info.displayName ||
          (info.telegramUsername ? `@${info.telegramUsername}` : null),
      );
      setStep("liveness_loading");
      const { livenessSessionId: id } = await api.telegramLivenessStart();
      setLivenessSessionId(id);
      setCode(normalizedCode);
      setStep("liveness_webview");
    } catch (err: any) {
      setError(err.message || "Could not start Telegram authentication");
      setStep("error");
    }
  }

  async function handleLivenessComplete() {
    if (!livenessSessionId) return;

    setStep("finalizing");
    try {
      const result = await api.telegramCompleteAuth(code, livenessSessionId);
      setExpiresAt(result.verificationExpiresAt ?? null);
      setStep("done");
    } catch (err: any) {
      setError(err.message || "Telegram authentication failed");
      setStep("error");
    }
  }

  if (step === "liveness_webview" && livenessSessionId) {
    const livenessUrl =
      `${process.env.EXPO_PUBLIC_API_URL}/liveness` +
      `?sessionId=${livenessSessionId}` +
      `&identityPoolId=${encodeURIComponent(process.env.EXPO_PUBLIC_COGNITO_IDENTITY_POOL_ID ?? "")}` +
      `&region=${process.env.EXPO_PUBLIC_AWS_REGION ?? "us-east-1"}`;

    return (
      <View style={{ flex: 1 }}>
        <WebView
          source={{ uri: livenessUrl }}
          style={{ flex: 1 }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data.done) {
                handleLivenessComplete();
              } else if (data.error) {
                setError(data.error);
                setStep("error");
              }
            } catch {
              setError("Invalid liveness callback");
              setStep("error");
            }
          }}
          onError={(e) => {
            setError(`Liveness page failed: ${e.nativeEvent.description}`);
            setStep("error");
          }}
        />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 pt-8 pb-10 justify-between">
        <View className="gap-5">
          <Text className="text-ink text-3xl font-bold">Telegram Auth</Text>
          <Text className="text-muted text-base">
            Generate a 4-character code in Telegram, then paste it here to
            verify for that group session.
          </Text>

          {(step === "idle" || step === "validating" || step === "error") && (
            <View>
              <Text className="text-ink text-sm font-medium mb-2">
                Telegram Code
              </Text>
              <TextInput
                value={code}
                onChangeText={(value) =>
                  setCode(
                    value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 4),
                  )
                }
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="A7KQ"
                placeholderTextColor="#9CA3AF"
                className="bg-surface border border-border rounded-xl px-4 py-4 text-ink text-base font-mono tracking-[0.3em]"
              />
            </View>
          )}

          {participantLabel && step !== "idle" && (
            <Text className="text-muted text-sm">
              Authenticating for {participantLabel}
            </Text>
          )}

          {(step === "validating" ||
            step === "liveness_loading" ||
            step === "finalizing") && (
            <View className="items-center mt-6">
              <ActivityIndicator size="large" color="#1A3A5C" />
              <Text className="text-muted text-base mt-3">
                {step === "validating" && "Checking code..."}
                {step === "liveness_loading" &&
                  "Preparing liveness challenge..."}
                {step === "finalizing" && "Finalizing Telegram verification..."}
              </Text>
            </View>
          )}

          {step === "done" && (
            <View className="bg-success/10 rounded-xl p-4">
              <Text className="text-success text-base font-semibold mb-1">
                Verified
              </Text>
              <Text className="text-muted text-sm">
                {expiresAt
                  ? `Valid until ${new Date(expiresAt).toLocaleTimeString()}`
                  : "Verification completed."}
              </Text>
            </View>
          )}

          {step === "error" && (
            <View className="bg-red-50 rounded-xl p-4">
              <Text className="text-red-500 text-sm">{error}</Text>
            </View>
          )}
        </View>

        <View className="gap-3">
          {(step === "idle" || step === "error") && (
            <PrimaryButton
              label={step === "error" ? "Try Again" : "Start Authentication"}
              onPress={beginAuth}
            />
          )}

          {(step === "done" || step === "error") && (
            <PrimaryButton
              label="Back to Home"
              variant="ghost"
              onPress={() => router.replace("/home")}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
