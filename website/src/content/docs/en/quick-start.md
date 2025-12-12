---
title: Welcome to Rekapu!
description: Get started with Rekapu in 3 simple steps
section: getting-started
order: 1
---

# Welcome to Rekapu! 🎉

Thank you for installing Rekapu! Let's get you set up to start learning while browsing.

## Step 1: Pin the Extension to Your Toolbar

For easy access to Rekapu, we recommend pinning it to your toolbar:

<img src="/onboarding/pin_to_taskbar.webp" alt="Pin to toolbar" class="screenshot" width="400" />

1. Click the **Extensions** puzzle icon in your browser toolbar
2. Find **Rekapu** in the list
3. Click the **pin icon** next to Rekapu

Now you can quickly access your cards and settings anytime!

## Step 2: Add Websites to Block

Block distracting websites and turn them into learning opportunities.

### Quick Block (Fastest Way!)

<img src="/onboarding/quick_block.webp" alt="Quick block button" class="screenshot" width="400" />

1. Navigate to any website you want to block
2. Click the **Rekapu icon** in your toolbar
3. Click the green **"Block [domain]"** button
4. Configure cooldown period (how long the site stays accessible after answering a card)
5. Click **Block Site**

That's it! The site is now blocked.

### Manual Domain Addition

<img src="/onboarding/add_domain.webp" alt="Add domain manually" class="screenshot" width="400" />

You can also manually add domains:

1. Click the **Rekapu icon** in your toolbar
2. Go to the **Domains** tab
3. Enter domain(s) - you can add multiple at once separated by commas or newlines (e.g., `twitter.com, reddit.com` or one per line)
4. Set a cooldown period
5. Click **Add Domain**

> **Tip:** Start with 1-2 sites you check frequently but don't need for work. You can always add more later!
>
> **Note:** Only unblocked domains can be removed from the block list. Go to the Domains tab and click the delete button next to any unblocked domain.

## Step 3: Create Your First Cards

Rekapu uses flashcards to help you learn. Here are three ways to create cards:

### Option 1: Import from Anki

Already have Anki decks? Import them instantly!

Rekapu supports importing `.apkg` files directly:

1. Click the Rekapu icon → **Import** tab

<img src="/onboarding/anki_import_pt1.webp" alt="Anki import step 1" class="screenshot" width="300" />

2. Click **Import from Anki (.apkg)** and select your .apkg file

<img src="/onboarding/anki_import_pt2.webp" alt="Anki import step 2" class="screenshot" width="350" />

3. Review your imported cards

<img src="/onboarding/anki_import_pt3.webp" alt="Anki import step 3" class="screenshot" width="400" />

4. Your cards are ready to use!

You can also import shared Anki decks:
- Visit <a href="https://ankiweb.net/shared/decks" target="_blank" rel="noopener noreferrer nofollow">AnkiWeb Shared Decks</a>
- Download a deck that interests you (.apkg format)
- Import it into Rekapu using the steps above

> **Note:** Rekapu supports basic Anki card types. Complex card templates may need adjustment.

### Option 2: Quick Capture from Text

<img src="/onboarding/add_selection.webp" alt="Add selection as card" class="screenshot" width="500" />

1. Select any text on a webpage
2. Right-click and choose **"Add selection as card"**
3. Edit the card in the dashboard that opens
4. Save your card

### Option 3: Quick Add from Popup

<img src="/onboarding/quick_add.webp" alt="Quick add card" class="screenshot" width="400" />

1. Click the **Rekapu icon** in your toolbar
2. Click **"Add Card"** button
3. Fill in front and back of your card in the dashboard that opens
4. Add tags to organize your cards (optional)
5. Click **Save**

## Card Types Supported

- **Basic (Show Answer):** Traditional flashcard with front/back
- **Cloze Deletion:** Fill-in-the-blank cards using `{{c1::answer}}` syntax

## Study Without Distractions

<img src="/onboarding/quick_study.webp" alt="Study all cards" class="screenshot" width="400" />

You can also study all your cards without visiting blocked sites:

1. Click the **Rekapu icon** in your toolbar
2. Click **"Study Due Cards"** button
3. Go through all your due cards in a focused session
4. All blocked sites become accessible when you're done

## Next Steps

You're all set! Here's what happens next:

1. **Visit a blocked site** - You'll see a card overlay
2. **Answer the card** - Rate how well you knew it (Again, Hard, Good, Easy)
3. **Access granted** - The site unlocks for your cooldown period
4. **Repeat & Learn** - Rekapu uses spaced repetition to optimize your learning

## Frequently Asked Questions

### How many cards should I create?
Start with 10-20 quality cards. It's better to have fewer well-crafted cards than many low-quality ones.

### What if I have no cards due?
If you're caught up on all your cards, Rekapu will show you a congratulatory message and let you through without blocking.

### Is my data private?
Absolutely! All your cards and data are stored locally in your browser. Nothing is sent to any server.


### How does the cooldown work?
After answering a card, the blocked site becomes accessible for a set period (e.g., 30 minutes). This gives you time to use the site without constant interruptions.

Happy learning! 🚀

<style>
.screenshot {
  cursor: pointer;
  transition: transform 0.2s;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  display: block;
  margin: 1rem 0;
}
.screenshot:hover {
  transform: scale(1.02);
}
.screenshot.fullsize {
  width: 100% !important;
  max-width: none;
}
</style>

<script>
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.screenshot').forEach(img => {
    img.addEventListener('click', () => {
      img.classList.toggle('fullsize');
    });
  });
});
</script>
