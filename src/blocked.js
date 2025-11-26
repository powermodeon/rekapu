/**
 * Initialize i18n translations for all elements with data-i18n attributes
 */
function initializeI18n() {
    // Replace text content for elements with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.textContent = message;
        }
    });
    
    // Replace placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.placeholder = message;
        }
    });
    
    // Replace title attributes
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
        const key = element.getAttribute('data-i18n-title');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.title = message;
        }
    });
    
    // Replace data-shortcut attributes (for tooltips)
    document.querySelectorAll('[data-i18n-shortcut]').forEach(element => {
        const key = element.getAttribute('data-i18n-shortcut');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.setAttribute('data-shortcut', message);
        }
    });
    
    // Update document title
    document.title = chrome.i18n.getMessage('websiteBlocked') || 'Website Blocked';
}

let blockingCurrentCard = null;
let currentDomain = '';
let usedCardIds = new Set();
let pendingDifficultyFeedback = null; // Store card response data for difficulty feedback
let currentAudio = null; // Store current playing audio
let isTTSPlaying = false;
let preloadedAudioData = null; // Pre-loaded audio DATA (raw bytes) for instant playback
let preloadedFrontAudioData = null; // Pre-loaded front audio DATA (raw bytes) for instant playback
let isLoadingAudio = false;
let isFrontTTSPlaying = false;
let isStudyMode = false; // Flag for study session mode (voluntary study vs blocking)
let mediaBlobUrls = []; // Track blob URLs for cleanup

function safeMarkdownRender(text) {
    if (!text) return '';
    if (window.marked && window.marked.parse) {
        if (!window.markedConfigured) {
            window.marked.use({
                breaks: true,
                gfm: true
                // HTML is now allowed for imported Anki cards with media
            });
            window.markedConfigured = true;
        }
        let rendered = window.marked.parse(text);
        
        // Sanitize HTML with DOMPurify if available
        if (window.DOMPurify) {
            rendered = window.DOMPurify.sanitize(rendered, {
                ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre', 
                              'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                              'a', 'img', 'audio', 'video', 'source', 'div', 'span', 'table', 
                              'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'hr'],
                ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'controls', 
                              'data-media-id', 'data-filename', 'type', 'width', 'height', 'target', 'rel'],
                ALLOW_DATA_ATTR: true
            });
        }
        
        // Strip src from media elements with data-media-id (will be resolved from IndexedDB)
        rendered = stripMediaSrc(rendered);
        
        return rendered;
    }
    return text;
}

/**
 * Strip src from media elements that have data-media-id
 * These will be resolved from IndexedDB at render time
 */
function stripMediaSrc(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString('<div>' + html + '</div>', 'text/html');
    const container = doc.body.firstChild;
    
    // Find all elements with data-media-id
    const mediaElements = container.querySelectorAll('[data-media-id]');
    
    mediaElements.forEach(function(el) {
        // Remove src attribute
        el.removeAttribute('src');
        
        // Also remove any source children (for audio/video elements with old format)
        const sources = el.querySelectorAll('source');
        sources.forEach(function(source) { source.remove(); });
    });
    
    return container.innerHTML;
}

/**
 * Resolve media URLs for elements with data-media-id attributes
 * Fetches media data from IndexedDB and creates blob URLs
 */
async function resolveMediaUrls(containerElement) {
    // Clean up previous blob URLs
    mediaBlobUrls.forEach(url => URL.revokeObjectURL(url));
    mediaBlobUrls = [];
    
    // Find all elements with data-media-id (img, audio, video)
    const mediaElements = containerElement.querySelectorAll('[data-media-id]');
    
    for (const element of mediaElements) {
        const mediaId = element.getAttribute('data-media-id');
        if (!mediaId) continue;
        
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'GET_MEDIA_URL',
                mediaId: mediaId
            });
            
            if (response && response.success && response.data) {
                // Convert array back to Uint8Array and create blob
                const uint8Array = new Uint8Array(response.data);
                const blob = new Blob([uint8Array], { type: response.mimeType || 'application/octet-stream' });
                const blobUrl = URL.createObjectURL(blob);
                mediaBlobUrls.push(blobUrl);
                
                // Handle different element types
                if (element.tagName === 'IMG') {
                    element.src = blobUrl;
                } else if (element.tagName === 'AUDIO' || element.tagName === 'VIDEO') {
                    element.src = blobUrl;
                    element.load();
                }
            } else {
                console.warn('Media not found:', mediaId, response?.error);
            }
        } catch (error) {
            console.error('Error loading media:', mediaId, error);
        }
    }
}

