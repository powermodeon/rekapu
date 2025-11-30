import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  FormControl,
  FormLabel,
  FormHelperText,
  Textarea,
  Flex,
  IconButton,
  Tooltip,
} from '@chakra-ui/react';
import { ViewIcon, EditIcon } from '@chakra-ui/icons';
import { renderMarkdown } from '../../utils/markdownRenderer';
import { renderClozeWithMask } from '../../utils/clozeParser';
import { t } from '../../utils/i18n';
import '../../styles/markdown.css';

interface LiveMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  helperText?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  minHeight?: string;
  cardType?: 'basic' | 'cloze';
}

type ViewMode = 'edit' | 'preview' | 'split';

export const LiveMarkdownEditor: React.FC<LiveMarkdownEditorProps> = ({
  value,
  onChange,
  label,
  placeholder,
  helperText,
  isRequired = false,
  isDisabled = false,
  minHeight = '200px',
  cardType,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const blobUrlsRef = useRef<string[]>([]);
  
  const renderedContent = useMemo(() => {
    if (!value) return '';
    
    // Check if content contains HTML (from imported Anki cards)
    const hasHtml = /<\w+[^>]*>/.test(value);
    
    if (cardType === 'cloze') {
      const clozeRegex = /\{\{c(\d+)::([^:}]+)(?:::([^}]*))?\}\}/g;
      const matches = [...value.matchAll(clozeRegex)];
      
      if (matches.length === 0) {
        return renderMarkdown(value, hasHtml);
      }
      
      const previews = matches.map((match, index) => {
        const clozeId = parseInt(match[1], 10);
        const maskedText = renderClozeWithMask(value, clozeId, '[...]');
        const renderedMasked = renderMarkdown(maskedText, hasHtml);
        return `<div class="cloze-preview">
          <div class="cloze-preview-header">Card ${clozeId}:</div>
          ${renderedMasked}
        </div>`;
      });
      
      return previews.join('');
    }
    
    return renderMarkdown(value, hasHtml);
  }, [value, cardType]);

  // Resolve media URLs for imported Anki content
  useEffect(() => {
    if (!previewRef.current) return;
    
    let aborted = false;
    
    // Revoke previous blob URLs before creating new ones
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
    
    const resolveMediaUrls = async () => {
      const mediaElements = previewRef.current?.querySelectorAll('[data-media-id]');
      if (!mediaElements || mediaElements.length === 0) return;
      
      for (const element of mediaElements) {
        if (aborted) return;
        
        const mediaId = element.getAttribute('data-media-id');
        if (!mediaId) continue;
        
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'GET_MEDIA_URL',
            mediaId: mediaId
          });
          
          if (aborted) return;
          
          if (response && response.success && response.data) {
            const uint8Array = new Uint8Array(response.data);
            const blob = new Blob([uint8Array], { type: response.mimeType || 'application/octet-stream' });
            const blobUrl = URL.createObjectURL(blob);
            blobUrlsRef.current.push(blobUrl);
            
            if (element.tagName === 'IMG') {
              (element as HTMLImageElement).src = blobUrl;
            } else if (element.tagName === 'AUDIO' || element.tagName === 'VIDEO') {
              (element as HTMLAudioElement | HTMLVideoElement).src = blobUrl;
              (element as HTMLAudioElement | HTMLVideoElement).load();
            }
          }
        } catch {
          // Silently handle errors for media that can't be loaded
        }
      }
    };
    
    resolveMediaUrls();
    
    return () => {
      aborted = true;
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    };
  }, [renderedContent]);

  // Sync scroll between editor and preview
  const handleEditorScroll = () => {
    if (!textareaRef.current || !previewRef.current || viewMode !== 'split') return;
    
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    
    const scrollTop = textarea.scrollTop;
    const scrollHeight = textarea.scrollHeight - textarea.clientHeight;
    const scrollPercent = scrollHeight > 0 ? scrollTop / scrollHeight : 0;
    
    const previewScrollHeight = preview.scrollHeight - preview.clientHeight;
    preview.scrollTop = previewScrollHeight * scrollPercent;
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
    onChange(e.target.value);
  };

  // Focus textarea when edit mode is selected
  useEffect(() => {
    if (viewMode === 'edit' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [viewMode]);

            const getViewModeIcon = (mode: ViewMode) => {
            switch (mode) {
              case 'edit': return <EditIcon />;
              case 'preview': return <ViewIcon />;
              case 'split': return <span>⫸</span>;
              default: return <EditIcon />;
            }
          };

  const getNextViewMode = (current: ViewMode): ViewMode => {
    switch (current) {
      case 'edit': return 'preview';
      case 'preview': return 'split';
      case 'split': return 'edit';
      default: return 'edit';
    }
  };

  return (
    <FormControl isRequired={isRequired} isDisabled={isDisabled}>
      <Flex align="center" justify="space-between" mb={2}>
        <FormLabel color="#e8eaed" fontSize="sm" fontWeight="medium" mb={0}>
          {label}
        </FormLabel>
        
        <Tooltip 
          label={`Switch to ${getNextViewMode(viewMode)} mode`}
          placement="top"
        >
          <IconButton
            aria-label={t('toggleViewMode')}
            icon={getViewModeIcon(viewMode)}
            size="sm"
            variant="ghost"
            color="#9aa0a6"
            _hover={{ 
              color: "#e8eaed",
              backgroundColor: "#292a2d"
            }}
            onClick={() => setViewMode(getNextViewMode(viewMode))}
          />
        </Tooltip>
      </Flex>
      
      <Box
        border="1px solid #3c4043"
        borderRadius="6px"
        backgroundColor="#292a2d"
        minHeight={minHeight}
        overflow="hidden"
        _focusWithin={{
          borderColor: "#8AB4F8",
          boxShadow: "0 0 0 1px #8AB4F8"
        }}
      >
        <Flex height="100%">
          {/* Editor Pane */}
          {(viewMode === 'edit' || viewMode === 'split') && (
            <Box
              flex={viewMode === 'split' ? 1 : 'none'}
              width={viewMode === 'edit' ? '100%' : '50%'}
              borderRight={viewMode === 'split' ? "1px solid #3c4043" : 'none'}
            >
              <Textarea
                ref={textareaRef}
                value={value}
                onChange={handleInput}
                onScroll={handleEditorScroll}
                placeholder={placeholder || 'Type your markdown here...'}
                resize="none"
                border="none"
                borderRadius="0"
                backgroundColor="transparent"
                color="#e8eaed"
                fontSize="14px"
                fontFamily="'JetBrains Mono', 'SF Mono', Monaco, Inconsolata, 'Roboto Mono', 'Source Code Pro', monospace"
                minHeight={minHeight}
                height="auto"
                _focus={{
                  border: "none",
                  boxShadow: "none"
                }}
                _placeholder={{
                  color: "#5f6368"
                }}
                sx={{
                  // Custom scrollbar
                  '&::-webkit-scrollbar': {
                    width: '8px',
                  },
                  '&::-webkit-scrollbar-track': {
                    background: '#202124',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    background: '#3c4043',
                    borderRadius: '4px',
                  },
                  '&::-webkit-scrollbar-thumb:hover': {
                    background: '#5f6368',
                  },
                }}
              />
            </Box>
          )}

          {/* Preview Pane */}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <Box
              ref={previewRef}
              flex={viewMode === 'split' ? 1 : 'none'}
              width={viewMode === 'preview' ? '100%' : '50%'}
              padding="12px"
              overflow="auto"
              backgroundColor={viewMode === 'split' ? '#202124' : 'transparent'}
              sx={{
                // Custom scrollbar for preview
                '&::-webkit-scrollbar': {
                  width: '8px',
                },
                '&::-webkit-scrollbar-track': {
                  background: '#202124',
                },
                '&::-webkit-scrollbar-thumb': {
                  background: '#3c4043',
                  borderRadius: '4px',
                },
                '&::-webkit-scrollbar-thumb:hover': {
                  background: '#5f6368',
                }
              }}
            >
              {value.trim() ? (
                <div className="markdown-content" dangerouslySetInnerHTML={{ __html: renderedContent as string }} />
              ) : (
                <div style={{ 
                  color: '#5f6368', 
                  fontStyle: 'italic',
                  textAlign: 'center',
                  paddingTop: '20px'
                }}>
                  {t('previewWillAppearHere')}
                </div>
              )}
            </Box>
          )}
        </Flex>
      </Box>

      {helperText && (
        <FormHelperText color="#9aa0a6" fontSize="xs" mt={2}>
          {helperText}
        </FormHelperText>
      )}
    </FormControl>
  );
};