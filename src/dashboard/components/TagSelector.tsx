import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Input,
  Tag as ChakraTag,
  TagLabel,
  TagCloseButton,
  Wrap,
  WrapItem,
  FormControl,
  FormLabel,
  FormHelperText,
  List,
  ListItem,
  Button,
} from '@chakra-ui/react';
import { StorageAPI } from '../../storage/StorageAPI';
import { t } from '../../utils/i18n';

interface TagSelectorProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  helperText?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  placeholder?: string;
  refreshTrigger?: number;
}

export interface TagSelectorRef {
  commitPendingInput: () => void;
}

export const TagSelector = forwardRef<TagSelectorRef, TagSelectorProps>(({
  selectedTags,
  onChange,
  label,
  helperText,
  isRequired = false,
  isDisabled = false,
  placeholder,
  refreshTrigger = 0,
}, ref) => {
  const [inputValue, setInputValue] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Commit any pending input (called before form submission)
  const commitPendingInput = () => {
    if (inputValue.trim()) {
      addTags(inputValue);
      setInputValue('');
    }
  };

  // Expose commitPendingInput to parent via ref
  useImperativeHandle(ref, () => ({
    commitPendingInput
  }), [inputValue, selectedTags]);

  // Load existing tags on component mount
  useEffect(() => {
    loadAvailableTags();
  }, []);

  // Reload available tags when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger > 0) {
      loadAvailableTags();
    }
  }, [refreshTrigger]);

  // Update filtered suggestions when input or available tags change
  useEffect(() => {
    if (inputValue.trim()) {
      const filtered = availableTags.filter(tag => 
        tag.toLowerCase().includes(inputValue.toLowerCase()) &&
        !selectedTags.includes(tag)
      );
      setFilteredSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setHighlightedIndex(-1);
    } else {
      // When input is empty, don't show suggestions unless focused
      if (!showSuggestions) {
        setFilteredSuggestions([]);
      }
      setHighlightedIndex(-1);
    }
  }, [inputValue, availableTags, selectedTags]);

  const loadAvailableTags = async () => {
    try {
      // Get tags from tags table (source of truth)
      const tagsResult = await StorageAPI.getAllTags();

      if (tagsResult.success && tagsResult.data) {
        const tags = Object.values(tagsResult.data);
        
        // Sort by creation date (most recent first), then alphabetically
        const sortedTags = tags
          .sort((a, b) => {
            // First by creation date (newest first)
            if (b.created !== a.created) {
              return b.created - a.created;
            }
            // Then alphabetically
            return a.name.localeCompare(b.name);
          })
          .map(tag => tag.name);
        
        setAvailableTags(sortedTags);
      }
    } catch (error) {
      console.error('Failed to load available tags:', error);
    }
  };

  const addTags = (input: string) => {
    // Split by space, comma, or both and filter out empty strings
    const newTags = input
      .split(/[,\s]+/)
      .map(tag => tag.trim())
      .filter(tag => tag && !selectedTags.includes(tag));
    
    if (newTags.length > 0) {
      onChange([...selectedTags, ...newTags]);
    }
  };

  const removeTag = (tagToRemove: string) => {
    onChange(selectedTags.filter(tag => tag !== tagToRemove));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    
    // Auto-add tags when user types comma or presses space after a word
    if (value.includes(',') || value.includes(' ')) {
      const lastChar = value[value.length - 1];
      if (lastChar === ',' || lastChar === ' ') {
        const tagToAdd = value.slice(0, -1).trim();
        if (tagToAdd && !selectedTags.includes(tagToAdd)) {
          onChange([...selectedTags, tagToAdd]);
        }
        setInputValue('');
      }
    }
  };

  const selectTag = (tag: string) => {
    if (!selectedTags.includes(tag)) {
      onChange([...selectedTags, tag]);
    }
    setInputValue('');
    setShowSuggestions(false);
    setHighlightedIndex(-1);
    
    // Keep input focused so user can immediately select another tag
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && filteredSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        );
      } else if (e.key === 'Enter' && highlightedIndex >= 0) {
        e.preventDefault();
        selectTag(filteredSuggestions[highlightedIndex]);
        return;
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
        setHighlightedIndex(-1);
        return;
      }
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (inputValue.trim()) {
        addTags(inputValue);
        setInputValue('');
      }
    } else if (e.key === 'Backspace' && !inputValue && selectedTags.length > 0) {
      // Remove last tag when backspace is pressed on empty input
      onChange(selectedTags.slice(0, -1));
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Only hide suggestions if focus is not moving to the suggestions container
    if (!suggestionsRef.current?.contains(e.relatedTarget as Node)) {
      setShowSuggestions(false);
      setHighlightedIndex(-1);
      if (inputValue.trim()) {
        addTags(inputValue);
        setInputValue('');
      }
    }
  };

  const handleInputFocus = () => {
    if (inputValue.trim()) {
      // If there's input, show filtered suggestions
      if (filteredSuggestions.length > 0) {
        setShowSuggestions(true);
      }
    } else {
      // If no input, show all available tags (recently used first)
      const recentTags = availableTags.filter(tag => !selectedTags.includes(tag));
      setFilteredSuggestions(recentTags);
      setShowSuggestions(recentTags.length > 0);
      setHighlightedIndex(-1);
    }
  };

  return (
    <FormControl isRequired={isRequired} isDisabled={isDisabled}>
      <FormLabel color="#e8eaed" fontSize="sm" fontWeight="medium">
        {label || t('tags')}
      </FormLabel>
      
      <VStack spacing={3} align="stretch">
        <Box position="relative">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onFocus={handleInputFocus}
            onClick={handleInputFocus}
            placeholder={placeholder || t('tagsPlaceholder')}
            bg="#292a2d"
            borderColor="#3c4043"
            color="#e8eaed"
            fontSize="sm"
            _hover={{ borderColor: '#5f6368' }}
            _focus={{
              borderColor: '#8AB4F8',
              boxShadow: '0 0 0 3px rgba(138, 180, 248, 0.3)',
            }}
            _placeholder={{ color: '#5f6368' }}
            isDisabled={isDisabled}
          />
          
          {showSuggestions && filteredSuggestions.length > 0 && (
            <Box
              ref={suggestionsRef}
              position="absolute"
              top="100%"
              left={0}
              right={0}
              zIndex={10}
              bg="#292a2d"
              borderColor="#3c4043"
              borderWidth="1px"
              borderRadius="md"
              borderTopRadius={0}
              borderTopWidth={0}
              maxH="200px"
              overflowY="auto"
              boxShadow="0 4px 12px rgba(0, 0, 0, 0.3)"
            >
              {!inputValue.trim() && (
                <Box px={3} py={1} bg="#202124" borderBottom="1px solid #3c4043">
                  <Text fontSize="xs" color="#9aa0a6" fontWeight="medium">
                    {t('mostRecentTags')}
                  </Text>
                </Box>
              )}
              <List spacing={0}>
                {filteredSuggestions.slice(0, inputValue.trim() ? 10 : 3).map((tag, index) => (
                  <ListItem key={tag}>
                    <Button
                      variant="ghost"
                      size="sm"
                      width="100%"
                      justifyContent="flex-start"
                      px={3}
                      py={2}
                      borderRadius={0}
                      color="#e8eaed"
                      bg={index === highlightedIndex ? '#8AB4F8' : 'transparent'}
                      _hover={{ bg: index === highlightedIndex ? '#A8C7FA' : '#35363a' }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectTag(tag);
                      }}
                      fontWeight="normal"
                    >
                      {tag}
                    </Button>
                  </ListItem>
                ))}
              </List>
              {!inputValue.trim() && filteredSuggestions.length > 3 && (
                <Box px={3} py={1} bg="#202124" borderTop="1px solid #3c4043">
                  <Text fontSize="xs" color="#5f6368" textAlign="center">
                    {t('typeToSearchMoreTags', [String(filteredSuggestions.length - 3)])}
                  </Text>
                </Box>
              )}
              {inputValue.trim() && filteredSuggestions.length > 10 && (
                <Box px={3} py={1} bg="#202124" borderTop="1px solid #3c4043">
                  <Text fontSize="xs" color="#5f6368" textAlign="center">
                    {t('moreResults', [String(filteredSuggestions.length - 10)])}
                  </Text>
                </Box>
              )}
            </Box>
          )}
        </Box>
        
        {selectedTags.length > 0 && (
          <Box>
            <Wrap spacing={2}>
              {selectedTags.map((tag) => (
                <WrapItem key={tag}>
                  <ChakraTag
                    size="sm"
                    bg="#8AB4F8"
                    color="#202124"
                    borderRadius="full"
                    _hover={{ bg: '#A8C7FA' }}
                  >
                    <TagLabel>{tag}</TagLabel>
                    <TagCloseButton
                      onClick={() => removeTag(tag)}
                      isDisabled={isDisabled}
                    />
                  </ChakraTag>
                </WrapItem>
              ))}
            </Wrap>
          </Box>
        )}
      </VStack>

      <HStack justify="space-between" mt={2}>
        <FormHelperText color="#9aa0a6" fontSize="xs" flex={1}>
          {helperText || t('tagsHelperText')}
        </FormHelperText>
        
        {selectedTags.length > 0 && (
          <Text color="#5f6368" fontSize="xs">
            {t('tagCount', [String(selectedTags.length), selectedTags.length === 1 ? '' : 's'])}
          </Text>
        )}
      </HStack>
    </FormControl>
  );
}); 