// Helper function to redirect to original URL
async function redirectToOriginalUrl() {
    try {
        const originalUrlResponse = await chrome.runtime.sendMessage({
            type: 'GET_ORIGINAL_URL',
            domain: currentDomain
        });
        
        const redirectUrl = originalUrlResponse.originalUrl || `https://${currentDomain}`;
        window.location.href = redirectUrl;
    } catch (error) {
        console.error('Error getting original URL, using fallback:', error);
        window.location.href = `https://${currentDomain}`;
    }
}

// Get domain from current URL and detect study mode
function getDomainFromURL() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        
        // Check if this is study mode
        const mode = urlParams.get('mode');
        if (mode === 'study') {
            isStudyMode = true;
            return null; // No domain in study mode
        }
        
        const domain = urlParams.get('blocked');
        if (domain) {
            return domain;
        }
        
        // Fallback: parse from current URL hostname
        const url = new URL(window.location.href);
        return url.hostname.replace(/^www\./, '');
    } catch (error) {
        console.error('Error parsing URL:', error);
        return 'unknown';
    }
}

/**
 * Generate card input HTML based on card type
 */
function generateCardInterface(card) {
    const answerContainer = document.getElementById('answerContainer');
    
    switch (card.type) {
        case 'basic':
            return generateShowAnswer(card);
        case 'cloze':
            return generateClozeInterface(card);
        default:
            return generateShowAnswer(card);
    }
}

async function generateShowAnswer(card) {
    const answerContainer = document.getElementById('answerContainer');
    const inputContainer = document.getElementById('inputContainer');
    const answerSection = document.getElementById('answerSection');
    
    // Hide input container initially, answer section will be shown when revealed
    inputContainer.style.display = 'none';
    answerSection.style.display = 'none';
    
    const renderedAnswer = safeMarkdownRender(card.back);
    
    answerContainer.innerHTML = `
        <div class="show-answer-label" data-i18n="answer">Back</div>
        <div class="show-answer-text markdown-content">${renderedAnswer}</div>
        <input type="hidden" id="show-answer-value" value="not-shown" />
    `;
    
    // Resolve media URLs for images/audio in the answer
    await resolveMediaUrls(answerContainer);
    
    // Update submit button text for basic cards
    document.getElementById('submitText').textContent = chrome.i18n.getMessage('showAnswer');
}

function generateClozeInterface(card) {
    const answerContainer = document.getElementById('answerContainer');
    const inputContainer = document.getElementById('inputContainer');
    const answerSection = document.getElementById('answerSection');
    
    // Clear answer container and hide answer section
    answerContainer.innerHTML = '';
    answerSection.style.display = 'none';
    
    // For cloze cards, we need to get the current deletion being tested
    const currentDeletion = card.currentDeletion || { id: 1, text: '', hint: '' };
    
    // Replace the input container with our cloze input
    inputContainer.innerHTML = `
        <input type="text" id="clozeAnswerInput" class="answer-input" 
               data-i18n-placeholder="fillInTheBlank" placeholder="${chrome.i18n.getMessage('fillInTheBlank')}" autocomplete="off" />
        ${currentDeletion.hint ? `<div style="margin-top: 0.5rem; color: #666; font-style: italic; text-align: center;">Hint: ${currentDeletion.hint}</div>` : ''}
    `;
    
    // Show the input container
    inputContainer.style.display = 'block';
    
    // Focus on the input and add Enter key listener
    setTimeout(() => {
        const input = document.getElementById('clozeAnswerInput');
        if (input) {
            input.focus();
            // Add Enter key event listener
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submitAnswer();
                }
            });
        }
    }, 100);
    
    // Update submit button text
    document.getElementById('submitText').textContent = chrome.i18n.getMessage('checkAnswer');
}


/**
 * Reveal answer for show-type cards
 */
