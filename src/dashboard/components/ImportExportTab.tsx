import React, { useState, useRef } from 'react';
import {
  Box,
  VStack,
  HStack,
  Button,
  Text,
  Heading,
  useToast,
  Progress,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Badge,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
  Radio,
  RadioGroup,
  Stack,
  Input,
  FormControl,
  FormLabel,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Select,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Code,
  List,
  ListItem,
  ListIcon,
} from '@chakra-ui/react';
import { DownloadIcon, AttachmentIcon, CheckIcon, WarningIcon, CloseIcon } from '@chakra-ui/icons';
import { BackupAPI, ProgressCallback } from '../../storage/BackupAPI';
import { StorageAPI } from '../../storage/StorageAPI';
import { BackupScope, ConflictStrategy, ImportReport } from '../../types/storage';
import { DataConflict, ConflictResolver } from '../../storage/ConflictResolver';
import { DataSnapshot, ValidationResult } from '../../storage/ImportTransaction';
import { AnkiImporter } from '../../utils/ankiImporter';
import { ApkgImporter } from '../../utils/apkgImporter';
import { TagSelector, TagSelectorRef } from './TagSelector';
import { t } from '../../utils/i18n';

interface OperationProgress {
  isActive: boolean;
  type: 'export' | 'import';
  progress: number;
  status: string;
  operationId?: string;
}

interface ConflictResolution {
  conflictId: string;
  action: ConflictStrategy;
  newId?: string;
}

interface ImportExportTabProps {
  onDataImported?: () => void;
}

