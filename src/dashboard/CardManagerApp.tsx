import React, { useState, useEffect, Suspense, lazy } from 'react';
import {
  Box,
  VStack,
  HStack,
  Button,
  Text,
  Heading,
  Container,
  IconButton,
  useToast,
  Spinner,
  Center,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
} from '@chakra-ui/react';
import { ArrowBackIcon, AddIcon } from '@chakra-ui/icons';
import { StorageAPI } from '../storage/StorageAPI';
import { Card } from '../types';
import { t } from '../utils/i18n';

// Lazy load components that were moved from popup
const CardForm = lazy(() => import('./components/CardForm'));
const CardsList = lazy(() => import('./components/CardsList'));
const StatisticsManager = lazy(() => import('./components/StatisticsManager'));
const ImportExportTab = lazy(() => import('./components/ImportExportTab').then(module => ({ default: module.ImportExportTab })));
const SettingsTab = lazy(() => import('./components').then(module => ({ default: module.SettingsTab })));

type View = 'list' | 'create' | 'edit' | 'statistics' | 'import-export' | 'settings';

export const CardManagerApp: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('list');
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [loading, setLoading] = useState(true);
  const [prefilledText, setPrefilledText] = useState<string | null>(null);
  
  const toast = useToast();
  
  useEffect(() => {
    // Handle URL parameters on load
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const cardId = params.get('cardId');
    const prefill = params.get('prefill');
    
    // Handle prefilled text from context menu
    if (prefill) {
      setPrefilledText(decodeURIComponent(prefill));
      setCurrentView('create');
      setEditingCard(null);
    } else if (action === 'edit' && cardId) {
      loadCardForEdit(cardId);
    } else if (action === 'create') {
      setCurrentView('create');
      setEditingCard(null);
    } else if (action === 'statistics') {
      setCurrentView('statistics');
      setEditingCard(null);
    } else if (action === 'import-export') {
      setCurrentView('import-export');
      setEditingCard(null);
    } else if (action === 'settings') {
      setCurrentView('settings');
      setEditingCard(null);
    } else {
      setCurrentView('list');
      setEditingCard(null);
    }
    
    setLoading(false);

    // Handle browser back/forward buttons
    const handlePopState = (event: PopStateEvent) => {
      const params = new URLSearchParams(window.location.search);
      const action = params.get('action');
      const cardId = params.get('cardId');
      
      if (action === 'edit' && cardId) {
        loadCardForEdit(cardId);
      } else if (action === 'create') {
        setCurrentView('create');
        setEditingCard(null);
      } else if (action === 'statistics') {
        setCurrentView('statistics');
        setEditingCard(null);
      } else if (action === 'import-export') {
        setCurrentView('import-export');
        setEditingCard(null);
      } else if (action === 'settings') {
        setCurrentView('settings');
        setEditingCard(null);
      } else {
        setCurrentView('list');
        setEditingCard(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const loadCardForEdit = async (cardId: string) => {
    try {
      const result = await StorageAPI.getCard(cardId);
      if (result.success && result.data) {
        setEditingCard(result.data);
        setCurrentView('edit');
      } else {
        toast({
          title: t('cardNotFound'),
          description: t('cardNotFoundDesc'),
          status: 'error',
          duration: 3000,
        });
        navigateToList();
      }
    } catch (error) {
      console.error('Failed to load card for editing:', error);
      toast({
        title: t('error'),
        description: t('failedToLoadCard'),
        status: 'error',
        duration: 3000,
      });
      navigateToList();
    }
  };

  const navigateToList = () => {
    setCurrentView('list');
    setEditingCard(null);
    window.history.pushState({}, '', window.location.pathname);
  };

  const navigateToCreate = () => {
    setEditingCard(null);
    setPrefilledText(null);
    setCurrentView('create');
    window.history.pushState({}, '', `${window.location.pathname}?action=create`);
  };

  const navigateToEdit = (card: Card) => {
    setEditingCard(card);
    setCurrentView('edit');
    window.history.pushState({}, '', `${window.location.pathname}?action=edit&cardId=${card.id}`);
  };

  const navigateToStatistics = () => {
    setEditingCard(null);
    setCurrentView('statistics');
    window.history.pushState({}, '', `${window.location.pathname}?action=statistics`);
  };

  const navigateToImportExport = () => {
    setEditingCard(null);
    setCurrentView('import-export');
    window.history.pushState({}, '', `${window.location.pathname}?action=import-export`);
  };

  const navigateToSettings = () => {
    setEditingCard(null);
    setCurrentView('settings');
    window.history.pushState({}, '', `${window.location.pathname}?action=settings`);
  };

  const handleEditCardById = async (cardId: string) => {
    await loadCardForEdit(cardId);
  };

  const handleCardSaved = (card: Card) => {
    toast({
      title: editingCard ? t('cardUpdated') : t('cardCreated'),
      description: editingCard ? t('cardUpdatedSuccess') : t('cardCreatedSuccess'),
      status: 'success',
      duration: 3000,
    });
    
    setRefreshTrigger(prev => prev + 1);
    navigateToList();
  };

  const handleCardSavedAndAddAnother = (card: Card) => {
    toast({
      title: t('cardCreated'),
      description: t('cardCreatedReady'),
      status: 'success',
      duration: 2000,
    });
    
    setRefreshTrigger(prev => prev + 1);
    // Stay on the form - don't navigate away
  };

  const getTitle = () => {
    switch (currentView) {
      case 'create': return 'New Card';
      case 'edit': return 'Edit Card';
      default: return 'Cards';
    }
  };

  if (loading) {
    return (
      <Box bg="#202124" minH="100vh">
        <Center h="100vh">
          <VStack spacing={4}>
            <Spinner size="xl" color="#8AB4F8" />
            <Text color="#9aa0a6" fontSize="lg">{t('loading')}</Text>
          </VStack>
        </Center>
      </Box>
    );
  }

  return (
    <Box bg="#202124" minH="100vh" color="#e8eaed">
      <Container maxW="7xl" py={6}>
        <VStack spacing={6} align="stretch">
          {/* Header */}
          <HStack justify="space-between" align="center">
            <Heading size="lg" color="#e8eaed">{t('rekapuManager')}</Heading>
            
            {currentView === 'list' && (
              <Button
                leftIcon={<AddIcon />}
                bg="#34A853"
                color="white"
                _hover={{ bg: "#46B968" }}
                onClick={navigateToCreate}
                size="sm"
              >
                {t('newCard')}
              </Button>
            )}
          </HStack>

          {/* Main Content */}
          <Box>
            {(currentView === 'create' || currentView === 'edit') ? (
              // Show form view with back navigation
              <VStack spacing={4} align="stretch">
                <HStack>
                  <IconButton
                    icon={<ArrowBackIcon />}
                    aria-label="Back"
                    variant="ghost"
                    color="#9aa0a6"
                    _hover={{ color: "#e8eaed", bg: "#35363a" }}
                    onClick={navigateToList}
                  />
                  <Heading size="md" color="#e8eaed">
                    {currentView === 'create' ? t('newCard') : t('editCard')}
                  </Heading>
                </HStack>
                
                <Suspense fallback={
                  <Center h="50vh">
                    <VStack spacing={4}>
                      <Spinner size="lg" color="#8AB4F8" />
                      <Text color="#9aa0a6">{t('loadingForm')}</Text>
                    </VStack>
                  </Center>
                }>
                  <CardForm
                    card={editingCard || undefined}
                    prefilledText={prefilledText || undefined}
                    onSave={handleCardSaved}
                    onSaveAndAddAnother={currentView === 'create' ? handleCardSavedAndAddAnother : undefined}
                    onCancel={navigateToList}
                  />
                </Suspense>
              </VStack>
            ) : (
              // Show tab-based navigation for main views
              <Tabs 
                index={currentView === 'statistics' ? 1 : currentView === 'import-export' ? 2 : currentView === 'settings' ? 3 : 0}
                onChange={(index) => {
                  if (index === 1) {
                    navigateToStatistics();
                  } else if (index === 2) {
                    navigateToImportExport();
                  } else if (index === 3) {
                    navigateToSettings();
                  } else {
                    navigateToList();
                  }
                }}
                variant="enclosed"
                colorScheme="blue"
              >
                <TabList>
                  <Tab color="#9aa0a6" _selected={{ color: "#202124", bg: "#8AB4F8" }}>
                    {t('cards')}
                  </Tab>
                  <Tab color="#9aa0a6" _selected={{ color: "#202124", bg: "#8AB4F8" }}>
                    {t('statistics')}
                  </Tab>
                  <Tab color="#9aa0a6" _selected={{ color: "#202124", bg: "#8AB4F8" }}>
                    {t('importExport')}
                  </Tab>
                  <Tab color="#9aa0a6" _selected={{ color: "#202124", bg: "#8AB4F8" }}>
                    {t('settings')}
                  </Tab>
                </TabList>

                <TabPanels>
                  <TabPanel p={0} pt={4}>
                    <Suspense fallback={
                      <Center h="50vh">
                        <VStack spacing={4}>
                          <Spinner size="lg" color="#8AB4F8" />
                          <Text color="#9aa0a6">{t('loadingCards')}</Text>
                        </VStack>
                      </Center>
                    }>
                      <CardsList
                        onEditCard={navigateToEdit}
                        refreshTrigger={refreshTrigger}
                      />
                    </Suspense>
                  </TabPanel>
                  
                  <TabPanel p={0} pt={4}>
                    <Suspense fallback={
                      <Center h="50vh">
                        <VStack spacing={4}>
                          <Spinner size="lg" color="#8AB4F8" />
                          <Text color="#9aa0a6">{t('loadingStatistics')}</Text>
                        </VStack>
                      </Center>
                    }>
                      <StatisticsManager onEditCard={handleEditCardById} />
                    </Suspense>
                  </TabPanel>
                  
                  <TabPanel p={0} pt={4}>
                    <Suspense fallback={
                      <Center h="50vh">
                        <VStack spacing={4}>
                          <Spinner size="lg" color="#8AB4F8" />
                          <Text color="#9aa0a6">{t('loadingImportExport')}</Text>
                        </VStack>
                      </Center>
                    }>
                      <ImportExportTab onDataImported={() => setRefreshTrigger(prev => prev + 1)} />
                    </Suspense>
                  </TabPanel>
                  
                  <TabPanel p={0} pt={4}>
                    <Suspense fallback={
                      <Center h="50vh">
                        <VStack spacing={4}>
                          <Spinner size="lg" color="#8AB4F8" />
                          <Text color="#9aa0a6">{t('loadingSettings')}</Text>
                        </VStack>
                      </Center>
                    }>
                      <SettingsTab />
                    </Suspense>
                  </TabPanel>
                </TabPanels>
              </Tabs>
            )}
          </Box>
        </VStack>
      </Container>
    </Box>
  );
}; 