function revealAnswer() {
    const answerSection = document.getElementById('answerSection');
    if (answerSection) {
        answerSection.style.display = 'block';
    }
    
    // Show back TTS button if enabled and cardSide allows it
    const ttsButton = document.getElementById('ttsButton');
    if (ttsButton && window.ttsEnabled && (window.ttsCardSide === 'back' || window.ttsCardSide === 'both')) {
        ttsButton.style.display = 'flex';
        ttsButton.disabled = true; // Disable until audio loads
        // Pre-load audio for instant playback
        preloadTTSAudio('back');
    } else if (ttsButton) {
        ttsButton.style.display = 'none';
    }
}

/**
 * Show correct answer when user answered incorrectly
 */
async function showCorrectAnswer(correctAnswer) {
    const answerContainer = document.getElementById('answerContainer');
    const answerSection = document.getElementById('answerSection');
    
    const renderedAnswer = safeMarkdownRender(correctAnswer);
    
    answerContainer.innerHTML = `
        <div class="show-answer-label">Correct Answer</div>
        <div class="show-answer-text markdown-content">${renderedAnswer}</div>
    `;
    
    // Resolve media URLs for images/audio in the answer
    await resolveMediaUrls(answerContainer);
    
    answerSection.style.display = 'block';
    
    // Show back TTS button if enabled and cardSide allows it
    const ttsButton = document.getElementById('ttsButton');
    if (ttsButton && window.ttsEnabled && (window.ttsCardSide === 'back' || window.ttsCardSide === 'both')) {
        ttsButton.style.display = 'flex';
        ttsButton.disabled = true; // Disable until audio loads
        // Pre-load audio for instant playback
        preloadTTSAudio('back');
    } else if (ttsButton) {
        ttsButton.style.display = 'none';
    }
}

/**
 * Collect answer based on card type
 */
function collectAnswer() {
    if (!blockingCurrentCard) {
        return '';
    }

    switch (blockingCurrentCard.type) {
        case 'basic':
            const hiddenInput = document.getElementById('show-answer-value');
            return hiddenInput ? hiddenInput.value : 'not-shown';

        case 'cloze':
            const clozeInput = document.getElementById('clozeAnswerInput');
            return clozeInput ? clozeInput.value.trim() : '';

        default:
            return '';
    }
}

// Initialize the blocking page
async function init() {
    currentDomain = getDomainFromURL();
    
    // Adapt UI for study mode
    if (isStudyMode) {
        // Add class to html element for dark background
        document.documentElement.classList.add('study-mode');
        
        document.querySelector('h1').textContent = chrome.i18n.getMessage('studySession');
        document.getElementById('domainName').style.display = 'none';
        document.querySelector('.description').textContent = chrome.i18n.getMessage('reviewYourDueCards');
        
        // Hide skip button in study mode
        const skipBtn = document.getElementById('skipBtn');
        if (skipBtn) {
            skipBtn.style.display = 'none';
        }
    } else {
        document.getElementById('domainName').textContent = currentDomain;
    }
    
    // Setup event listeners for buttons
    setupEventListeners();
    
    // Ensure the iframe can receive focus immediately for keyboard shortcuts
    if (document.body) {
        document.body.focus();
    }
    
    // Check if this domain should actually be blocked (skip check in study mode)
    if (!isStudyMode) {
        try {
            const domainCheck = await chrome.runtime.sendMessage({
                type: 'CHECK_DOMAIN_BLOCKING',
                domain: currentDomain
            });
            
            if (!domainCheck.blocked) {
                await redirectToOriginalUrl();
                return;
            }
        } catch (error) {
            console.error('Error checking domain status:', error);
        }
    }
    
    // Load the first card
    await loadNewCard();
}