export const ImportExportTab: React.FC<ImportExportTabProps> = ({ onDataImported }) => {
  const [progress, setProgress] = useState<OperationProgress>({
    isActive: false,
    type: 'export',
    progress: 0,
    status: ''
  });
  
  // Export states
  const [exportScope, setExportScope] = useState<BackupScope>('cards');
  
  // Import states
  const [importScope, setImportScope] = useState<BackupScope>('cards');
  const [importStrategy, setImportStrategy] = useState<ConflictStrategy>('rename');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [conflicts, setConflicts] = useState<DataConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<ConflictResolution[]>([]);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [backupData, setBackupData] = useState<any>(null);
  
  // Anki import states
  const [ankiFile, setAnkiFile] = useState<File | null>(null);
  const [ankiFileType, setAnkiFileType] = useState<'txt' | 'apkg' | null>(null);
  const [ankiPreview, setAnkiPreview] = useState<Array<{ front: string; back: string; tags: string[] }> | null>(null);
  const [ankiError, setAnkiError] = useState<string | null>(null);
  const [ankiAdditionalTags, setAnkiAdditionalTags] = useState<string[]>([]);
  const [ankiStats, setAnkiStats] = useState<{ totalCards?: number; mediaFiles?: number } | null>(null);
  
  // Recovery states
  const [snapshots, setSnapshots] = useState<DataSnapshot[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  // UI states
  const { isOpen: isConflictModalOpen, onOpen: openConflictModal, onClose: closeConflictModal } = useDisclosure();
  const { isOpen: isReportModalOpen, onOpen: openReportModal, onClose: closeReportModal } = useDisclosure();
  const { isOpen: isRecoveryModalOpen, onOpen: openRecoveryModal, onClose: closeRecoveryModal } = useDisclosure();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ankiFileInputRef = useRef<HTMLInputElement>(null);
  const tagSelectorRef = useRef<TagSelectorRef>(null);
  const toast = useToast();

  const progressCallback: ProgressCallback = (progressValue, status) => {
    setProgress(prev => ({
      ...prev,
      progress: progressValue,
      status
    }));
  };

  const handleExport = async () => {
    try {
      setProgress({
        isActive: true,
        type: 'export',
        progress: 0,
        status: 'Starting export...'
      });

      const blob = await BackupAPI.exportBackup(exportScope, progressCallback);
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rekapu-${exportScope}-backup-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setProgress(prev => ({ ...prev, isActive: false }));
      
      toast({
        title: t('exportComplete'),
        description: exportScope === 'cards' ? t('cardsOnlyBackupExported') : t('fullBackupExported'),
        status: 'success',
        duration: 5000,
      });
    } catch (error) {
      setProgress(prev => ({ ...prev, isActive: false }));
      
      toast({
        title: t('exportFailed'),
        description: error instanceof Error ? error.message : t('unknownError'),
        status: 'error',
        duration: 5000,
      });
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setConflicts([]);
      setConflictResolutions([]);
      setImportReport(null);
    }
  };

  const handleDetectConflicts = async () => {
    if (!selectedFile) return;

    try {
      setProgress({
        isActive: true,
        type: 'import',
        progress: 0,
        status: 'Detecting conflicts...'
      });

      const result = await BackupAPI.detectConflicts(selectedFile, importScope, progressCallback);
      
      setBackupData(result.backupData);
      setConflicts(result.conflicts);
      
      if (result.hasConflicts) {
        // Initialize resolutions with suggested strategies
        const initialResolutions = result.conflicts.map(conflict => ({
          conflictId: conflict.id,
          action: ConflictResolver.getSuggestedResolution(conflict),
          newId: ConflictResolver.getSuggestedResolution(conflict) === 'rename' ? 
            ConflictResolver.generateUniqueId(conflict.id, new Set(), conflict.type as any) : 
            undefined
        }));
        setConflictResolutions(initialResolutions);
        openConflictModal();
      } else {
        // No conflicts, proceed with import
        await handleImportWithResolution([]);
      }

      setProgress(prev => ({ ...prev, isActive: false }));
    } catch (error) {
      setProgress(prev => ({ ...prev, isActive: false }));
      
      toast({
        title: t('conflictDetectionFailed'),
        description: error instanceof Error ? error.message : t('unknownError'),
        status: 'error',
        duration: 5000,
      });
    }
  };

  const handleImportWithResolution = async (resolutions: ConflictResolution[]) => {
    if (!backupData) return;

    try {
      setProgress({
        isActive: true,
        type: 'import',
        progress: 0,
        status: 'Importing data...'
      });

      const report = await BackupAPI.importWithConflictResolution(
        backupData,
        importScope,
        conflicts,
        resolutions,
        progressCallback
      );

      setImportReport(report);
      setProgress(prev => ({ ...prev, isActive: false }));
      
      if (report.success) {
        toast({
          title: t('importComplete'),
          description: t('successfullyImportedXCards', [String(report.summary.cardsImported), report.summary.cardsImported !== 1 ? 's' : '']),
          status: 'success',
          duration: 5000,
        });
        openReportModal();
        
        // Trigger cards list refresh
        onDataImported?.();
      } else {
        toast({
          title: t('importFailed'),
          description: report.errors.join(', '),
          status: 'error',
          duration: 5000,
        });
      }
    } catch (error) {
      setProgress(prev => ({ ...prev, isActive: false }));
      
      toast({
        title: t('importFailed'),
        description: error instanceof Error ? error.message : t('unknownError'),
        status: 'error',
        duration: 5000,
      });
    }
  };

  

  const updateConflictResolution = (conflictId: string, action: ConflictStrategy, newId?: string) => {
    setConflictResolutions(prev => 
      prev.map(res => 
        res.conflictId === conflictId 
          ? { ...res, action, newId }
          : res
      )
    );
  };

  const applyConflictResolutions = () => {
    closeConflictModal();
    handleImportWithResolution(conflictResolutions);
  };

  const loadSnapshots = async () => {
    try {
      const availableSnapshots = await BackupAPI.getAvailableSnapshots();
      setSnapshots(availableSnapshots);
    } catch (error) {
      toast({
        title: t('failedToLoadSnapshots'),
        description: error instanceof Error ? error.message : t('unknownError'),
        status: 'error',
        duration: 5000,
      });
    }
  };

  const handleRestoreSnapshot = async (snapshotId: string) => {
    try {
      await BackupAPI.restoreFromSnapshot(snapshotId);
      closeRecoveryModal();
      
      toast({
        title: t('restoreComplete'),
        description: t('dataRestoredFromSnapshot'),
        status: 'success',
        duration: 5000,
      });
      
      // Refresh snapshots list
      await loadSnapshots();
    } catch (error) {
      toast({
        title: t('restoreFailed'),
        description: error instanceof Error ? error.message : t('unknownError'),
        status: 'error',
        duration: 5000,
      });
    }
  };

  const handleDeleteSnapshot = async (snapshotId: string) => {
    try {
      await BackupAPI.deleteSnapshot(snapshotId);
      await loadSnapshots(); // Refresh list
      
      toast({
        title: t('snapshotDeleted'),
        description: t('backupSnapshotDeleted'),
        status: 'success',
        duration: 3000,
      });
    } catch (error) {
      toast({
        title: t('deleteFailed'),
        description: error instanceof Error ? error.message : t('unknownError'),
        status: 'error',
        duration: 5000,
      });
    }
  };

  const handleValidateIntegrity = async () => {
    try {
      const result = await BackupAPI.validateDataIntegrity();
      setValidationResult(result);
      
      toast({
        title: result.isValid ? t('dataValid') : t('dataIssuesFound'),
        description: result.isValid ? t('allDataValid') : t('xErrorsFound', [String(result.errors.length), result.errors.length !== 1 ? 's' : '']),
        status: result.isValid ? 'success' : 'warning',
        duration: 5000,
      });
    } catch (error) {
      toast({
        title: t('validationFailed'),
        description: error instanceof Error ? error.message : t('unknownError'),
        status: 'error',
        duration: 5000,
      });
    }
  };

  const handleAnkiFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setAnkiFile(file);
    setAnkiError(null);
    setAnkiPreview(null);
    setAnkiStats(null);

    const isApkg = file.name.toLowerCase().endsWith('.apkg');
    setAnkiFileType(isApkg ? 'apkg' : 'txt');

    try {
      if (isApkg) {
        setProgress({
          isActive: true,
          type: 'import',
          progress: 0,
          status: 'Loading import tools...'
        });

        const result = await ApkgImporter.parse(file, {
          onProgress: (prog, status) => {
            setProgress(prev => ({ ...prev, progress: prog, status }));
          }
        });

        setProgress(prev => ({ ...prev, isActive: false }));

        if (!result.success) {
          setAnkiError(result.errors.join(', '));
        } else {
          setAnkiPreview(result.previewCards);
          setAnkiStats({
            totalCards: result.stats.totalCards,
            mediaFiles: result.stats.mediaFiles
          });
          setBackupData(result.backupData);
          
          if (result.warnings.length > 0) {
            toast({
              title: t('importWarnings'),
              description: t('xWarningsDetectedSimple', [String(result.warnings.length), result.warnings.length !== 1 ? 's' : '']),
              status: 'warning',
              duration: 5000,
            });
          }
        }
      } else {
        const result = await AnkiImporter.parse(file);
        
        if (!result.success) {
          setAnkiError(result.errors.join(', '));
          
          if (result.errors.some(e => e.includes('HTML'))) {
            toast({
              title: t('htmlExportDetected'),
              description: result.errors[0],
              status: 'error',
              duration: 10000,
              isClosable: true,
            });
          }
        } else {
          setAnkiPreview(result.previewCards);
          setBackupData(result.backupData);
          
          if (result.warnings.length > 0) {
            toast({
              title: t('importWarnings'),
              description: t('xWarningsDetected', [String(result.warnings.length), result.warnings.length !== 1 ? 's' : '']),
              status: 'warning',
              duration: 5000,
            });
          }
        }
      }
    } catch (error) {
      setProgress(prev => ({ ...prev, isActive: false }));
      setAnkiError(error instanceof Error ? error.message : t('unknownError'));
      toast({
        title: t('parseFailed'),
        description: error instanceof Error ? error.message : t('unknownError'),
        status: 'error',
        duration: 5000,
      });
    }
  };

  const handleAnkiImport = async () => {
    if (!ankiFile || ankiError || !backupData) return;
    
    // Commit any pending tag input (safety net in case blur hasn't fired yet)
    tagSelectorRef.current?.commitPendingInput();
    
    try {
      setProgress({
        isActive: true,
        type: 'import',
        progress: 0,
        status: t('importingAnkiCards')
      });

      // Add additional tags to cards if specified
      let finalBackupData = backupData;
      
      if (ankiAdditionalTags.length > 0 && finalBackupData?.data?.cards) {
        // Fetch existing tags from database to reuse their IDs
        const existingTagsResponse = await StorageAPI.getAllTags();
        const existingTagsByName = new Map<string, any>();
        
        if (existingTagsResponse.success && existingTagsResponse.data) {
          Object.values(existingTagsResponse.data).forEach((tag: any) => {
            existingTagsByName.set(tag.name, tag);
          });
        }
        
        // Clone and add tags directly without re-parsing
        const updatedCards: Record<string, any> = {};
        for (const [cardId, card] of Object.entries(finalBackupData.data.cards as Record<string, any>)) {
          const existingTags = (card.tags as string[]) || [];
          const newTags = [...new Set([...existingTags, ...ankiAdditionalTags])];
          updatedCards[cardId] = { ...card, tags: newTags };
        }
        
        // Add additional tags to tags record, reusing existing tag IDs
        const updatedTags: Record<string, any> = { ...(finalBackupData.data.tags || {}) };
        const now = Date.now();
        
        for (const tagName of ankiAdditionalTags) {
          // Check if tag already exists in backup data
          const existingInBackup = Object.values(updatedTags).find((t: any) => t.name === tagName);
          
          if (!existingInBackup) {
            // Check if tag exists in database
            const existingInDb = existingTagsByName.get(tagName);
            
            if (existingInDb) {
              // Reuse existing tag from database
              updatedTags[tagName] = existingInDb;
            } else {
              // Create new tag
              updatedTags[tagName] = {
                id: `tag_${now}_${Math.random().toString(36).substr(2, 9)}`,
                name: tagName,
                color: `hsl(${Math.abs(tagName.split('').reduce((a, c) => c.charCodeAt(0) + ((a << 5) - a), 0) % 360)}, 70%, 60%)`,
                created: now
              };
            }
          }
        }
        
        finalBackupData = {
          ...finalBackupData,
          data: {
            ...finalBackupData.data,
            cards: updatedCards,
            tags: updatedTags
          }
        };
      }
      
      // Use fast batch import
      const report = await BackupAPI.importCardsBatch(finalBackupData, progressCallback);
      
      setImportReport(report);
      setProgress(prev => ({ ...prev, isActive: false }));
      
      if (report.success) {
        toast({
          title: t('ankiImportComplete'),
          description: t('successfullyImportedCards', [String(report.summary.cardsImported), report.summary.cardsImported !== 1 ? 's' : '']),
          status: 'success',
          duration: 5000,
        });
        openReportModal();
        
        // Trigger cards list refresh
        onDataImported?.();
        
        // Reset Anki import state
        setAnkiFile(null);
        setAnkiFileType(null);
        setAnkiPreview(null);
        setAnkiError(null);
        setAnkiAdditionalTags([]);
        setAnkiStats(null);
        setBackupData(null);
        if (ankiFileInputRef.current) {
          ankiFileInputRef.current.value = '';
        }
      } else {
        toast({
          title: t('ankiImportFailed'),
          description: report.errors.join(', '),
          status: 'error',
          duration: 5000,
        });
      }
    } catch (error) {
      setProgress(prev => ({ ...prev, isActive: false }));
      
      toast({
        title: t('ankiImportFailed'),
        description: error instanceof Error ? error.message : t('unknownError'),
        status: 'error',
        duration: 5000,
      });
    }
  };

  return (
    <VStack spacing={6} align="stretch">
      <Heading size="lg" color="#e8eaed">{t('importAndExport')}</Heading>
      
      {progress.isActive && (
        <Alert status="info" bg="#292a2d" border="1px solid #3c4043">
          <AlertIcon color="#8AB4F8" />
          <VStack align="start" flex={1} spacing={2}>
            <HStack justify="space-between" w="full">
              <Text color="#e8eaed" fontWeight="medium">{progress.status}</Text>
              <Text color="#9aa0a6" fontSize="sm">{progress.progress}%</Text>
            </HStack>
            <Progress 
              value={progress.progress} 
              size="sm" 
              colorScheme="blue" 
              w="full"
              bg="#3c4043"
            />
          </VStack>
        </Alert>
      )}

      {/* Export Section */}
      <Card bg="#202124" border="1px solid #3c4043">
        <CardHeader>
          <HStack>
            <DownloadIcon color="#8AB4F8" />
            <Heading size="md" color="#e8eaed">{t('exportData')}</Heading>
          </HStack>
        </CardHeader>
        <CardBody>
          <VStack spacing={4} align="stretch">
            <FormControl>
              <FormLabel color="#e8eaed">{t('backupScope')}</FormLabel>
              <RadioGroup
                value={exportScope}
                onChange={(value) => setExportScope(value as BackupScope)}
              >
                <Stack direction="column" spacing={3}>
                  <Radio value="cards" colorScheme="blue">
                    <VStack align="start" spacing={1}>
                      <Text color="#e8eaed">{t('cardsOnly')}</Text>
                      <Text color="#9aa0a6" fontSize="sm">{t('exportCardsDesc')}</Text>
                    </VStack>
                  </Radio>
                  <Radio value="full" colorScheme="blue">
                    <VStack align="start" spacing={1}>
                      <Text color="#e8eaed">{t('fullBackup')}</Text>
                      <Text color="#9aa0a6" fontSize="sm">{t('fullBackupDesc')}</Text>
                    </VStack>
                  </Radio>
                </Stack>
              </RadioGroup>
            </FormControl>

            <Button
              leftIcon={<DownloadIcon />}
              colorScheme="blue"
              onClick={handleExport}
              disabled={progress.isActive}
              size="lg"
            >
              {t('exportBackup')}
            </Button>
          </VStack>
        </CardBody>
      </Card>

      <Divider borderColor="#3c4043" />

      {/* Import Section */}
      <Card bg="#202124" border="1px solid #3c4043">
        <CardHeader>
          <HStack>
            <AttachmentIcon color="#8AB4F8" />
            <Heading size="md" color="#e8eaed">{t('importData')}</Heading>
          </HStack>
        </CardHeader>
        <CardBody>
          <VStack spacing={4} align="stretch">
            <FormControl>
              <FormLabel color="#e8eaed">{t('importScope')}</FormLabel>
              <RadioGroup
                value={importScope}
                onChange={(value) => setImportScope(value as BackupScope)}
              >
                <Stack direction="column" spacing={3}>
                  <Radio value="cards" colorScheme="blue">
                    <VStack align="start" spacing={1}>
                      <Text color="#e8eaed">{t('cardsOnly')}</Text>
                      <Text color="#9aa0a6" fontSize="sm">{t('importCardsDesc')}</Text>
                    </VStack>
                  </Radio>
                  <Radio value="full" colorScheme="blue">
                    <VStack align="start" spacing={1}>
                      <Text color="#e8eaed">{t('fullImport')}</Text>
                      <Text color="#9aa0a6" fontSize="sm">{t('fullImportDesc')}</Text>
                    </VStack>
                  </Radio>
                </Stack>
              </RadioGroup>
            </FormControl>

            <FormControl>
              <FormLabel color="#e8eaed">{t('selectBackupFile')}</FormLabel>
              <Input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".zip,.json"
                bg="#292a2d"
                border="1px solid #3c4043"
                color="#e8eaed"
                _hover={{ borderColor: "#8AB4F8" }}
                _focus={{ borderColor: "#8AB4F8", boxShadow: "0 0 0 1px #8AB4F8" }}
              />
              {selectedFile && (
                <Text color="#9aa0a6" fontSize="sm" mt={2}>
                  {t('selectedFile', [selectedFile.name, (selectedFile.size / 1024).toFixed(1)])}
                </Text>
              )}
            </FormControl>

            <Button
              leftIcon={<AttachmentIcon />}
              colorScheme="blue"
              onClick={handleDetectConflicts}
              disabled={!selectedFile || progress.isActive}
              size="lg"
            >
              {t('importBackup')}
            </Button>
          </VStack>
        </CardBody>
      </Card>

      <Divider borderColor="#3c4043" />

      {/* Anki Import Section */}
      <Card bg="#202124" border="1px solid #3c4043">
        <CardHeader>
          <HStack>
            <AttachmentIcon color="#8AB4F8" />
            <Heading size="md" color="#e8eaed">{t('importFromAnki')}</Heading>
          </HStack>
        </CardHeader>
        <CardBody>
          <VStack spacing={4} align="stretch">
            <Alert status="info" bg="#292a2d" border="1px solid #3c4043">
              <AlertIcon color="#8AB4F8" />
              <Box flex="1">
                <AlertTitle color="#e8eaed" fontSize="sm" mb={1}>
                  {t('ankiSupportedFormats')}
                </AlertTitle>
                <AlertDescription color="#9aa0a6" fontSize="sm">
                  {t('ankiFormatApkg')}
                  <br />
                  {t('ankiFormatTxt')}
                </AlertDescription>
              </Box>
            </Alert>

            <FormControl>
              <FormLabel color="#e8eaed">{t('selectAnkiFile')}</FormLabel>
              <Input
                type="file"
                ref={ankiFileInputRef}
                onChange={handleAnkiFileSelect}
                accept=".txt,.apkg"
                bg="#292a2d"
                border="1px solid #3c4043"
                color="#e8eaed"
                _hover={{ borderColor: "#8AB4F8" }}
                _focus={{ borderColor: "#8AB4F8", boxShadow: "0 0 0 1px #8AB4F8" }}
              />
              {ankiFile && !ankiError && (
                <Text color="#9aa0a6" fontSize="sm" mt={2}>
                  {t('selectedFile', [ankiFile.name, (ankiFile.size / 1024).toFixed(1)])}
                  {ankiStats && (
                    <> — {t('ankiStatsInfo', [
                      String(ankiStats.totalCards),
                      ankiStats.mediaFiles ? t('ankiMediaFiles', [String(ankiStats.mediaFiles)]) : ''
                    ])}</>
                  )}
                </Text>
              )}
            </FormControl>

            {ankiError && (
              <Alert status="error" bg="#292a2d" border="1px solid #F28B82">
                <AlertIcon color="#F28B82" />
                <Box>
                  <AlertTitle color="#e8eaed">{t('error')}</AlertTitle>
                  <AlertDescription color="#9aa0a6" fontSize="sm" whiteSpace="pre-wrap">
                    {ankiError}
                  </AlertDescription>
                </Box>
              </Alert>
            )}

            {ankiPreview && ankiPreview.length > 0 && (
              <>
                <Box>
                  <Heading size="sm" color="#e8eaed" mb={2}>
                    {t('previewFirst', [String(ankiPreview.length), ankiPreview.length !== 1 ? 's' : ''])}
                  </Heading>
                  <TableContainer>
                    <Table variant="simple" size="sm">
                      <Thead>
                        <Tr>
                          <Th color="#9aa0a6" borderColor="#3c4043">{t('front')}</Th>
                          <Th color="#9aa0a6" borderColor="#3c4043">{t('back')}</Th>
                          <Th color="#9aa0a6" borderColor="#3c4043">{t('tags')}</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {ankiPreview.map((card, idx) => (
                          <Tr key={idx}>
                            <Td color="#e8eaed" borderColor="#3c4043" fontSize="sm" maxW="200px" isTruncated>
                              {card.front}
                            </Td>
                            <Td color="#e8eaed" borderColor="#3c4043" fontSize="sm" maxW="200px" isTruncated>
                              {card.back}
                            </Td>
                            <Td borderColor="#3c4043">
                              <HStack spacing={1} flexWrap="wrap">
                                {card.tags.length > 0 ? (
                                  card.tags.map((tag, tagIdx) => (
                                    <Badge key={tagIdx} colorScheme="blue" variant="subtle" fontSize="xs">
                                      {tag}
                                    </Badge>
                                  ))
                                ) : (
                                  <Text color="#9aa0a6" fontSize="xs" fontStyle="italic">{t('noTags')}</Text>
                                )}
                              </HStack>
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </TableContainer>
                </Box>

                <FormControl>
                  <FormLabel color="#e8eaed">{t('addTagsToImported')}</FormLabel>
                  <TagSelector
                    ref={tagSelectorRef}
                    selectedTags={ankiAdditionalTags}
                    onChange={setAnkiAdditionalTags}
                    label=""
                    helperText={t('addTagsHelper')}
                    placeholder={t('addTagsPlaceholder')}
                    isDisabled={progress.isActive}
                  />
                </FormControl>
              </>
            )}

            <Button
              leftIcon={<AttachmentIcon />}
              colorScheme="blue"
              onClick={handleAnkiImport}
              disabled={!ankiFile || !!ankiError || !ankiPreview || progress.isActive}
              size="lg"
            >
              {t('importAnkiCards')}
            </Button>
          </VStack>
        </CardBody>
      </Card>

      <Divider borderColor="#3c4043" />

      {/* Recovery Section */}
      <Card bg="#202124" border="1px solid #3c4043">
        <CardHeader>
          <HStack>
            <WarningIcon color="#F28B82" />
            <Heading size="md" color="#e8eaed">{t('dataRecoveryValidation')}</Heading>
          </HStack>
        </CardHeader>
        <CardBody>
          <VStack spacing={4} align="stretch">
            <Text color="#9aa0a6" fontSize="sm">
              {t('manageBackupSnapshots')}
            </Text>

            <HStack spacing={4}>
              <Button
                colorScheme="yellow"
                variant="outline"
                onClick={handleValidateIntegrity}
                disabled={progress.isActive}
              >
                {t('validateData')}
              </Button>
              
              <Button
                colorScheme="red"
                variant="outline"
                onClick={() => {
                  loadSnapshots();
                  openRecoveryModal();
                }}
                disabled={progress.isActive}
              >
                {t('viewSnapshots')}
              </Button>
            </HStack>

            {validationResult && (
              <Alert 
                status={validationResult.isValid ? 'success' : 'warning'} 
                bg="#292a2d" 
                border="1px solid #3c4043"
              >
                <AlertIcon />
                <VStack align="start" flex={1} spacing={1}>
                  <AlertTitle color="#e8eaed">
                    {validationResult.isValid ? t('dataIsValid') : t('dataIssuesFoundTitle')}
                  </AlertTitle>
                  {!validationResult.isValid && (
                    <AlertDescription color="#9aa0a6">
                      {t('xErrorsYWarnings', [
                        String(validationResult.errors.length), 
                        validationResult.errors.length !== 1 ? 's' : '',
                        String(validationResult.warnings.length),
                        validationResult.warnings.length !== 1 ? 's' : ''
                      ])}
                    </AlertDescription>
                  )}
                </VStack>
              </Alert>
            )}
          </VStack>
        </CardBody>
      </Card>

      {/* Recovery Modal */}
      <Modal isOpen={isRecoveryModalOpen} onClose={closeRecoveryModal} size="xl">
        <ModalOverlay />
        <ModalContent bg="#202124" border="1px solid #3c4043">
          <ModalHeader color="#e8eaed">{t('backupSnapshots')}</ModalHeader>
          <ModalCloseButton color="#9aa0a6" />
          <ModalBody pb={6}>
            <VStack spacing={4} align="stretch">
              <Text color="#9aa0a6" fontSize="sm">
                {t('snapshotsCreatedAutomatically')}
              </Text>

              {snapshots.length === 0 ? (
                <Alert status="info" bg="#292a2d" border="1px solid #3c4043">
                  <AlertIcon />
                  <AlertDescription color="#9aa0a6">
                    {t('noBackupSnapshots')}
                  </AlertDescription>
                </Alert>
              ) : (
                <TableContainer>
                  <Table variant="simple" size="sm">
                    <Thead>
                      <Tr>
                        <Th color="#9aa0a6" borderColor="#3c4043">{t('snapshotDate')}</Th>
                        <Th color="#9aa0a6" borderColor="#3c4043">{t('cards')}</Th>
                        <Th color="#9aa0a6" borderColor="#3c4043">{t('tags')}</Th>
                        <Th color="#9aa0a6" borderColor="#3c4043">{t('actions')}</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {snapshots.map((snapshot) => (
                        <Tr key={snapshot.id}>
                          <Td color="#e8eaed" borderColor="#3c4043">
                            {new Date(snapshot.timestamp).toLocaleString()}
                          </Td>
                          <Td color="#9aa0a6" borderColor="#3c4043">
                            {Object.keys(snapshot.cards).length}
                          </Td>
                          <Td color="#9aa0a6" borderColor="#3c4043">
                            {Object.keys(snapshot.tags).length}
                          </Td>
                          <Td borderColor="#3c4043">
                            <HStack spacing={2}>
                              <Button
                                size="xs"
                                colorScheme="blue"
                                onClick={() => handleRestoreSnapshot(snapshot.id)}
                              >
                                {t('snapshotRestore')}
                              </Button>
                              <Button
                                size="xs"
                                colorScheme="red"
                                variant="outline"
                                onClick={() => handleDeleteSnapshot(snapshot.id)}
                              >
                                {t('delete')}
                              </Button>
                            </HStack>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </TableContainer>
              )}
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Conflict Resolution Modal */}
      <Modal isOpen={isConflictModalOpen} onClose={closeConflictModal} size="4xl">
        <ModalOverlay />
        <ModalContent bg="#202124" border="1px solid #3c4043" maxW="800px">
          <ModalHeader color="#e8eaed">
            <HStack>
              <WarningIcon color="#F28B82" />
              <Text>{t('resolveConflicts')}</Text>
            </HStack>
          </ModalHeader>
          <ModalCloseButton color="#9aa0a6" />
          <ModalBody pb={6}>
            <VStack spacing={4} align="stretch">
              <Alert status="warning" bg="#292a2d" border="1px solid #3c4043">
                <AlertIcon color="#F28B82" />
                <AlertDescription color="#e8eaed">
                  {t('conflictsDetectedChoose', [String(conflicts.length), conflicts.length > 1 ? 's' : ''])}
                </AlertDescription>
              </Alert>

              <TableContainer>
                <Table variant="simple" size="sm">
                  <Thead>
                    <Tr>
                      <Th color="#9aa0a6" borderColor="#3c4043">{t('item')}</Th>
                      <Th color="#9aa0a6" borderColor="#3c4043">{t('conflict')}</Th>
                      <Th color="#9aa0a6" borderColor="#3c4043">{t('resolution')}</Th>
                      <Th color="#9aa0a6" borderColor="#3c4043">{t('newId')}</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {conflicts.map((conflict, index) => {
                      const resolution = conflictResolutions[index];
                      return (
                        <Tr key={conflict.id}>
                          <Td borderColor="#3c4043">
                            <VStack align="start" spacing={1}>
                              <HStack>
                                <Badge colorScheme="blue" variant="outline">
                                  {conflict.type}
                                </Badge>
                                <Code fontSize="xs" bg="#292a2d" color="#e8eaed">
                                  {conflict.id}
                                </Code>
                              </HStack>
                            </VStack>
                          </Td>
                          <Td borderColor="#3c4043">
                            <Text color="#e8eaed" fontSize="sm">
                              {ConflictResolver.getConflictDescription(conflict)}
                            </Text>
                          </Td>
                          <Td borderColor="#3c4043">
                            <Select
                              size="sm"
                              value={resolution?.action || 'rename'}
                              onChange={(e) => updateConflictResolution(
                                conflict.id, 
                                e.target.value as ConflictStrategy
                              )}
                              bg="#292a2d"
                              borderColor="#3c4043"
                              color="#e8eaed"
                              minW="100px"
                            >
                              <option value="overwrite">{t('overwrite')}</option>
                              <option value="rename">{t('rename')}</option>
                              <option value="skip">{t('skip')}</option>
                            </Select>
                          </Td>
                          <Td borderColor="#3c4043">
                            {resolution?.action === 'rename' && (
                              <Input
                                size="sm"
                                value={resolution.newId || ''}
                                onChange={(e) => updateConflictResolution(
                                  conflict.id,
                                  'rename',
                                  e.target.value
                                )}
                                bg="#292a2d"
                                borderColor="#3c4043"
                                color="#e8eaed"
                                fontSize="xs"
                                minW="120px"
                              />
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </TableContainer>

              <HStack justify="flex-end" spacing={3}>
                <Button variant="ghost" onClick={closeConflictModal}>
                  {t('cancel')}
                </Button>
                <Button colorScheme="blue" onClick={applyConflictResolutions}>
                  {t('applyResolutionsImport')}
                </Button>
              </HStack>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Import Report Modal */}
      <Modal isOpen={isReportModalOpen} onClose={closeReportModal} size="lg">
        <ModalOverlay />
        <ModalContent bg="#202124" border="1px solid #3c4043">
          <ModalHeader color="#e8eaed">{t('importReport')}</ModalHeader>
          <ModalCloseButton color="#9aa0a6" />
          <ModalBody pb={6}>
            {importReport && (
              <VStack spacing={4} align="stretch">
                <Alert status={importReport.success ? "success" : "error"} bg="#292a2d" border="1px solid #3c4043">
                  <AlertIcon color={importReport.success ? "#34A853" : "#F28B82"} />
                  <AlertTitle color="#e8eaed">
                    {importReport.success ? t('importSuccessful') : t('importFailed')}
                  </AlertTitle>
                </Alert>

                <Box>
                  <Heading size="sm" color="#e8eaed" mb={3}>{t('summary')}</Heading>
                  <List spacing={2}>
                    <ListItem color="#e8eaed">
                      <ListIcon as={CheckIcon} color="#34A853" />
                      {t('cardsImported', [String(importReport.summary.cardsImported)])}
                    </ListItem>
                    <ListItem color="#e8eaed">
                      <ListIcon as={CheckIcon} color="#34A853" />
                      {t('tagsImported', [String(importReport.summary.tagsImported)])}
                    </ListItem>
                    {importReport.summary.cardsSkipped > 0 && (
                      <ListItem color="#e8eaed">
                        <ListIcon as={WarningIcon} color="#F28B82" />
                        {t('cardsSkipped', [String(importReport.summary.cardsSkipped)])}
                      </ListItem>
                    )}
                    {importReport.summary.cardsRenamed > 0 && (
                      <ListItem color="#e8eaed">
                        <ListIcon as={CheckIcon} color="#8AB4F8" />
                        {t('cardsRenamed', [String(importReport.summary.cardsRenamed)])}
                      </ListItem>
                    )}
                  </List>
                </Box>

                {importReport.errors.length > 0 && (
                  <Box>
                    <Heading size="sm" color="#F28B82" mb={3}>{t('errors')}</Heading>
                    <List spacing={1}>
                      {importReport.errors.map((error, index) => (
                        <ListItem key={index} color="#F28B82" fontSize="sm">
                          <ListIcon as={CloseIcon} />
                          {error}
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                )}
              </VStack>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </VStack>
  );
}; 