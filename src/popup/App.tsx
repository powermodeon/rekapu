import React, { useState, useEffect, Suspense, lazy, useMemo } from 'react';
import {
  Box,
  VStack,
  HStack,
  Button,
  Text,
  Heading,
  Badge,
  IconButton,
  Divider,
  Center,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Textarea,
  FormControl,
  FormLabel,
  FormHelperText,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Switch,
  useDisclosure,
  useToast,
  Spinner,
  Tooltip,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
} from '@chakra-ui/react';
import { SettingsIcon, AddIcon, LockIcon, DeleteIcon, EditIcon } from '@chakra-ui/icons';
import { StorageAPI } from '../storage/StorageAPI';
import { GlobalSettings, DomainSettings, BackupScope, DEFAULT_GLOBAL_SETTINGS } from '../types/storage';
import { t, i18n } from '../utils/i18n';

// Lazy load heavy components
const ActiveTagsSelector = lazy(() => import('./components').then(module => ({ default: module.ActiveTagsSelector })));
const BlockCurrentSiteButton = lazy(() => import('./components').then(module => ({ default: module.BlockCurrentSiteButton })));
const DomainCountdown = lazy(() => import('./components').then(module => ({ default: module.DomainCountdown })));

// Helper function to translate day names
const translateDayName = (dayName: string): string => {
  const dayMap: Record<string, string> = {
    'Sun': t('daySun'),
    'Mon': t('dayMon'),
    'Tue': t('dayTue'),
    'Wed': t('dayWed'),
    'Thu': t('dayThu'),
    'Fri': t('dayFri'),
    'Sat': t('daySat'),
  };
  return dayMap[dayName] || dayName;
};