// Setup all event listeners
function setupEventListeners() {
    const submitBtn = document.getElementById('submitBtn');
    const skipBtn = document.getElementById('skipBtn');
    const ttsButton = document.getElementById('ttsButton');
    
    if (submitBtn) {
        submitBtn.addEventListener('click', submitAnswer);
    }
    if (skipBtn) {
        skipBtn.addEventListener('click', skipCard);
    }
    if (ttsButton) {
        ttsButton.addEventListener('click', () => handleTTSClick('back'));
    }
    const ttsFrontButton = document.getElementById('ttsFrontButton');
    if (ttsFrontButton) {
        ttsFrontButton.addEventListener('click', () => handleTTSClick('front'));
    }
    
    // Setup difficulty feedback buttons
    const difficultyButtons = document.querySelectorAll('.difficulty-btn');
    difficultyButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const difficulty = btn.dataset.difficulty;
            handleDifficultyFeedback(difficulty);
        });
    });
    
    // Setup no-cards state buttons
    const addCardsBtn = document.getElementById('addCardsBtn');
    const proceedBtn = document.getElementById('proceedBtn');
    
    if (addCardsBtn) {
        addCardsBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
        });
    }
    
    if (proceedBtn) {
        proceedBtn.addEventListener('click', async () => {
            try {
                await chrome.runtime.sendMessage({
                    type: 'FORCE_UNBLOCK_DOMAIN',
                    domain: currentDomain
                });
                
                showFeedback('✅ Proceeding to website...', 'correct');
                
                // Notify parent frame (content script) that domain is unblocked
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({
                        type: 'DOMAIN_UNBLOCKED',
                        domain: currentDomain
                    }, '*');
                } else {
                    // If this is not in an iframe, redirect as before
                    setTimeout(async () => {
                        await redirectToOriginalUrl();
                    }, 500);
                }
            } catch (error) {
                console.error('Error force unblocking domain:', error);
                showFeedback('❌ Error proceeding to website', 'incorrect');
            }
        });
    }

    // Setup proceed to website button for incorrect answers
    const proceedToWebsiteBtn = document.getElementById('proceedToWebsiteBtn');
    if (proceedToWebsiteBtn) {
        proceedToWebsiteBtn.addEventListener('click', async () => {
            await handlePostFeedbackFlow();
        });
    }
    
    // Handle window focus
    window.addEventListener('focus', () => {
        const answerInput = document.getElementById('answerInput');
        if (answerInput && !answerInput.disabled) {
            answerInput.focus();
        }
    });

    // Handle keyboard shortcuts for difficulty feedback
    document.addEventListener('keydown', (e) => {
        // Only handle shortcuts when difficulty container is visible
        const difficultyContainer = document.getElementById('difficultyContainer');
        if (!difficultyContainer || difficultyContainer.style.display === 'none') {
            return;
        }

        // Map number keys to difficulty levels (like Anki)
        const keyToDifficulty = {
            '1': 'again',
            '2': 'hard', 
            '3': 'good',
            '4': 'easy'
        };

        const difficulty = keyToDifficulty[e.key];
        if (difficulty) {
            e.preventDefault();
            handleDifficultyFeedback(difficulty);
        }
    });

    // Handle keyboard shortcuts for submit button (show answer / answer submission)
    document.addEventListener('keydown', (e) => {
        // Only handle when submit button is visible and enabled
        const submitBtn = document.getElementById('submitBtn');
        const actionButtons = document.getElementById('actionButtons');
        
        if (!submitBtn || !actionButtons || 
            actionButtons.style.display === 'none' || 
            submitBtn.disabled) {
            return;
        }

        // Handle Space and Enter keys for submit
        if (e.key === ' ' || e.key === 'Enter') {
            // Don't interfere with input fields
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            
            e.preventDefault();
            submitAnswer();
        }
    });
}

// Check if TTS should be available for this card
async function checkTTSAvailability(card) {
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'CHECK_TTS_FOR_CARD',
            card: card
        });
        
        return {
            enabled: response && response.enabled,
            ttsTag: response && response.ttsTag,
            cardSide: response && response.cardSide
        };
    } catch (error) {
        console.error('Error checking TTS availability:', error);
        return { enabled: false, ttsTag: null };
    }
}

// Pre-load TTS audio DATA for instant playback
async function preloadTTSAudio(side = 'back') {
    if (!blockingCurrentCard || !window.ttsTag || isLoadingAudio) return;
    
    const ttsButton = side === 'front' 
        ? document.getElementById('ttsFrontButton')
        : document.getElementById('ttsButton');
    if (!ttsButton) return;
    
    isLoadingAudio = true;
    ttsButton.classList.add('downloading');
    
    try {
        const text = side === 'front' ? blockingCurrentCard.front : blockingCurrentCard.back;
        const response = await chrome.runtime.sendMessage({
            type: 'SYNTHESIZE_TTS',
            text: text,
            cardId: blockingCurrentCard.id,
            ttsTag: window.ttsTag
        });
        
        if (response.success && response.audio) {
            // Store RAW AUDIO DATA (not blob URL!)
            if (side === 'front') {
                preloadedFrontAudioData = new Uint8Array(response.audio);
            } else {
                preloadedAudioData = new Uint8Array(response.audio);
            }
            
            ttsButton.classList.remove('downloading');
            ttsButton.disabled = false;
        }
    } catch (error) {
        console.error(`[Blocked] Failed to pre-load TTS for ${side}:`, error);
        ttsButton.classList.remove('downloading');
        ttsButton.disabled = false; // Re-enable for retry
    } finally {
        isLoadingAudio = false;
    }
}

