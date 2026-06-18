import React, { useState, useEffect } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Heading,
  Badge,
  IconButton,
  Divider,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Select,
  Spinner,
  useToast,
  Button,
  Input,
  InputGroup,
  InputRightElement,
  Textarea,
  Switch,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  UnorderedList,
  ListItem,
} from "@chakra-ui/react";
import {
  EditIcon,
  CheckIcon,
  CloseIcon,
  ViewIcon,
  ViewOffIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@chakra-ui/icons";
import { StorageAPI } from "../../storage/StorageAPI";
import { GlobalSettings, DEFAULT_GLOBAL_SETTINGS } from "../../types/storage";
import { TTSService } from "../../tts/TTSService";
import {
  TTSKeyStorage,
  TTSSettings,
  TTSTagConfig,
} from "../../tts/TTSKeyStorage";
import { t } from "../../utils/i18n";

export const SettingsTab: React.FC = () => {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Default cooldown editing state
  const [editingCooldown, setEditingCooldown] = useState(false);
  const [tempDefaultCooldown, setTempDefaultCooldown] = useState(
    DEFAULT_GLOBAL_SETTINGS.defaultCooldownPeriod,
  );

  // Daily goal editing state
  const [editingDailyGoal, setEditingDailyGoal] = useState(false);
  const [tempDailyGoal, setTempDailyGoal] = useState(
    DEFAULT_GLOBAL_SETTINGS.dailyGoal,
  );

  // Storage usage state
  const [storageUsage, setStorageUsage] = useState<{
    used: number;
    available: number;
    percentage: number;
    nearLimit: boolean;
  } | null>(null);
  const [storageStatus, setStorageStatus] = useState<{
    usage: number;
    available: number;
    percentage: number;
    status: "safe" | "warning" | "critical" | "exceeded";
    recommendations: string[];
  } | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);

  // TTS settings state
  const [ttsSettings, setTtsSettings] = useState<TTSSettings | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [testVoiceText, setTestVoiceText] = useState(
    "Welcome to Rekapu. This is how your text-to-speech will sound.",
  );
  const [testLanguage, setTestLanguage] = useState("en-US");
  const [testVoice, setTestVoice] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [availableVoices, setAvailableVoices] = useState<any[]>([]);
  const [availableLanguages, setAvailableLanguages] = useState<
    Array<{ code: string; name: string }>
  >([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [enabledTags, setEnabledTags] = useState<string[]>([]);
  const [cacheStats, setCacheStats] = useState<any>(null);

  // Per-tag configuration state
  const [expandedTag, setExpandedTag] = useState<string | null>(null);
  const [tagConfigs, setTagConfigs] = useState<{ [tag: string]: TTSTagConfig }>(
    {},
  );
  const [tagVoices, setTagVoices] = useState<{ [tag: string]: any[] }>({});

  const toast = useToast();

  const ttsService = TTSService.getInstance();
  const ttsKeyStorage = TTSKeyStorage.getInstance();

  // Material dark theme colors
  const bgColor = "#202124";
  const bgTertiary = "#35363a";
  const borderColor = "#3c4043";
  const textPrimary = "#e8eaed";
  const textSecondary = "#9aa0a6";
  const textTertiary = "#5f6368";

  useEffect(() => {
    loadSettings();
    loadStorageData();
    loadTTSSettings();
    loadTags();
  }, []);

  // Auto-load voices when model changes
  useEffect(() => {
    if (selectedModel) {
      loadAvailableVoices();
    }
  }, [selectedModel, testLanguage]);

  // Auto-select first voice when available voices change
  useEffect(() => {
    if (availableVoices.length > 0) {
      const filteredVoices = availableVoices.filter(
        (voice) => !selectedModel || voice.model === selectedModel,
      );
      if (filteredVoices.length > 0 && testVoice !== filteredVoices[0].id) {
        setTestVoice(filteredVoices[0].id);
      }
    }
  }, [availableVoices, selectedModel]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const result = await StorageAPI.getGlobalSettings();
      if (result.success && result.data) {
        setSettings(result.data);
        setTempDefaultCooldown(result.data.defaultCooldownPeriod);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      toast({
        title: t("error"),
        description: t("failedToUpdateSettings"),
        status: "error",
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadStorageData = async () => {
    try {
      setStorageLoading(true);

      const [usageResult, statusResult] = await Promise.all([
        StorageAPI.getStorageUsage(),
        StorageAPI.checkQuotaStatus(),
      ]);

      if (usageResult.success) {
        setStorageUsage(usageResult.data!);
      }

      if (statusResult.success) {
        setStorageStatus(statusResult.data!);
      }
    } catch (error) {
      console.error("Failed to load storage data:", error);
    } finally {
      setStorageLoading(false);
    }
  };

  const handleSaveDefaultCooldown = async () => {
    if (!settings) return;

    try {
      const result = await StorageAPI.updateGlobalSettings({
        ...settings,
        defaultCooldownPeriod: tempDefaultCooldown,
      });

      if (result.success) {
        setSettings(result.data!);
        setEditingCooldown(false);
        toast({
          title: t("settingsUpdated"),
          description: t("defaultCooldownSet", String(tempDefaultCooldown)),
          status: "success",
          duration: 3000,
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: t("error"),
        description: t("failedToUpdateSettings"),
        status: "error",
        duration: 3000,
      });
    }
  };

  const handleCancelCooldownEdit = () => {
    setTempDefaultCooldown(
      settings?.defaultCooldownPeriod ||
        DEFAULT_GLOBAL_SETTINGS.defaultCooldownPeriod,
    );
    setEditingCooldown(false);
  };

  const handleSaveDailyGoal = async () => {
    if (!settings) return;

    try {
      const result = await StorageAPI.updateGlobalSettings({
        ...settings,
        dailyGoal: tempDailyGoal,
      });

      if (result.success) {
        setSettings(result.data!);
        setEditingDailyGoal(false);
        toast({
          title: t("settingsUpdated"),
          description: t("dailyGoalUpdated", String(tempDailyGoal)),
          status: "success",
          duration: 3000,
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: t("error"),
        description: t("failedToUpdateSettings"),
        status: "error",
        duration: 3000,
      });
    }
  };

  const handleCancelDailyGoalEdit = () => {
    setTempDailyGoal(settings?.dailyGoal || DEFAULT_GLOBAL_SETTINGS.dailyGoal);
    setEditingDailyGoal(false);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getStorageStatusColor = (status: string) => {
    switch (status) {
      case "safe":
        return "#81C995";
      case "warning":
        return "#FCC934";
      case "critical":
        return "#F8A070";
      case "exceeded":
        return "#F28B82";
      default:
        return textSecondary;
    }
  };

  const loadTTSSettings = async () => {
    try {
      const settings = await ttsKeyStorage.getSettings();

      if (settings) {
        setTtsSettings(settings);
        // Don't pre-fill the API key input - only track if it exists
        const hasKey = !!settings.keys[settings.provider];
        setHasApiKey(hasKey);
        setApiKeyInput(""); // Always start with empty input
        setShowApiKey(false); // Reset show state
        setEnabledTags(settings.enabledTags || []);
        setTagConfigs(settings.tagConfigs || {});

        // Load available languages if API key exists
        if (hasKey) {
          await loadAvailableLanguages();
        }
      }

      const stats = await ttsService.getCacheStatistics();
      setCacheStats(stats);
    } catch (error) {
      console.error("Failed to load TTS settings:", error);
    }
  };

  const loadTags = async () => {
    try {
      const result = await StorageAPI.getAllUniqueTagNames();
      if (result.success && result.data) {
        setAllTags(result.data);
      }
    } catch (error) {
      console.error("Failed to load tags:", error);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) {
      toast({
        title: t("error"),
        description: t("enterApiKeyError"),
        status: "error",
        duration: 3000,
      });
      return;
    }

    setTtsLoading(true);
    try {
      console.log("Validating Google TTS API key...");
      const isValid = await ttsService.validateApiKey("google", apiKeyInput);

      if (!isValid) {
        toast({
          title: t("invalidApiKey"),
          description: t("invalidApiKeyDesc"),
          status: "error",
          duration: 10000,
        });
        return;
      }

      await ttsKeyStorage.saveApiKey("google", apiKeyInput);

      await loadTTSSettings();
      await loadAvailableLanguages();

      // Clear input after successful save - we don't display saved keys
      setApiKeyInput("");
      setShowApiKey(false);

      toast({
        title: t("apiKeySaved"),
        description: t("apiKeySavedDesc"),
        status: "success",
        duration: 5000,
      });
    } catch (error) {
      toast({
        title: t("error"),
        description: t("failedToSaveApiKey"),
        status: "error",
        duration: 3000,
      });
    } finally {
      setTtsLoading(false);
    }
  };

  const loadAvailableLanguages = async () => {
    try {
      // Fetch all voices without language filter to get all languages
      const allVoices = await ttsService.getAvailableVoices();

      // Extract unique language codes
      const languageMap = new Map<string, string>();
      allVoices.forEach((voice: any) => {
        if (voice.languageCode && !languageMap.has(voice.languageCode)) {
          // Create a readable name from language code
          const displayName =
            new Intl.DisplayNames(["en"], { type: "language" }).of(
              voice.languageCode.split("-")[0],
            ) || voice.languageCode;
          const region = voice.languageCode.includes("-")
            ? ` (${voice.languageCode.split("-")[1]})`
            : "";
          languageMap.set(voice.languageCode, `${displayName}${region}`);
        }
      });

      // Convert to sorted array
      const languages = Array.from(languageMap.entries())
        .map(([code, name]) => ({ code, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setAvailableLanguages(languages);
    } catch (error) {
      console.error("Failed to load languages:", error);
    }
  };

  const loadAvailableVoices = async () => {
    setTtsLoading(true);
    try {
      const voices = await ttsService.getAvailableVoices(testLanguage);
      setAvailableVoices(voices);
      if (voices.length > 0 && !testVoice) {
        setTestVoice(voices[0].id);
      }
    } catch (error) {
      console.error("Failed to load voices:", error);
      toast({
        title: t("error"),
        description: t("failedToLoadVoices"),
        status: "error",
        duration: 5000,
      });
    } finally {
      setTtsLoading(false);
    }
  };

  const handleTestVoice = async () => {
    if (!testVoiceText.trim() || !testVoice) {
      toast({
        title: t("error"),
        description: t("enterTestTextAndVoice"),
        status: "error",
        duration: 3000,
      });
      return;
    }

    setIsPlaying(true);

    // Create audio element during user gesture to maintain interaction chain
    const audio = new Audio();
    let audioUrl: string | null = null;

    audio.onended = () => {
      setIsPlaying(false);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };

    audio.onerror = () => {
      setIsPlaying(false);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      toast({
        title: t("playbackError"),
        description: t("failedToPlayAudio"),
        status: "error",
        duration: 3000,
      });
    };

    try {
      // Find the selected voice object to get its model
      const selectedVoice = availableVoices.find((v) => v.id === testVoice);

      if (!selectedVoice) {
        throw new Error("Selected voice not found");
      }

      const result = await ttsService.synthesize({
        text: testVoiceText,
        language: testLanguage,
        voice: selectedVoice.name,
        model: selectedVoice.model,
      });

      if (!result.success || !result.audio) {
        throw new Error(result.error || "Failed to synthesize audio");
      }

      const audioBlob = new Blob([result.audio], { type: "audio/mp3" });
      audioUrl = URL.createObjectURL(audioBlob);
      audio.src = audioUrl;

      await audio.play();

      toast({
        title: result.cached ? t("playingCached") : t("playing"),
        description: result.cached
          ? t("audioFromCache")
          : t("audioSynthesized"),
        status: "success",
        duration: 2000,
      });
    } catch (error) {
      console.error("Voice test failed:", error);

      // Handle browser autoplay restrictions
      if (error instanceof Error && error.name === "NotAllowedError") {
        toast({
          title: t("playbackBlocked"),
          description: t("playbackBlockedDesc"),
          status: "warning",
          duration: 7000,
        });
      } else {
        toast({
          title: t("testFailed"),
          description:
            error instanceof Error ? error.message : t("unknownError"),
          status: "error",
          duration: 5000,
        });
      }

      setIsPlaying(false);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    }
  };

  const handleToggleTag = async (tag: string) => {
    const isEnabling = !enabledTags.includes(tag);
    const newEnabledTags = isEnabling
      ? [...enabledTags, tag]
      : enabledTags.filter((t) => t !== tag);

    setEnabledTags(newEnabledTags);
    await ttsKeyStorage.setEnabledTags(newEnabledTags);

    // If enabling a tag, ensure it has a default config with a valid voice
    if (isEnabling && !tagConfigs[tag]) {
      try {
        // Load voices for the default language
        const defaultLanguage = "en-US";
        const voices = await ttsService.getAvailableVoices(defaultLanguage);

        // Find first Neural2 voice, or fallback to any voice
        const defaultVoice =
          voices.find((v) => v.model === "Neural2") || voices[0];

        if (defaultVoice) {
          const defaultConfig: TTSTagConfig = {
            language: defaultLanguage,
            model: defaultVoice.model || "Neural2",
            voice: defaultVoice.id,
            cardSide: "back",
          };

          setTagConfigs((prev) => ({ ...prev, [tag]: defaultConfig }));
          setTagVoices((prev) => ({ ...prev, [tag]: voices }));
          await ttsKeyStorage.setTagConfig(tag, defaultConfig);

          toast({
            title: "TTS Enabled",
            description: t("tagConfiguredDefaultVoice", tag),
            status: "success",
            duration: 4000,
          });
        }
      } catch (error) {
        console.error("Failed to auto-configure tag:", error);
        toast({
          title: t("warning"),
          description: t("ttsEnabledVoiceNeeded", tag),
          status: "warning",
          duration: 4000,
        });
      }
    }
  };

  const handleEnableAllTags = async () => {
    setEnabledTags(allTags);
    await ttsKeyStorage.setEnabledTags(allTags);
    toast({
      title: t("ttsEnabled"),
      description: t("ttsEnabledAllTags"),
      status: "success",
      duration: 2000,
    });
  };

  const handleDisableAllTags = async () => {
    setEnabledTags([]);
    await ttsKeyStorage.setEnabledTags([]);
    toast({
      title: t("ttsDisabled"),
      description: t("ttsDisabledAllTags"),
      status: "info",
      duration: 2000,
    });
  };

  const handleExpandTag = async (tag: string) => {
    if (expandedTag === tag) {
      setExpandedTag(null);
      return;
    }

    setExpandedTag(tag);

    // Load voices for this tag if not already loaded
    if (!tagVoices[tag]) {
      await loadTagVoices(tag);
    }
  };

  const loadTagVoices = async (tag: string) => {
    try {
      // Use existing config or create default
      const config = tagConfigs[tag] || {
        language: "en-US",
        model: "Neural2",
        voice: "",
        cardSide: "back" as "front" | "back" | "both",
      };

      // If this is a new tag without config, save the default
      if (!tagConfigs[tag]) {
        setTagConfigs((prev) => ({ ...prev, [tag]: config }));
        await ttsKeyStorage.setTagConfig(tag, config);
      }

      const voices = await ttsService.getAvailableVoices(config.language);
      setTagVoices((prev) => ({ ...prev, [tag]: voices }));
    } catch (error) {
      console.error(`Failed to load voices for tag ${tag}:`, error);
    }
  };

  const handleTagConfigChange = async (
    tag: string,
    field: "language" | "model" | "voice" | "cardSide",
    value: string,
  ) => {
    const currentConfig = tagConfigs[tag] || {
      language: "en-US",
      model: "Neural2",
      voice: "",
      cardSide: "back" as "front" | "back" | "both",
    };

    const newConfig = { ...currentConfig, [field]: value };

    // If language or model changes, reset voice and reload voices
    if (field === "language" || field === "model") {
      newConfig.voice = "";
      setTagConfigs((prev) => ({ ...prev, [tag]: newConfig }));
      await loadTagVoices(tag);
    } else {
      setTagConfigs((prev) => ({ ...prev, [tag]: newConfig }));
    }

    // Save to storage
    await ttsKeyStorage.setTagConfig(tag, newConfig);

    toast({
      title: t("saved"),
      description: t("voiceConfigSaved", tag),
      status: "success",
      duration: 2000,
    });
  };

  const handleClearCache = async () => {
    try {
      await ttsService.clearCache();
      await loadTTSSettings();
      toast({
        title: t("cacheCleared"),
        description: t("ttsCacheCleared"),
        status: "success",
        duration: 3000,
      });
    } catch (error) {
      toast({
        title: t("error"),
        description: t("failedToClearCache"),
        status: "error",
        duration: 3000,
      });
    }
  };

  if (loading) {
    return (
      <Box textAlign="center" py={12}>
        <Spinner size="lg" color="#8AB4F8" />
        <Text color={textSecondary} mt={4}>
          {t("loadingSettings")}
        </Text>
      </Box>
    );
  }

  return (
    <VStack spacing={5} align="stretch">
      <Box>
        <Heading size="lg" color={textPrimary} fontWeight="semibold">
          {t("settings")}
        </Heading>
        <Text color={textSecondary} fontSize="sm" mt={1}>
          {t("customizeExperience")}
        </Text>
      </Box>

      <Divider borderColor={borderColor} />

      <VStack spacing={4} align="stretch">
        {/* Default Cooldown Setting */}
        <Box
          p={4}
          bg={bgTertiary}
          borderWidth={1}
          borderColor={borderColor}
          borderRadius="8px"
        >
          <HStack justify="space-between" align="center">
            <VStack align="start" spacing={1} flex={1}>
              <Text color={textPrimary} fontSize="sm" fontWeight="medium">
                {t("defaultCooldownPeriod")}
              </Text>
              <Text color={textSecondary} fontSize="xs">
                {t("timeBeforeAccessDesc")}
              </Text>
            </VStack>

            {editingCooldown ? (
              <HStack spacing={2}>
                <NumberInput
                  value={tempDefaultCooldown}
                  onChange={(_, value) => setTempDefaultCooldown(value || 1)}
                  min={1}
                  max={1440}
                  size="sm"
                  w="80px"
                >
                  <NumberInputField
                    bg={bgColor}
                    borderColor={borderColor}
                    color={textPrimary}
                    fontSize="sm"
                  />
                  <NumberInputStepper>
                    <NumberIncrementStepper borderColor={borderColor} />
                    <NumberDecrementStepper borderColor={borderColor} />
                  </NumberInputStepper>
                </NumberInput>
                <Text color={textSecondary} fontSize="sm">
                  {t("minutes")}
                </Text>
                <IconButton
                  aria-label={t("saveSettings")}
                  icon={<CheckIcon />}
                  size="sm"
                  colorScheme="green"
                  onClick={handleSaveDefaultCooldown}
                />
                <IconButton
                  aria-label={t("cancelEdit")}
                  icon={<CloseIcon />}
                  size="sm"
                  variant="ghost"
                  onClick={handleCancelCooldownEdit}
                />
              </HStack>
            ) : (
              <HStack spacing={2}>
                <Badge
                  variant="outline"
                  borderColor={borderColor}
                  color={textSecondary}
                  fontSize="xs"
                >
                  {settings
                    ? `${settings.defaultCooldownPeriod} ${t("minutes")}`
                    : "..."}
                </Badge>
                <IconButton
                  aria-label={t("editDefaultCooldown")}
                  icon={<EditIcon />}
                  size="sm"
                  variant="ghost"
                  color={textSecondary}
                  _hover={{ color: textPrimary }}
                  onClick={() => setEditingCooldown(true)}
                />
              </HStack>
            )}
          </HStack>
        </Box>

        {/* Daily Goal Setting */}
        <Box
          p={4}
          bg={bgTertiary}
          borderWidth={1}
          borderColor={borderColor}
          borderRadius="8px"
        >
          <HStack justify="space-between" align="center">
            <VStack align="start" spacing={1} flex={1}>
              <Text color={textPrimary} fontSize="sm" fontWeight="medium">
                {t("dailyGoalSetting")}
              </Text>
              <Text color={textSecondary} fontSize="xs">
                {t("dailyGoalDesc")}
              </Text>
            </VStack>

            {editingDailyGoal ? (
              <HStack spacing={2}>
                <NumberInput
                  value={tempDailyGoal}
                  onChange={(_, value) => setTempDailyGoal(value || 1)}
                  min={1}
                  max={100}
                  size="sm"
                  w="80px"
                >
                  <NumberInputField
                    bg={bgColor}
                    borderColor={borderColor}
                    color={textPrimary}
                    fontSize="sm"
                  />
                  <NumberInputStepper>
                    <NumberIncrementStepper borderColor={borderColor} />
                    <NumberDecrementStepper borderColor={borderColor} />
                  </NumberInputStepper>
                </NumberInput>
                <Text color={textSecondary} fontSize="sm">
                  {t("questions")}
                </Text>
                <IconButton
                  aria-label={t("saveSettings")}
                  icon={<CheckIcon />}
                  size="sm"
                  colorScheme="green"
                  onClick={handleSaveDailyGoal}
                />
                <IconButton
                  aria-label={t("cancelEdit")}
                  icon={<CloseIcon />}
                  size="sm"
                  variant="ghost"
                  onClick={handleCancelDailyGoalEdit}
                />
              </HStack>
            ) : (
              <HStack spacing={2}>
                <Badge
                  variant="outline"
                  borderColor={borderColor}
                  color={textSecondary}
                  fontSize="xs"
                >
                  {settings ? `${settings.dailyGoal} ${t("questions")}` : "..."}
                </Badge>
                <IconButton
                  aria-label={t("editDailyGoal")}
                  icon={<EditIcon />}
                  size="sm"
                  variant="ghost"
                  color={textSecondary}
                  _hover={{ color: textPrimary }}
                  onClick={() => setEditingDailyGoal(true)}
                />
              </HStack>
            )}
          </HStack>
        </Box>

        {/* Storage Usage Information */}
        <Box
          p={4}
          bg={bgTertiary}
          borderWidth={1}
          borderColor={borderColor}
          borderRadius="8px"
        >
          <VStack spacing={3} align="stretch">
            <HStack justify="space-between" align="center">
              <VStack align="start" spacing={1} flex={1}>
                <Text color={textPrimary} fontSize="sm" fontWeight="medium">
                  {t("storageUsage")}
                </Text>
                <Text color={textSecondary} fontSize="xs">
                  {t("monitorStorage")}
                </Text>
              </VStack>

              {storageLoading ? (
                <Spinner size="sm" color={textSecondary} />
              ) : storageStatus ? (
                <Badge
                  bg={
                    storageStatus.status === "safe"
                      ? "#1a4a1a"
                      : storageStatus.status === "warning"
                        ? "#4a4419"
                        : "#4a1a1a"
                  }
                  color={getStorageStatusColor(storageStatus.status)}
                  fontSize="xs"
                  px={2}
                  py={1}
                  borderRadius="4px"
                >
                  {t(
                    `storageStatus${storageStatus.status.charAt(0).toUpperCase() + storageStatus.status.slice(1)}`,
                  )}
                </Badge>
              ) : null}
            </HStack>

            {storageUsage && storageStatus && !storageLoading && (
              <VStack spacing={2} align="stretch">
                {/* Storage usage bar */}
                <Box>
                  <HStack justify="space-between" mb={1}>
                    <Text color={textSecondary} fontSize="xs">
                      {t("used", formatBytes(storageUsage.used))}
                    </Text>
                    <Text color={textSecondary} fontSize="xs">
                      {storageUsage.percentage.toFixed(1)}%
                    </Text>
                  </HStack>
                  <Box
                    w="full"
                    h="6px"
                    bg={bgColor}
                    borderRadius="3px"
                    overflow="hidden"
                  >
                    <Box
                      h="full"
                      bg={getStorageStatusColor(storageStatus.status)}
                      borderRadius="3px"
                      width={`${Math.min(storageUsage.percentage, 100)}%`}
                      transition="width 0.3s ease"
                    />
                  </Box>
                  <Text color={textTertiary} fontSize="xs" mt={1}>
                    {t("available", formatBytes(storageUsage.available))}
                  </Text>
                </Box>

                {/* Status message and recommendations */}
                {storageStatus.recommendations.length > 0 && (
                  <Box
                    p={3}
                    bg={bgColor}
                    borderRadius="6px"
                    borderWidth={1}
                    borderColor={borderColor}
                  >
                    <Text color={textSecondary} fontSize="xs" mb={1}>
                      {storageStatus.recommendations[0]}
                    </Text>
                    {storageStatus.recommendations.length > 1 && (
                      <Text color={textTertiary} fontSize="xs">
                        {storageStatus.recommendations.slice(1).join(" ")}
                      </Text>
                    )}
                  </Box>
                )}
              </VStack>
            )}

            {!storageLoading && !storageUsage && (
              <Text
                color={textTertiary}
                fontSize="xs"
                textAlign="center"
                py={2}
              >
                {t("unableToLoadStorage")}
              </Text>
            )}

            {/* Storage disclaimer */}
            <Box mt={2} pt={2} borderTopWidth={1} borderColor={borderColor}>
              <Text color={textTertiary} fontSize="xs" textAlign="center">
                {t("storageDisclaimer")}
              </Text>
            </Box>
          </VStack>
        </Box>

        {/* TTS Settings Section */}
        <Box
          p={4}
          bg={bgTertiary}
          borderWidth={1}
          borderColor={borderColor}
          borderRadius="8px"
        >
          <VStack spacing={4} align="stretch">
            <Box>
              <Text
                color={textPrimary}
                fontSize="sm"
                fontWeight="medium"
                mb={1}
              >
                {t("textToSpeech")}
              </Text>
              <Text color={textSecondary} fontSize="xs">
                {t("ttsDescription")}
              </Text>
            </Box>

            <Divider borderColor={borderColor} />

            {/* Security Warning */}
            <Alert
              status="warning"
              variant="left-accent"
              bg={bgColor}
              borderColor={borderColor}
            >
              <AlertIcon />
              <Box>
                <AlertTitle fontSize="xs" color={textPrimary}>
                  {t("securityNoticeTitle")}
                </AlertTitle>
                <AlertDescription fontSize="xs" color={textSecondary}>
                  {t("securityNoticeDescription")}
                </AlertDescription>
                <UnorderedList
                  mt={2}
                  spacing={1}
                  fontSize="xs"
                  color={textSecondary}
                >
                  <ListItem>{t("securityTip1")}</ListItem>
                  <ListItem>{t("securityTip2")}</ListItem>
                  <ListItem>{t("securityTip3")}</ListItem>
                </UnorderedList>
              </Box>
            </Alert>

            <Divider borderColor={borderColor} />

            {/* API Key Section */}
            <VStack spacing={3} align="stretch">
              <Text color={textPrimary} fontSize="xs" fontWeight="medium">
                {t("apiConfiguration")}
              </Text>
              <InputGroup size="sm">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={
                    hasApiKey
                      ? t("apiKeySavedPlaceholder")
                      : t("enterApiKeyPlaceholder")
                  }
                  bg={bgColor}
                  borderColor={borderColor}
                  color={textPrimary}
                  fontSize="sm"
                  _hover={{ borderColor: "#5f6368" }}
                  _focus={{
                    borderColor: "#8AB4F8",
                    boxShadow: "0 0 0 3px rgba(138, 180, 248, 0.3)",
                  }}
                />
                <InputRightElement>
                  <IconButton
                    aria-label={showApiKey ? t("hideApiKey") : t("showApiKey")}
                    icon={showApiKey ? <ViewOffIcon /> : <ViewIcon />}
                    size="xs"
                    variant="ghost"
                    onClick={() => setShowApiKey(!showApiKey)}
                    isDisabled={!apiKeyInput}
                  />
                </InputRightElement>
              </InputGroup>
              <HStack spacing={2}>
                <Button
                  size="sm"
                  colorScheme="green"
                  onClick={handleSaveApiKey}
                  isLoading={ttsLoading}
                  isDisabled={!apiKeyInput.trim()}
                >
                  {t("saveApiKey")}
                </Button>
              </HStack>
              <VStack align="start" spacing={1}>
                <Text color={textTertiary} fontSize="xs">
                  {t("getApiKeyFrom")}{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#8AB4F8", textDecoration: "underline" }}
                  >
                    {t("googleCloudConsole")}
                  </a>
                </Text>
                <Text color={textTertiary} fontSize="xs">
                  {t("makeEnableTTS")}{" "}
                  <a
                    href="https://console.cloud.google.com/apis/library/texttospeech.googleapis.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#8AB4F8", textDecoration: "underline" }}
                  >
                    {t("cloudTTSAPI")}
                  </a>{" "}
                  {t("inYourProject")}
                </Text>
              </VStack>
            </VStack>

            <Divider borderColor={borderColor} />

            {/* Voice Test Section */}
            <VStack spacing={3} align="stretch">
              <Text color={textPrimary} fontSize="xs" fontWeight="medium">
                {t("testVoice")}
              </Text>
              <Textarea
                value={testVoiceText}
                onChange={(e) => setTestVoiceText(e.target.value)}
                placeholder={t("enterTestTextPlaceholder")}
                size="sm"
                bg={bgColor}
                borderColor={borderColor}
                color={textPrimary}
                fontSize="sm"
                rows={2}
                _hover={{ borderColor: "#5f6368" }}
                _focus={{
                  borderColor: "#8AB4F8",
                  boxShadow: "0 0 0 3px rgba(138, 180, 248, 0.3)",
                }}
              />
              <HStack spacing={2}>
                <Select
                  value={testLanguage}
                  onChange={(e) => {
                    setTestLanguage(e.target.value);
                    loadAvailableVoices();
                  }}
                  size="sm"
                  bg={bgColor}
                  borderColor={borderColor}
                  color={textPrimary}
                  fontSize="sm"
                  flex={1}
                  isDisabled={availableLanguages.length === 0}
                >
                  {availableLanguages.length === 0 ? (
                    <option>{t("saveApiKeyToLoadLanguages")}</option>
                  ) : (
                    availableLanguages.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))
                  )}
                </Select>
                <Select
                  value={selectedModel}
                  size="sm"
                  bg={bgColor}
                  borderColor={borderColor}
                  color={textPrimary}
                  fontSize="sm"
                  flex={1}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    setTestVoice(""); // Reset voice when model changes
                  }}
                >
                  <option value="">{t("allModelsOption")}</option>
                  <option value="Neural2">{t("neural2HighQuality")}</option>
                  <option value="WaveNet">{t("wavenetNatural")}</option>
                  <option value="Chirp3">{t("chirp3HDVoices")}</option>
                  <option value="Studio">{t("studioPremium")}</option>
                  <option value="Standard">{t("standardBasic")}</option>
                </Select>
                <Select
                  value={testVoice}
                  onChange={(e) => setTestVoice(e.target.value)}
                  size="sm"
                  bg={bgColor}
                  borderColor={borderColor}
                  color={textPrimary}
                  fontSize="sm"
                  flex={1}
                  isDisabled={availableVoices.length === 0 || ttsLoading}
                >
                  {ttsLoading ? (
                    <option>{t("loadingVoicesOption")}</option>
                  ) : availableVoices.length === 0 ? (
                    <option>{t("selectModelFirstOption")}</option>
                  ) : (
                    availableVoices
                      .filter(
                        (voice) =>
                          !selectedModel || voice.model === selectedModel,
                      )
                      .map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name} {voice.model ? `[${voice.model}]` : ""}
                        </option>
                      ))
                  )}
                </Select>
              </HStack>
              <Button
                size="sm"
                colorScheme="blue"
                onClick={handleTestVoice}
                isLoading={isPlaying}
                isDisabled={!testVoice || !testVoiceText.trim()}
              >
                {isPlaying ? t("playing") : t("playTest")}
              </Button>
            </VStack>

            <Divider borderColor={borderColor} />

            {/* Tag-Based TTS Control */}
            <VStack spacing={3} align="stretch">
              <HStack justify="space-between">
                <Text color={textPrimary} fontSize="xs" fontWeight="medium">
                  {t("enableTTSForTags")}
                </Text>
                <HStack spacing={2}>
                  <Button
                    size="xs"
                    variant="ghost"
                    color={textSecondary}
                    onClick={handleEnableAllTags}
                    isDisabled={allTags.length === 0}
                  >
                    {t("enableAll")}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    color={textSecondary}
                    onClick={handleDisableAllTags}
                    isDisabled={allTags.length === 0}
                  >
                    {t("disableAll")}
                  </Button>
                </HStack>
              </HStack>

              {allTags.length === 0 ? (
                <Text
                  color={textTertiary}
                  fontSize="xs"
                  textAlign="center"
                  py={2}
                >
                  {t("noTagsAvailable")}
                </Text>
              ) : (
                <VStack spacing={2} align="stretch">
                  {allTags.map((tag) => {
                    const isEnabled = enabledTags.includes(tag);
                    const isExpanded = expandedTag === tag;
                    const config = tagConfigs[tag] || {
                      language: "en-US",
                      model: "Neural2",
                      voice: "",
                      cardSide: "back" as "front" | "back" | "both",
                    };
                    const voices = tagVoices[tag] || [];

                    return (
                      <VStack key={tag} spacing={0} align="stretch">
                        {/* Tag Header */}
                        <HStack
                          spacing={2}
                          px={3}
                          py={2}
                          bg={bgColor}
                          borderRadius="6px"
                          borderWidth={1}
                          borderColor={isEnabled ? "#34A853" : borderColor}
                          _hover={{ borderColor: "#5f6368" }}
                        >
                          <Switch
                            size="sm"
                            isChecked={isEnabled}
                            onChange={() => handleToggleTag(tag)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Text color={textPrimary} fontSize="xs" flex={1}>
                            {tag}
                          </Text>
                          {isEnabled && (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => handleExpandTag(tag)}
                              rightIcon={
                                isExpanded ? (
                                  <ChevronUpIcon />
                                ) : (
                                  <ChevronDownIcon />
                                )
                              }
                            >
                              {t("configure")}
                            </Button>
                          )}
                        </HStack>

                        {/* Tag Configuration Panel */}
                        {isEnabled && isExpanded && (
                          <VStack
                            spacing={2}
                            p={3}
                            bg={bgTertiary}
                            borderRadius="6px"
                            borderWidth={1}
                            borderColor={borderColor}
                            mt={-1}
                          >
                            <HStack spacing={2} w="full">
                              <Text
                                color={textSecondary}
                                fontSize="xs"
                                w="80px"
                              >
                                {t("language")}
                              </Text>
                              <Select
                                value={config.language}
                                onChange={(e) =>
                                  handleTagConfigChange(
                                    tag,
                                    "language",
                                    e.target.value,
                                  )
                                }
                                size="xs"
                                bg={bgColor}
                                borderColor={borderColor}
                                color={textPrimary}
                                fontSize="xs"
                              >
                                {availableLanguages.map((lang) => (
                                  <option key={lang.code} value={lang.code}>
                                    {lang.name}
                                  </option>
                                ))}
                              </Select>
                            </HStack>

                            <HStack spacing={2} w="full">
                              <Text
                                color={textSecondary}
                                fontSize="xs"
                                w="80px"
                              >
                                {t("model")}
                              </Text>
                              <Select
                                value={config.model}
                                onChange={(e) =>
                                  handleTagConfigChange(
                                    tag,
                                    "model",
                                    e.target.value,
                                  )
                                }
                                size="xs"
                                bg={bgColor}
                                borderColor={borderColor}
                                color={textPrimary}
                                fontSize="xs"
                              >
                                <option value="Neural2">
                                  {t("neural2HighQuality")}
                                </option>
                                <option value="WaveNet">
                                  {t("wavenetNatural")}
                                </option>
                                <option value="Chirp3">
                                  {t("chirp3HDVoices")}
                                </option>
                                <option value="Studio">
                                  {t("studioPremium")}
                                </option>
                                <option value="Standard">
                                  {t("standardBasic")}
                                </option>
                              </Select>
                            </HStack>

                            <HStack spacing={2} w="full">
                              <Text
                                color={textSecondary}
                                fontSize="xs"
                                w="80px"
                              >
                                {t("voice")}
                              </Text>
                              <Select
                                value={config.voice}
                                onChange={(e) =>
                                  handleTagConfigChange(
                                    tag,
                                    "voice",
                                    e.target.value,
                                  )
                                }
                                size="xs"
                                bg={bgColor}
                                borderColor={borderColor}
                                color={textPrimary}
                                fontSize="xs"
                                isDisabled={voices.length === 0}
                              >
                                {voices.length === 0 ? (
                                  <option>{t("loadingVoicesOption")}</option>
                                ) : (
                                  voices
                                    .filter(
                                      (voice) => voice.model === config.model,
                                    )
                                    .map((voice) => (
                                      <option key={voice.id} value={voice.id}>
                                        {voice.name}
                                      </option>
                                    ))
                                )}
                              </Select>
                            </HStack>

                            <HStack spacing={2} w="full">
                              <Text
                                color={textSecondary}
                                fontSize="xs"
                                w="80px"
                              >
                                {t("ttsCardSide")}
                              </Text>
                              <Select
                                value={config.cardSide || "back"}
                                onChange={(e) =>
                                  handleTagConfigChange(
                                    tag,
                                    "cardSide",
                                    e.target.value,
                                  )
                                }
                                size="xs"
                                bg={bgColor}
                                borderColor={borderColor}
                                color={textPrimary}
                                fontSize="xs"
                              >
                                <option value="front">
                                  {t("cardSideFront")}
                                </option>
                                <option value="back">
                                  {t("cardSideBack")}
                                </option>
                                <option value="both">
                                  {t("cardSideBoth")}
                                </option>
                              </Select>
                            </HStack>
                          </VStack>
                        )}
                      </VStack>
                    );
                  })}
                </VStack>
              )}
              <Text color={textTertiary} fontSize="xs">
                {t("ttsWillAppearDesc")}
              </Text>
            </VStack>

            <Divider borderColor={borderColor} />

            {/* Cache Management */}
            <VStack spacing={3} align="stretch">
              <HStack justify="space-between">
                <Text color={textPrimary} fontSize="xs" fontWeight="medium">
                  {t("audioCache")}
                </Text>
                <Button
                  size="xs"
                  variant="ghost"
                  color={textSecondary}
                  onClick={handleClearCache}
                >
                  {t("clearCache")}
                </Button>
              </HStack>
              {cacheStats && (
                <Box p={2} bg={bgColor} borderRadius="4px">
                  <VStack spacing={1} align="stretch">
                    <HStack justify="space-between">
                      <Text color={textSecondary} fontSize="xs">
                        {t("cachedEntries")}
                      </Text>
                      <Text color={textPrimary} fontSize="xs">
                        {cacheStats.totalEntries}
                      </Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text color={textSecondary} fontSize="xs">
                        {t("cacheSize")}
                      </Text>
                      <Text color={textPrimary} fontSize="xs">
                        {formatBytes(cacheStats.totalSizeBytes)}
                      </Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text color={textSecondary} fontSize="xs">
                        {t("hitRate")}
                      </Text>
                      <Text color={textPrimary} fontSize="xs">
                        {(cacheStats.hitRate * 100).toFixed(1)}%
                      </Text>
                    </HStack>
                  </VStack>
                </Box>
              )}
            </VStack>
          </VStack>
        </Box>

        {/* About Section */}
        <Box
          p={4}
          bg={bgTertiary}
          borderWidth={1}
          borderColor={borderColor}
          borderRadius="8px"
        >
          <VStack spacing={4} align="stretch">
            <VStack align="start" spacing={1}>
              <Text color={textPrimary} fontSize="sm" fontWeight="medium">
                {t("about")}
              </Text>
            </VStack>

            <VStack spacing={3} align="stretch">
              <HStack spacing={3}>
                <Box
                  as="svg"
                  width="16px"
                  height="16px"
                  viewBox="0 0 98 96"
                  fill="none"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
                    fill="#fff"
                  />
                </Box>
                <Text
                  as="a"
                  href="https://github.com/powermodeon/rekapu"
                  target="_blank"
                  rel="noopener noreferrer"
                  color="#8AB4F8"
                  fontSize="xs"
                  _hover={{ textDecoration: "underline" }}
                >
                  {t("githubRepository")}
                </Text>
              </HStack>

              <HStack spacing={3}>
                <Box
                  as="svg"
                  width="16px"
                  height="16px"
                  viewBox="0 0 1200 1227"
                  fill="none"
                >
                  <path
                    d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z"
                    fill="#fff"
                  />
                </Box>
                <Text color={textSecondary} fontSize="xs">
                  {t("createdBy")}{" "}
                  <Text
                    as="a"
                    href="https://x.com/keerealx"
                    target="_blank"
                    rel="noopener noreferrer"
                    color="#8AB4F8"
                    _hover={{ textDecoration: "underline" }}
                  >
                    @keerealx
                  </Text>
                </Text>
              </HStack>
            </VStack>
          </VStack>
        </Box>
      </VStack>
    </VStack>
  );
};