type View = 'dashboard' | 'study' | 'domains';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [cardsCount, setCardsCount] = useState(0);
  const [domainsCount, setDomainsCount] = useState(0);
  const [dueCardsCount, setDueCardsCount] = useState(0);
  const [domains, setDomains] = useState<Record<string, DomainSettings>>({});
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [streakData, setStreakData] = useState<{
    currentStreak: number;
    bestStreak: number;
    daysUntilBreak: number;
    weeklyAverage: number;
    streakActive: boolean;
    todayProgress?: {
      cardsAnswered: number;
      dailyGoal: number;
      cardsNeeded: number;
    };
    weeklyDays?: Array<{
      date: string;
      dayName: string;
      completed: boolean;
      isToday: boolean;
      qualityCards: number;
    }>;
  } | null>(null);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [refreshCards, setRefreshCards] = useState(0);
  
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
    status: 'safe' | 'warning' | 'critical' | 'exceeded';
    recommendations: string[];
  } | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  
  // Modal state
  const { isOpen: isAddModalOpen, onOpen: onAddModalOpen, onClose: onAddModalClose } = useDisclosure();
  const [domainInput, setDomainInput] = useState('');
  const [addingDomains, setAddingDomains] = useState(false);
  
  // New cooldown configuration state
  const [newDomainCooldown, setNewDomainCooldown] = useState(DEFAULT_GLOBAL_SETTINGS.defaultCooldownPeriod);
  const [editingSettings, setEditingSettings] = useState(false);
  const [tempDefaultCooldown, setTempDefaultCooldown] = useState(DEFAULT_GLOBAL_SETTINGS.defaultCooldownPeriod);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [tempDomainCooldown, setTempDomainCooldown] = useState(DEFAULT_GLOBAL_SETTINGS.defaultCooldownPeriod);
  const [tempSubdomainsIncluded, setTempSubdomainsIncluded] = useState(true);
  
  // Backup scope configuration state
  const [editingBackupScope, setEditingBackupScope] = useState(false);
  const [tempBackupScope, setTempBackupScope] = useState<BackupScope>('cards');
  
  const toast = useToast();
  
  // Material dark theme colors
  const bgColor = '#202124';
  const bgSecondary = '#292a2d';
  const bgTertiary = '#35363a';
  const borderColor = '#3c4043';
  const textPrimary = '#e8eaed';
  const textSecondary = '#9aa0a6';
  const textTertiary = '#5f6368';
  // Accent colors
  const primaryGreen = '#34A853';
  const primaryGreenHover = '#46B968';
  const secondaryBlue = '#8AB4F8';
  const secondaryBlueHover = '#A8C7FA';

  // Load data on component mount
  useEffect(() => {
    loadData();
  }, []);

  // Refresh data when component mounts and when cards are updated
  useEffect(() => {
    loadData();
  }, [refreshCards]);

  useEffect(() => {
    if (currentView === 'domains' && Object.keys(domains).length === 0) {
      if (domainsCount === 0) {
        loadDomainsCount();
      } else {
        loadDomainsData();
      }
    }
  }, [currentView, domainsCount]);



  const loadData = async () => {
    try {
      setLoading(true);
      
      const settingsResult = await StorageAPI.getGlobalSettings();
      if (settingsResult.success) {
        setSettings(settingsResult.data!);
        setTempDefaultCooldown(settingsResult.data!.defaultCooldownPeriod);
        setNewDomainCooldown(settingsResult.data!.defaultCooldownPeriod);
        setTempBackupScope(settingsResult.data!.backupScope);
      }

      const cardsCountResult = await StorageAPI.getCardsCount();
      if (cardsCountResult.success) {
        setCardsCount(cardsCountResult.data!);
      }

      // Load streak data and due cards count separately (non-blocking)
      loadStreakData();
      loadDueCardsCount();
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDomainsCount = async () => {
    try {
      const domainsCountResult = await StorageAPI.getDomainsCount();
      if (domainsCountResult.success) {
        setDomainsCount(domainsCountResult.data!);
      }
    } catch (error) {
      console.error('Failed to load domains count:', error);
    }
  };

  const loadDomainsData = async () => {
    try {
      setDomainsLoading(true);
      const domainsResult = await StorageAPI.getAllDomains();
      if (domainsResult.success) {
        setDomainsCount(Object.keys(domainsResult.data!).length);
        setDomains(domainsResult.data!);
      }
    } catch (error) {
      console.error('Failed to load domains:', error);
    } finally {
      setDomainsLoading(false);
    }
  };

  const refreshDomainsOnly = async () => {
    try {
      const domainsResult = await StorageAPI.getAllDomains();
      if (domainsResult.success) {
        setDomainsCount(Object.keys(domainsResult.data!).length);
        setDomains(domainsResult.data!);
      }
    } catch (error) {
      console.error('Failed to refresh domains:', error);
    }
  };

  const loadStreakData = async () => {
    try {
      // Send message to background script to get streak info
      const response = await chrome.runtime.sendMessage({
        action: 'stats_getStreakInfo'
      });

      if (response && response.success) {
        setStreakData(response.data);
      }
    } catch (error) {
      console.error('Failed to load streak data:', error);
      // Set default values if loading fails
      setStreakData({
        currentStreak: 0,
        bestStreak: 0,
        daysUntilBreak: 0,
        weeklyAverage: 0,
        streakActive: false
      });
    }
  };

  const loadDueCardsCount = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_DUE_CARDS_COUNT'
      });

      if (response && response.success) {
        setDueCardsCount(response.count || 0);
      }
    } catch (error) {
      console.error('Failed to load due cards count:', error);
      setDueCardsCount(0);
    }
  };

  const loadStorageData = async () => {
    try {
      setStorageLoading(true);
      
      // Load storage usage and quota status
      const [usageResult, statusResult] = await Promise.all([
        StorageAPI.getStorageUsage(),
        StorageAPI.checkQuotaStatus()
      ]);

      if (usageResult.success) {
        setStorageUsage(usageResult.data!);
      }

      if (statusResult.success) {
        setStorageStatus(statusResult.data!);
      }
    } catch (error) {
      console.error('Failed to load storage data:', error);
    } finally {
      setStorageLoading(false);
    }
  };

  // Domain management functions
  const handleAddDomains = async () => {
    if (!domainInput.trim()) return;
    
    setAddingDomains(true);
    try {
      // Parse domains from input (support comma and newline separation)
      const rawDomains = domainInput
        .split(/[,\n]/)
        .map(d => d.trim())
        .filter(d => d.length > 0)
        .map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, ''));

      // Validate domains
      const validDomains = rawDomains.filter(domain => {
        const domainRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        return domainRegex.test(domain);
      });

      if (validDomains.length === 0) {
        toast({
          title: t('invalidDomains'),
          description: t('enterValidDomains'),
          status: 'error',
          duration: 3000,
        });
        return;
      }

      let addedCount = 0;
      const errors: string[] = [];

      // Add each domain with custom cooldown
      for (const domain of validDomains) {
        try {
          const result = await StorageAPI.setDomain(domain, {
            domain,
            cooldownPeriod: newDomainCooldown, // Use the configured cooldown
            isActive: true,
            lastUnblock: 0,
            subdomainsIncluded: true,
          });
          
          if (result.success) {
            addedCount++;
          } else {
            errors.push(`${domain}: ${result.error}`);
          }
        } catch (error) {
          errors.push(`${domain}: Failed to add`);
        }
      }

      // Show results
      if (addedCount > 0) {
        toast({
          title: t('domainsAdded', [String(addedCount), addedCount === 1 ? '' : 's']),
          description: addedCount === 1 ? t('domainNowBlocked') : t('domainsNowBlocked'),
          status: 'success',
          duration: 3000,
        });
      }

      if (errors.length > 0) {
        toast({
          title: t('someDomainsFailed'),
          description: errors.slice(0, 3).join(', ') + (errors.length > 3 ? '...' : ''),
          status: 'warning',
          duration: 5000,
        });
      }

      // Refresh data and close modal
      await loadData();
      await refreshDomainsOnly(); // Refresh domains list immediately
      setDomainInput('');
      setNewDomainCooldown(settings?.defaultCooldownPeriod || DEFAULT_GLOBAL_SETTINGS.defaultCooldownPeriod); // Reset to default
      onAddModalClose();
    } catch (error) {
      toast({
        title: t('error'),
        description: t('failedToAddDomains'),
        status: 'error',
        duration: 3000,
      });
    } finally {
      setAddingDomains(false);
    }
  };

  const handleDeleteDomain = async (domain: string) => {
    setDomainsLoading(true);
    try {
      // Check if domain is currently blocked
      const blockResult = await StorageAPI.checkDomainBlocked(domain);
      if (blockResult.success && blockResult.blocked) {
        toast({
          title: t('cannotDeleteBlockedDomain'),
          description: t('mustAnswerToUnblock'),
          status: 'warning',
          duration: 4000,
        });
        setDomainsLoading(false);
        return;
      }

      const result = await StorageAPI.removeDomain(domain);
      if (result.success) {
        toast({
          title: t('domainRemoved'),
          description: t('domainRemovedFromList', domain),
          status: 'success',
          duration: 3000,
        });
        await refreshDomainsOnly();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: t('error'),
        description: t('failedToRemoveDomain'),
        status: 'error',
        duration: 3000,
      });
    } finally {
      setDomainsLoading(false);
    }
  };

  const isBlocked = (domain: string): boolean => {
    const domainData = domains[domain];
    if (!domainData) return false;
    
    // Domain is blocked if it's active and cooldown period hasn't expired
    const cooldownExpired = Date.now() - domainData.lastUnblock > (domainData.cooldownPeriod * 60 * 1000);
    return domainData.isActive && (domainData.lastUnblock === 0 || cooldownExpired);
  };

  // New settings management functions
  const handleSaveDefaultCooldown = async () => {
    if (!settings) return;
    
    try {
      const result = await StorageAPI.updateGlobalSettings({
        ...settings,
        defaultCooldownPeriod: tempDefaultCooldown
      });
      
      if (result.success) {
        setSettings(result.data!);
        setEditingSettings(false);
        toast({
          title: t('settingsUpdated'),
          description: t('defaultCooldownSet', String(tempDefaultCooldown)),
          status: 'success',
          duration: 3000,
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update settings',
        status: 'error',
        duration: 3000,
      });
    }
  };

  const handleCancelSettingsEdit = () => {
    setTempDefaultCooldown(settings?.defaultCooldownPeriod || DEFAULT_GLOBAL_SETTINGS.defaultCooldownPeriod);
    setEditingSettings(false);
  };

  // Backup scope management functions
  const handleSaveBackupScope = async () => {
    if (!settings) return;
    
    try {
      const result = await StorageAPI.updateGlobalSettings({
        ...settings,
        backupScope: tempBackupScope
      });
      
      if (result.success) {
        setSettings(result.data!);
        setEditingBackupScope(false);
        toast({
          title: 'Settings updated',
          description: `Default backup scope set to ${tempBackupScope}`,
          status: 'success',
          duration: 3000,
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update backup scope',
        status: 'error',
        duration: 3000,
      });
    }
  };

  const handleCancelBackupScopeEdit = () => {
    setTempBackupScope(settings?.backupScope || 'cards');
    setEditingBackupScope(false);
  };

  // Domain editing functions
  const handleEditDomain = (domain: string, currentCooldown: number, currentSubdomains: boolean) => {
    setEditingDomain(domain);
    setTempDomainCooldown(currentCooldown);
    setTempSubdomainsIncluded(currentSubdomains);
  };

  const handleSaveDomain = async (domain: string) => {
    try {
      const domainData = domains[domain];
      if (!domainData) return;

      const blocked = isBlocked(domain);
      
      // Prevent decreasing cooldown for blocked domains (anti-cheat)
      if (blocked && tempDomainCooldown < domainData.cooldownPeriod) {
        toast({
          title: 'Cannot reduce cooldown',
          description: 'You can only increase cooldown periods for blocked domains. Answer cards to unblock first.',
          status: 'warning',
          duration: 5000,
        });
        return;
      }

      const result = await StorageAPI.setDomain(domain, {
        ...domainData,
        cooldownPeriod: tempDomainCooldown,
        subdomainsIncluded: tempSubdomainsIncluded
      });
      
      if (result.success) {
        await refreshDomainsOnly();
        setEditingDomain(null);
        toast({
          title: 'Domain updated',
          description: `${domain} settings updated`,
          status: 'success',
          duration: 3000,
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update domain settings',
        status: 'error',
        duration: 3000,
      });
    }
  };

  const handleCancelDomainEdit = () => {
    setEditingDomain(null);
    setTempDomainCooldown(DEFAULT_GLOBAL_SETTINGS.defaultCooldownPeriod);
    setTempSubdomainsIncluded(true);
  };

  // Memoized sorted domains list for performance
  const sortedDomains = useMemo(() => {
    const domainEntries = Object.entries(domains).map(([domain, domainData]) => ({
      domain,
      domainData,
      blocked: isBlocked(domain)
    }));

    // Sort: unblocked first (alphabetically), then blocked (alphabetically)
    return domainEntries.sort((a, b) => {
      // First, sort by blocked status (unblocked first)
      if (a.blocked !== b.blocked) {
        return a.blocked ? 1 : -1;
      }
      // Within same status, sort alphabetically
      return a.domain.localeCompare(b.domain);
    });
  }, [domains]);

  // Utility function to format bytes in human-readable format
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Get storage status color
  const getStorageStatusColor = (status: string) => {
    switch (status) {
      case 'safe': return '#4ade80';
      case 'warning': return '#fbbf24';
      case 'critical': return '#f97316';
      case 'exceeded': return '#ef4444';
      default: return textSecondary;
    }
  };

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard':
        return (
          <VStack spacing={6} align="stretch">
            {/* Your Progress Section */}
            <Box>
              <Text color={textPrimary} fontSize="md" fontWeight="semibold" mb={3}>
                {t('yourProgress')}
              </Text>
              <Box
                p={4}
                bg={bgTertiary}
                borderWidth={1}
                borderColor={borderColor}
                borderRadius="8px"
                _hover={{ borderColor: '#5f6368' }}
                transition="border-color 0.2s"
              >
              <VStack align="stretch" spacing={3}>
                {/* Current Streak */}
                <HStack justify="space-between" align="center">
                  <VStack align="start" spacing={0}>
                    <Text fontSize="xs" color={textSecondary} fontWeight="medium">
                      {t('currentStreak')}
                    </Text>
                    <HStack spacing={1}>
                      <Text fontSize="2xl" fontWeight="bold" color={streakData?.streakActive ? primaryGreen : textPrimary}>
                        {streakData ? streakData.currentStreak : '...'}
                      </Text>
                      <Text fontSize="sm" color={textSecondary}>
                        {i18n.getPlural('day', streakData ? streakData.currentStreak : 0)} 🔥
                      </Text>
                    </HStack>
                  </VStack>
                  <VStack align="end" spacing={0}>
                    <Text fontSize="xs" color={textTertiary}>
                      {t('best')}
                    </Text>
                    <Text fontSize="sm" fontWeight="semibold" color={textPrimary}>
                      {streakData?.bestStreak || 0}
                    </Text>
                  </VStack>
                </HStack>

                {/* Weekly View */}
                {streakData?.weeklyDays && (
                  <Box>
                    <Text fontSize="xs" color={textTertiary} mb={2}>{t('currentWeek')}</Text>
                    <HStack spacing={1} justify="space-between">
                      {streakData.weeklyDays.map((day, idx) => (
                        <VStack key={idx} spacing={1} flex={1}>
                          <Text fontSize="9px" color={textTertiary}>
                            {translateDayName(day.dayName)}
                          </Text>
                          <Box
                            w="28px"
                            h="28px"
                            borderRadius="6px"
                            bg={day.completed ? primaryGreen : (day.isToday ? '#4a4419' : bgColor)}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            borderWidth={day.isToday ? 2 : 0}
                            borderColor={day.isToday ? secondaryBlue : 'transparent'}
                          >
                            {day.completed ? (
                              <Text fontSize="sm" color="white">✓</Text>
                            ) : day.isToday ? (
                              <Text fontSize="9px" color="#FCC934" fontWeight="bold">{day.qualityCards}</Text>
                            ) : (
                              <Text fontSize="sm" color={textTertiary}>-</Text>
                            )}
                          </Box>
                        </VStack>
                      ))}
                    </HStack>
                  </Box>
                )}

                {/* Today's Progress */}
                {streakData?.todayProgress && (
                  <Box>
                    <HStack justify="space-between" mb={1}>
                      <Text fontSize="xs" color={textTertiary}>
                        {t('todaysGoal')}
                      </Text>
                      <Text fontSize="xs" fontWeight="semibold"                         color={
                        streakData.todayProgress.cardsAnswered >= streakData.todayProgress.dailyGoal 
                          ? primaryGreen 
                          : '#FCC934'
                      }>
                        {streakData.todayProgress.cardsAnswered}/{streakData.todayProgress.dailyGoal}
                      </Text>
                    </HStack>
                    <Box
                      w="full"
                      h="4px"
                      bg={bgColor}
                      borderRadius="2px"
                      overflow="hidden"
                    >
                      <Box
                        h="full"
                        bg={streakData.todayProgress.cardsAnswered >= streakData.todayProgress.dailyGoal ? primaryGreen : '#FCC934'}
                        borderRadius="2px"
                        width={`${Math.min((streakData.todayProgress.cardsAnswered / streakData.todayProgress.dailyGoal) * 100, 100)}%`}
                        transition="width 0.3s ease"
                      />
                    </Box>
                    
                    {/* CTA Message */}
                    {streakData.currentStreak > 0 && streakData.todayProgress.cardsNeeded > 0 && (
                      <Text fontSize="xs" color="#FCC934" mt={2}>
                        ⚠️ {t('answerMore', String(streakData.todayProgress.cardsNeeded))}
                      </Text>
                    )}
                    {streakData.todayProgress.cardsAnswered >= streakData.todayProgress.dailyGoal && (
                      <Text fontSize="xs" color={primaryGreen} mt={2}>
                        {t('goalComplete')}
                      </Text>
                    )}
                  </Box>
                )}
              </VStack>
              </Box>
            </Box>

            {/* Quick Actions Section */}
            <Box>
              <Text color={textPrimary} fontSize="md" fontWeight="semibold" mb={3}>
                {t('quickActions')}
              </Text>
              <VStack spacing={3}>
            <Tooltip
              label={dueCardsCount === 0 ? t('noCardsDue') : ""}
              isDisabled={dueCardsCount > 0}
            >
              <Button
                w="full"
                size="md"
                bg={bgTertiary}
                color={dueCardsCount > 0 ? textPrimary : textSecondary}
                borderWidth={1}
                borderColor={borderColor}
                _hover={dueCardsCount > 0 ? { bg: '#35363a', borderColor: '#5f6368' } : {}}
                borderRadius="6px"
                fontWeight="medium"
                isDisabled={dueCardsCount === 0}
                cursor={dueCardsCount === 0 ? "not-allowed" : "pointer"}
                onClick={() => {
                  if (dueCardsCount > 0) {
                    const url = chrome.runtime.getURL('blocked.html?mode=study');
                    chrome.tabs.create({ url });
                  }
                }}
              >
                {t('studyDueCards')}
              </Button>
            </Tooltip>

                <Button
                  w="full"
                  size="md"
                  bg={bgTertiary}
                  color={textPrimary}
                  borderWidth={1}
                  borderColor={borderColor}
                  _hover={{ bg: '#35363a', borderColor: '#5f6368' }}
                  borderRadius="6px"
                  fontWeight="medium"
                  leftIcon={<AddIcon />}
                  onClick={() => {
                    const url = chrome.runtime.getURL('dashboard.html?action=create');
                    chrome.tabs.create({ url });
                  }}
                >
                  {t('addCard')}
                </Button>

                <Suspense fallback={<Spinner />}>
                  <BlockCurrentSiteButton onDomainBlocked={() => loadData()} />
                </Suspense>
              </VStack>
            </Box>

            {/* More Section */}
            <Box>
              <Text color={textPrimary} fontSize="md" fontWeight="semibold" mb={3}>
                {t('more')}
              </Text>
              <VStack spacing={3}>
                <Button
                  w="full"
                  size="md"
                  bg={bgTertiary}
                  color={textPrimary}
                  borderWidth={1}
                  borderColor={borderColor}
                  _hover={{ bg: '#35363a', borderColor: '#5f6368' }}
                  borderRadius="6px"
                  fontWeight="medium"
                  onClick={() => {
                    // Open dashboard in new tab for better text copying experience
                    const url = chrome.runtime.getURL('dashboard.html');
                    if (cardsCount === 0) {
                      chrome.tabs.create({ url: url + '?action=create' });
                    } else {
                      chrome.tabs.create({ url });
                    }
                  }}
                >
                  📝 {t('manageCards')}
                </Button>
                
                <Button
                  w="full"
                  size="md"
                  bg={bgTertiary}
                  color={textPrimary}
                  borderWidth={1}
                  borderColor={borderColor}
                  _hover={{ bg: '#35363a', borderColor: '#5f6368' }}
                  borderRadius="6px"
                  fontWeight="medium"
                  onClick={() => {
                    const url = chrome.runtime.getURL('dashboard.html?action=statistics');
                    chrome.tabs.create({ url });
                  }}
                >
                  📊 {t('statistics')}
                </Button>
              </VStack>
            </Box>
          </VStack>
        );
        
      case 'study':
        return (
          <VStack spacing={5} align="stretch">
            {/* Header */}
            <Box>
              <Heading size="lg" color={textPrimary} fontWeight="semibold">
                {t('studySettings')}
              </Heading>
              <Text color={textSecondary} fontSize="sm" mt={1}>
                {t('configureSubjects')}
              </Text>
            </Box>
            
            <Divider borderColor={borderColor} />
            
            {/* Active Tags Selector */}
            <Suspense fallback={<Spinner />}>
              <ActiveTagsSelector refreshTrigger={refreshCards} />
            </Suspense>
          </VStack>
        );
        
      case 'domains':
        return (
          <VStack spacing={5} align="stretch">
            {/* Header */}
            <HStack justify="space-between" align="center">
              <Box>
                <Heading size="lg" color={textPrimary} fontWeight="semibold">
                  {t('blockedDomains')}
                </Heading>
                <Text color={textSecondary} fontSize="sm" mt={1}>
                  {domainsCount === 0 ? t('addWebsitesToBlock') : (() => {
                    const domainWord = i18n.getPlural('domain', domainsCount);
                    return t('domainsInBlockList', [String(domainsCount), domainWord]);
                  })()}
                </Text>
              </Box>
              <Button
                size="sm"
                bg={secondaryBlue}
                color={bgColor}
                _hover={{ bg: secondaryBlueHover }}
                leftIcon={<AddIcon />}
                borderRadius="6px"
                fontWeight="medium"
                onClick={onAddModalOpen}
                minH={8}
                h="auto"
                py={2}
                whiteSpace="normal"
              >
                {t('addDomains')}
              </Button>
            </HStack>
            
            <Divider borderColor={borderColor} />
            
            {/* Domain List */}
            {domainsCount > 0 && (
              <VStack spacing={3} align="stretch">
                {sortedDomains.map(({ domain, domainData, blocked }) => {
                  const isEditing = editingDomain === domain;
                  
                  return (
                    <Box
                      key={domain}
                      p={4}
                      bg={bgTertiary}
                      borderWidth={1}
                      borderColor={borderColor}
                      borderRadius="8px"
                      _hover={{ borderColor: '#5f6368' }}
                      transition="border-color 0.2s"
                    >
                      <VStack spacing={1} align="stretch">
                        {/* First Row: Domain name and status */}
                        <HStack justify="space-between" align="center">
                          <Text maxW="40%" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis" color={textPrimary} fontSize="sm" fontWeight="medium">
                            {domain}
                          </Text>
                          <HStack maxW="60%" spacing={2}>
                            <Badge
                              bg={blocked ? "#4a1a1a" : "#1a4a1a"}
                              color={blocked ? "#F28B82" : "#81C995"}
                              fontSize="xs"
                              borderRadius="4px"
                              px={2}
                            >
                              {blocked ? t('blocked') : t('unblocked')}
                            </Badge>
                            <Menu>
                              <MenuButton
                                as={IconButton}
                                aria-label={t('domainOptions')}
                                icon={<Text fontSize="lg" lineHeight="1">⋮</Text>}
                                size="sm"
                                variant="ghost"
                                color={textSecondary}
                                _hover={{ color: textPrimary }}
                              />
                              <MenuList bg={bgTertiary} borderColor={borderColor}>
                                <MenuItem 
                                  bg={bgTertiary} 
                                  color={blocked ? textTertiary : textPrimary}
                                  _hover={blocked ? {} : { bg: bgSecondary }}
                                  icon={<EditIcon />}
                                  isDisabled={blocked}
                                  onClick={() => handleEditDomain(domain, domainData.cooldownPeriod, domainData.subdomainsIncluded)}
                                >
                                  {blocked ? t('cannotEditBlocked') : t('editSettings')}
                                </MenuItem>
                                <MenuItem 
                                  bg={bgTertiary} 
                                  color={blocked ? textTertiary : textPrimary}
                                  _hover={blocked ? {} : { bg: bgSecondary }}
                                  icon={<DeleteIcon />}
                                  isDisabled={blocked || domainsLoading}
                                  onClick={() => handleDeleteDomain(domain)}
                                >
                                  {blocked ? t('cannotDeleteBlocked') : t('deleteDomain')}
                                </MenuItem>
                              </MenuList>
                            </Menu>
                          </HStack>
                        </HStack>

                        {/* Table-like rows for settings */}
                        <VStack spacing={1} align="stretch">
                          {/* Unblocked countdown row - only shown when domain is unblocked */}
                          {!blocked && domainData.lastUnblock > 0 && (
                            <HStack spacing={3} fontSize="xs" color={textTertiary} opacity={0.7} align="center" justify="space-between">
                              <Text whiteSpace="nowrap" flexShrink={0}>{t('unblockedFor')}</Text>
                              <Suspense fallback={<Text flex={1}>...</Text>}>
                                <DomainCountdown
                                  lastUnblock={domainData.lastUnblock}
                                  cooldownPeriod={domainData.cooldownPeriod}
                                  textColor="#FCC934"
                                  onExpire={refreshDomainsOnly}
                                />
                              </Suspense>
                            </HStack>
                          )}
                          
                          {/* Cooldown row */}
                          <HStack spacing={3} fontSize="xs" color={textTertiary} opacity={0.7} align="center" justify="space-between">
                            <Text flexShrink={0}>{t('cooldown')}</Text>
                            {isEditing ? (
                              <HStack spacing={2}>
                                <NumberInput
                                  value={tempDomainCooldown}
                                  onChange={(_, value) => setTempDomainCooldown(value || 1)}
                                  min={blocked ? domainData.cooldownPeriod : 1}
                                  max={1440}
                                  size="sm"
                                  w="80px"
                                >
                                  <NumberInputField
                                    bg={bgColor}
                                    borderColor={blocked && tempDomainCooldown < domainData.cooldownPeriod ? '#F28B82' : borderColor}
                                    color={textPrimary}
                                    fontSize="sm"
                                  />
                                </NumberInput>
                                <Text>{t('minutes')}</Text>
                              </HStack>
                            ) : (
                              <Text>{domainData.cooldownPeriod} {t('minuteShort')}</Text>
                            )}
                          </HStack>

                          {/* Subdomains row */}
                          <HStack spacing={3} fontSize="xs" color={textTertiary} opacity={0.7} align="center" justify="space-between">
                            <Text flexShrink={0}>{t('subdomains')}</Text>
                            {isEditing ? (
                              <HStack spacing={2}>
                                <Switch
                                  size="sm"
                                  isChecked={tempSubdomainsIncluded}
                                  onChange={(e) => setTempSubdomainsIncluded(e.target.checked)}
                                  colorScheme="blue"
                                />
                                <Text>{tempSubdomainsIncluded ? t('include') : t('exclude')}</Text>
                              </HStack>
                            ) : (
                              <Text>
                                {domainData.subdomainsIncluded ? t('included') : t('excluded')}
                              </Text>
                            )}
                          </HStack>

                          {/* Save/Cancel buttons when editing */}
                          {isEditing && (
                            <HStack spacing={2} justify="flex-end" pt={2}>
                              <Button
                                size="sm"
                                variant="ghost"
                                color={textSecondary}
                                _hover={{ color: textPrimary, bg: bgSecondary }}
                                onClick={handleCancelDomainEdit}
                              >
                                {t('cancel')}
                              </Button>
                              <Button
                size="sm"
                bg={primaryGreen}
                color="white"
                                _hover={{ bg: primaryGreenHover }}
                                isDisabled={blocked && tempDomainCooldown < domainData.cooldownPeriod}
                                onClick={() => handleSaveDomain(domain)}
                              >
                                {t('save')}
                              </Button>
                            </HStack>
                          )}

                          {/* Anti-cheat warning */}
                          {isEditing && blocked && (
                            <Box pt={1}>
                              <Text fontSize="10px" color="#F28B82">
                                {t('canOnlyIncreaseCooldown')}
                              </Text>
                            </Box>
                          )}
                        </VStack>
                      </VStack>
                    </Box>
                  );
                })}
              </VStack>
            )}
            
            {/* Empty State */}
            {domainsCount === 0 && (
              <Center py={12}>
                <VStack spacing={4}>
                  <Box
                    p={4}
                    bg={bgTertiary}
                    borderRadius="50%"
                    borderWidth={1}
                    borderColor={borderColor}
                  >
                    <LockIcon boxSize={8} color={textTertiary} />
                  </Box>
                  <VStack spacing={2} textAlign="center">
                    <Text color={textPrimary} fontSize="lg" fontWeight="medium">
                      {t('noBlockedDomains')}
                    </Text>
                    <Text color={textSecondary} fontSize="sm" maxW="250px">
                      {t('addWebsitesImprove')}
                    </Text>
                  </VStack>
                  <Button
                    size="sm"
                    bg={secondaryBlue}
                    color="white"
                    _hover={{ bg: '#316cad' }}
                    leftIcon={<AddIcon />}
                    borderRadius="6px"
                    fontWeight="medium"
                    mt={2}
                    onClick={onAddModalOpen}
                  >
                    Add Domains
                  </Button>
                </VStack>
              </Center>
            )}
          </VStack>
        );
        
        
      default:
        return null;
    }
  };

  return (
    <Box bg={bgColor} h="100vh" w="100%" color={textPrimary}>
      {/* Header */}
      <Box 
        px={4} 
        py={3} 
        bg={bgSecondary} 
        borderBottomWidth={1} 
        borderColor={borderColor}
      >
        <HStack justify="space-between" align="center">
          <HStack spacing={1}>
            <Box 
              w={6} 
              h={6} 
              borderRadius="4px" 
              display="flex" 
              alignItems="center" 
              justifyContent="center"
            >
              <Text color="white" fontSize="lg" fontWeight="bold">👻</Text>
            </Box>
            <Text fontSize="md" fontWeight="semibold" color={textPrimary}>
              {t('extName')}
            </Text>
          </HStack>
          <IconButton
            aria-label={t('settings')}
            icon={<SettingsIcon />}
            size="sm"
            variant="ghost"
            color={textSecondary}
            _hover={{ bg: bgTertiary, color: textPrimary }}
            borderRadius="6px"
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html?action=settings') })}
          />
        </HStack>
      </Box>

      {/* Navigation */}
      <Box px={4} py={2} bg={bgSecondary} borderBottomWidth={1} borderColor={borderColor}>
        <HStack spacing={1}>
          {[
            { key: 'dashboard', label: t('dashboard') },
            { key: 'study', label: t('study') },
            { key: 'domains', label: t('domains') },
          ].map(({ key, label }) => (
            <Button
              key={key}
              size="sm"
              variant="ghost"
              color={currentView === key ? textPrimary : textSecondary}
              bg={currentView === key ? bgTertiary : 'transparent'}
                          _hover={{ 
                                bg: currentView === key ? bgTertiary : bgSecondary,
                color: textPrimary 
              }}
              borderRadius="6px"
              fontWeight="medium"
              fontSize="sm"
              onClick={() => setCurrentView(key as View)}
            >
              {label}
            </Button>
          ))}
        </HStack>
      </Box>

      {/* Content */}
      <Box p={4} overflow="auto" h="calc(100vh - 100px)">
        {renderContent()}
      </Box>

      {/* Add Domains Modal */}
      <Modal isOpen={isAddModalOpen} onClose={onAddModalClose} size="lg">
        <ModalOverlay bg="blackAlpha.600" />
        <ModalContent bg={bgSecondary} borderColor={borderColor} borderWidth={1}>
          <ModalHeader color={textPrimary} borderBottomWidth={1} borderColor={borderColor}>
            {t('addDomainsToBlock')}
          </ModalHeader>
          <ModalCloseButton color={textSecondary} />
          <ModalBody py={6}>
            <VStack spacing={4} align="stretch">
              <FormControl>
                <FormLabel color={textPrimary} fontSize="sm" fontWeight="medium">
                  {t('domainList')}
                </FormLabel>
                <Textarea
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder={t('domainPlaceholder')}
                  bg={bgTertiary}
                  borderColor={borderColor}
                  color={textPrimary}
                  _hover={{ borderColor: '#5f6368' }}
                  _focus={{ borderColor: secondaryBlue, boxShadow: `0 0 0 1px ${secondaryBlue}` }}
                  resize="vertical"
                  minH="120px"
                />
                <FormHelperText color={textSecondary} fontSize="xs">
                  {t('domainHelperText')}
                </FormHelperText>
              </FormControl>
              
              <Box p={4} bg={bgTertiary} borderRadius="8px" borderWidth={1} borderColor={borderColor}>
                <VStack spacing={3} align="start">
                  <Text color={textPrimary} fontSize="sm" fontWeight="medium">
                    {t('settingsForNewDomains')}
                  </Text>
                  <HStack spacing={4} w="full">
                    <FormControl flex={1}>
                      <FormLabel color={textSecondary} fontSize="xs">
                        {t('cooldownPeriodMinutes')}
                      </FormLabel>
                      <NumberInput
                        value={newDomainCooldown}
                        onChange={(_, value) => setNewDomainCooldown(value || 10)}
                        min={1}
                        max={1440}
                        size="sm"
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
                    </FormControl>
                    <FormControl>
                      <FormLabel color={textSecondary} fontSize="xs">
                        {t('includeSubdomains')}
                      </FormLabel>
                      <Switch colorScheme="blue" defaultChecked isReadOnly />
                    </FormControl>
                  </HStack>
                  <Text color={textTertiary} fontSize="xs">
                    {t('canChangeAfterAdding')}
                  </Text>
                </VStack>
              </Box>
            </VStack>
          </ModalBody>
          <ModalFooter borderTopWidth={1} borderColor={borderColor}>
            <HStack spacing={3}>
              <Button
                variant="ghost"
                color={textSecondary}
                onClick={onAddModalClose}
                borderRadius="6px"
              >
                {t('cancel')}
              </Button>
              <Button
                bg={primaryGreen}
                color="white"
                _hover={{ bg: primaryGreenHover }}
                onClick={handleAddDomains}
                isLoading={addingDomains}
                loadingText={t('adding')}
                borderRadius="6px"
                fontWeight="medium"
              >
                {t('addDomains')}
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default App; 