// Handle TTS button click - uses persistent HTML audio element (like Google Translate!)
function handleTTSClick(side = 'back') {
    const ttsButton = side === 'front' 
        ? document.getElementById('ttsFrontButton')
        : document.getElementById('ttsButton');
    const audio = document.getElementById('ttsAudio');
    const audioData = side === 'front' ? preloadedFrontAudioData : preloadedAudioData;
    const isPlaying = side === 'front' ? isFrontTTSPlaying : isTTSPlaying;
    
    if (isPlaying) {
        // Stop playing
        audio.pause();
        audio.currentTime = 0;
        if (side === 'front') {
            isFrontTTSPlaying = false;
        } else {
            isTTSPlaying = false;
        }
        ttsButton.classList.remove('playing');
        return;
    }
    
    if (!audioData) {
        console.error(`TTS: Button clicked but no ${side} audio data`);
        // Try to load it on demand
        preloadTTSAudio(side);
        return;
    }
    
    try {
        // Convert to base64 DATA URL (like Google Translate does!)
        let binary = '';
        const bytes = new Uint8Array(audioData);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const dataUrl = `data:audio/mp3;base64,${base64}`;
        
        // Set src on persistent audio element!
        audio.src = dataUrl;
        
        audio.onended = () => {
            if (side === 'front') {
                isFrontTTSPlaying = false;
            } else {
                isTTSPlaying = false;
            }
            ttsButton.classList.remove('playing');
        };
        
        audio.onerror = (e) => {
            console.error(`TTS ${side} audio error:`, e);
            if (side === 'front') {
                isFrontTTSPlaying = false;
            } else {
                isTTSPlaying = false;
            }
            ttsButton.classList.remove('playing');
        };
        
        ttsButton.classList.add('playing');
        if (side === 'front') {
            isFrontTTSPlaying = true;
        } else {
            isTTSPlaying = true;
        }
        
        // Play from persistent HTML element!
        audio.play().catch(error => {
            console.error(`TTS ${side} playback error:`, error);
            if (side === 'front') {
                isFrontTTSPlaying = false;
            } else {
                isTTSPlaying = false;
            }
            ttsButton.classList.remove('playing');
        });
    } catch (error) {
        console.error(`TTS ${side} error:`, error);
        if (side === 'front') {
            isFrontTTSPlaying = false;
        } else {
            isTTSPlaying = false;
        }
        ttsButton.classList.remove('playing');
    }
}

// Load a new card
async function loadNewCard() {
    try {
        // Clean up previous card's TTS audio
        preloadedAudioData = null;
        preloadedFrontAudioData = null;
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        isTTSPlaying = false;
        isFrontTTSPlaying = false;
        isLoadingAudio = false;
        
        setLoadingState(true);
        document.getElementById('feedback').style.display = 'none';
        hideElements(['difficultyContainer', 'proceedContainer']);
        showElements(['actionButtons']);
        
        // Clear any pending incorrect response
        window.pendingIncorrectResponse = null;
        
        // Reset submit button text
        document.getElementById('submitText').textContent = chrome.i18n.getMessage('submitAnswer');
        
        const response = await chrome.runtime.sendMessage({
            type: 'GET_RANDOM_CARD',
            domain: currentDomain,
            excludeIds: Array.from(usedCardIds)
        });
        
        if (response.success && response.card) {
            blockingCurrentCard = response.card;
            usedCardIds.add(blockingCurrentCard.id);
            
            const cardTextElement = document.getElementById('cardText');
            cardTextElement.innerHTML = `<div class="markdown-content">${safeMarkdownRender(blockingCurrentCard.front)}</div>`;
            
            // Resolve media URLs for images/audio in the card front
            await resolveMediaUrls(cardTextElement);
            
            // Store TTS availability for later (when answer is revealed)
            const ttsInfo = await checkTTSAvailability(blockingCurrentCard);
            window.ttsEnabled = ttsInfo.enabled;
            window.ttsTag = ttsInfo.ttsTag;
            window.ttsCardSide = ttsInfo.cardSide || 'back';
            
            // Show front TTS button if enabled and cardSide allows it
            const ttsFrontButton = document.getElementById('ttsFrontButton');
            if (ttsFrontButton && window.ttsEnabled && (window.ttsCardSide === 'front' || window.ttsCardSide === 'both')) {
                ttsFrontButton.style.display = 'flex';
                ttsFrontButton.disabled = true; // Will be enabled after preload
                // Preload front audio
                preloadTTSAudio('front');
            } else if (ttsFrontButton) {
                ttsFrontButton.style.display = 'none';
            }
            
            generateCardInterface(blockingCurrentCard);
            
            setLoadingState(false);
            
            // Focus appropriate element
            focusAnswerInput();
        } else if (response.success && response.noDueCards) {
            // No cards are due - show congratulations screen
            setLoadingState(false);
            showNoDueCardsState(response);
        } else {
            showNoCardsState();
        }
    } catch (error) {
        console.error('Error loading card:', error);
        showNoCardsState();
    }
}

// Focus the appropriate input element
function focusAnswerInput() {
    if (blockingCurrentCard?.type === 'cloze') {
        const clozeInput = document.getElementById('clozeAnswerInput');
        if (clozeInput) clozeInput.focus();
    } else if (blockingCurrentCard?.type === 'basic') {
        // For show answer cards, focus the submit button so keyboard shortcuts work immediately
        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn) {
            submitBtn.focus();
        }
    }
}

// Submit answer
async function submitAnswer() {
    // Special handling for basic-type cards (show answer type)
    if (blockingCurrentCard?.type === 'basic') {
        const hiddenInput = document.getElementById('show-answer-value');
        if (hiddenInput && hiddenInput.value === 'not-shown') {
            // Reveal the answer and let normal flow continue
            revealAnswer();
            hiddenInput.value = 'shown';
            // No early return - let it fall through to normal validation
        }
    }
    
    const answer = collectAnswer();
    
    if (!answer && blockingCurrentCard?.type !== 'basic') {
        showFeedback('Please provide an answer', 'incorrect');
        return;
    }
    
    if (!blockingCurrentCard) {
        showFeedback('No card loaded', 'incorrect');
        return;
    }
    
    try {
        setSubmitLoading(true);
        
        const response = await chrome.runtime.sendMessage({
            type: 'VALIDATE_ANSWER',
            answer: answer,
            card: blockingCurrentCard,
            domain: currentDomain
        });
        
        if (response.correct) {
            // Show appropriate message for show answer vs regular cards
            const message = blockingCurrentCard?.type === 'basic' 
                ? chrome.i18n.getMessage('answerShown')
                : chrome.i18n.getMessage('correctDifficulty');
            showFeedback(message, 'correct');
            
            pendingDifficultyFeedback = {
                cardId: blockingCurrentCard.id,
                answer: answer,
                correct: true,
                domain: currentDomain
            };
            
            // Update difficulty buttons with next occurrence times
            await updateDifficultyButtonsWithOccurrences();
            
            hideElements(['actionButtons']);
            showElements(['difficultyContainer']);
        } else {
            const correctAnswer = response.correctAnswer || blockingCurrentCard.back;
            
            // Show the correct answer in the clean answer section
            showCorrectAnswer(correctAnswer);
            
            // For basic/cloze card types, show answer but require proceed click
            showFeedback(chrome.i18n.getMessage('incorrectAnswerShownSimple'), 'incorrect');
            
            // Store the incorrect response to log when user clicks proceed
            window.pendingIncorrectResponse = {
                cardId: blockingCurrentCard.id,
                answer: answer,
                domain: currentDomain
            };
            
            hideElements(['actionButtons']);
            showElements(['proceedContainer']);
        }
    } catch (error) {
        console.error('Error validating answer:', error);
        showFeedback('Error validating answer. Please try again.', 'incorrect');
    } finally {
        setSubmitLoading(false);
    }
}

// Handle post-feedback flow
async function handlePostFeedbackFlow() {
    try {
        // First, handle any pending incorrect response
        if (window.pendingIncorrectResponse) {
            await logCardResponse(
                window.pendingIncorrectResponse.cardId,
                window.pendingIncorrectResponse.answer,
                false,
                'again'
            );
            window.pendingIncorrectResponse = null;
        }
        
        // In study mode, just load next card (no domain checking)
        if (isStudyMode) {
            await loadNewCard();
            return;
        }
        
        const domainCheck = await chrome.runtime.sendMessage({
            type: 'CHECK_DOMAIN_BLOCKING',
            domain: currentDomain
        });
        
        if (!domainCheck.blocked) {
            showFeedback('✅ Domain unblocked! You can now access the website.', 'correct');
            
            // Notify parent frame (content script) that domain is unblocked
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'DOMAIN_UNBLOCKED',
                    domain: currentDomain
                }, '*');
            } else {
                // Direct redirect without timeout
                await redirectToOriginalUrl();
            }
        } else {
            showFeedback('⏱️ Domain still in cooldown. Loading another card...', 'correct');
            await loadNewCard();
        }
    } catch (error) {
        console.error('Error checking domain after feedback:', error);
        if (!isStudyMode) {
            await redirectToOriginalUrl();
        }
    }
}

// Handle difficulty feedback selection
async function handleDifficultyFeedback(difficulty) {
    if (!pendingDifficultyFeedback) {
        console.error('No pending feedback data');
        return;
    }
    
    try {
        await logCardResponse(
            pendingDifficultyFeedback.cardId,
            pendingDifficultyFeedback.answer,
            pendingDifficultyFeedback.correct,
            difficulty
        );
        
        pendingDifficultyFeedback = null;
        showFeedback('✅ Response recorded! Checking domain access...', 'correct');
        
        // Hide difficulty container after feedback is recorded
        hideElements(['difficultyContainer']);
        
        await handlePostFeedbackFlow();
        
    } catch (error) {
        console.error('Error recording difficulty feedback:', error);
        showFeedback('Error recording feedback. Redirecting...', 'incorrect');
        await redirectToOriginalUrl();
    }
}

// Log card response with difficulty feedback
async function logCardResponse(cardId, answer, correct, difficulty) {
    try {
        const message = {
            type: 'LOG_CARD_RESPONSE',
            cardId: cardId,
            answer: answer,
            correct: correct,
            difficulty: difficulty,
            domain: currentDomain
        };
        
        // Include cloze deletion info if this is a cloze card
        if (blockingCurrentCard?.type === 'cloze' && blockingCurrentCard?.currentDeletion) {
            message.currentDeletion = blockingCurrentCard.currentDeletion;
        }
        
        await chrome.runtime.sendMessage(message);
    } catch (error) {
        console.error('Error logging card response:', error);
    }
}

// Clear answer inputs based on card type
function clearAnswerInputs() {
    if (!blockingCurrentCard) return;
    
    if (blockingCurrentCard.type === 'cloze') {
        const input = document.getElementById('clozeAnswerInput');
        if (input) {
            input.value = '';
            input.focus();
        }
    }
}

// Open study mode to review all due cards in a new tab
async function skipCard() {
    try {
        const studyUrl = chrome.runtime.getURL('blocked.html?mode=study');
        await chrome.tabs.create({ url: studyUrl });
    } catch (error) {
        console.error('Error opening study mode:', error);
        // Fallback: open in same tab if tabs API fails
        const studyUrl = chrome.runtime.getURL('blocked.html?mode=study');
        window.location.href = studyUrl;
    }
}

// Show feedback message
function showFeedback(message, type) {
    const feedback = document.getElementById('feedback');
    feedback.textContent = message;
    feedback.className = `feedback ${type}`;
    feedback.style.display = 'block';
}

// Set loading state for the page
function setLoadingState(loading) {
    const answerInput = document.getElementById('answerInput');
    const submitBtn = document.getElementById('submitBtn');
    const skipBtn = document.getElementById('skipBtn');
    
    if (answerInput) answerInput.disabled = loading;
    if (submitBtn) submitBtn.disabled = loading;
    if (skipBtn) skipBtn.disabled = loading;
    
}

// Set submit button loading state
function setSubmitLoading(loading) {
    const submitText = document.getElementById('submitText');
    const submitLoading = document.getElementById('submitLoading');
    const submitBtn = document.getElementById('submitBtn');
    
    if (loading) {
        if (submitText) submitText.style.display = 'none';
        if (submitLoading) submitLoading.style.display = 'inline-block';
        if (submitBtn) submitBtn.disabled = true;
    } else {
        if (submitText) submitText.style.display = 'inline';
        if (submitLoading) submitLoading.style.display = 'none';
        if (submitBtn) submitBtn.disabled = false;
    }
}

// Update difficulty times display above buttons (like Anki)
async function updateDifficultyButtonsWithOccurrences() {
    if (!blockingCurrentCard) {
        return;
    }
    
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'GET_NEXT_OCCURRENCES',
            card: blockingCurrentCard
        });
        
        if (response.success && response.data) {
            const occurrences = response.data;
            
            // Update time display elements above buttons
            document.getElementById('timeAgain').textContent = occurrences.again;
            document.getElementById('timeHard').textContent = occurrences.hard;
            document.getElementById('timeGood').textContent = occurrences.good;
            document.getElementById('timeEasy').textContent = occurrences.easy;
        }
    } catch (error) {
        console.error('Error updating difficulty times:', error);
        // Fallback: keep default times shown
    }
}

// Helper functions to show/hide elements
function hideElements(elementIds) {
    elementIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });
}

function showElements(elementIds) {
    elementIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'block';
    });
}

// Show no cards available state
function showNoCardsState() {
    hideElements(['cardContainer', 'actionButtons', 'difficultyContainer', 'feedback', 'inputContainer']);
    showElements(['noCardsContainer']);
    
    // Update message for when no cards exist at all
    const messageElement = document.querySelector('.no-cards-message');
    if (messageElement) {
        messageElement.innerHTML = `
            <h3>📚 No Cards Available</h3>
            <p>You haven't created any cards yet. Add some cards to start learning!</p>
        `;
    }
}

function showNoDueCardsState(response) {
    hideElements(['cardContainer', 'actionButtons', 'difficultyContainer', 'feedback', 'inputContainer']);
    showElements(['noCardsContainer']);
    
    // Update message for when all cards are up to date
    const messageElement = document.querySelector('.no-cards-message');
    if (messageElement) {
        if (response.noCardsExist) {
            messageElement.innerHTML = `
                <h3>📚 No Cards Available</h3>
                <p>You haven't created any cards yet. Add some cards to start learning!</p>
            `;
        } else {
            // Different message for study mode
            if (isStudyMode) {
                messageElement.innerHTML = `
                    <h3>All done! ✅</h3>
                    <p>${response.message || 'Great job! All your cards are up to date according to spaced repetition scheduling.'}</p>
                `;
            } else {
                messageElement.innerHTML = `
                    <h3>🎉 All Caught Up!</h3>
                    <p>${response.message || 'Great job! All your cards are up to date according to spaced repetition scheduling.'}</p>
                    <p style="margin-top: 0.5rem; color: #9aa0a6; font-size: 0.875rem;">You can proceed to the website or add more cards if you'd like to continue learning.</p>
                `;
            }
        }
    }
    
    // Update button text and visibility based on mode
    const addCardsBtn = document.getElementById('addCardsBtn');
    const proceedBtn = document.getElementById('proceedBtn');
    
    if (isStudyMode) {
        // In study mode, hide buttons - user just closes the tab
        if (addCardsBtn) addCardsBtn.style.display = 'none';
        if (proceedBtn) proceedBtn.style.display = 'none';
    } else {
        if (response.noCardsExist) {
            if (addCardsBtn) addCardsBtn.textContent = chrome.i18n.getMessage('addYourFirstCard');
            if (proceedBtn) proceedBtn.textContent = chrome.i18n.getMessage('proceedAnyway');
        } else {
            if (addCardsBtn) addCardsBtn.textContent = chrome.i18n.getMessage('addMoreCards');
            if (proceedBtn) proceedBtn.textContent = chrome.i18n.getMessage('proceedToWebsite');
        }
    }
}

// Handle Enter key press and initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize i18n translations
    initializeI18n();
    
    // Add Enter key handler for text inputs only
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const answerInput = document.getElementById('answerInput');
            if (answerInput && document.activeElement === answerInput) {
                submitAnswer();
            }
        }
    });
    
    // Initialize the page
    init();
}); 