# Summarizing Conversations

Create AI-powered summaries of audio segments directly from the timeline interface.

## How to Create a Summary

### 1. Select a Time Range

Click and drag on the **date axis** area of the timeline (where days/dates are displayed) to select a time segment:

1. Click and hold on the date axis
2. Drag horizontally to select your desired time range
3. Release to confirm the selection

### 2. Open the Summarize Dialog

Once you've selected a segment **shorter than 24 hours**, a **magic wand icon** will appear in the top-left corner.

Click this icon to open the summarization dialog.

### 3. Choose or Customize a Prompt

In the summarization dialog:

- **Select a model** from the dropdown list of available models (recommended: `llama-3.3-70b-instruct`)
- **Select a prompt** from the dropdown list of saved prompts
- **Edit the prompt** directly in the text area if needed
- The prompt will be applied to the transcribed audio from your selected time range

### 4. Generate Summary

Click **Apply** to generate the summary. The AI will process the audio transcription from the selected segment and return a summary based on your prompt.

## Summarizing Existing Conversations

If you have an existing conversation object (marked with "Is Conversation"):

1. Open the conversation object
2. **Clear the Details field** - delete any existing description text
3. A **magic wand icon** (✨) will appear in the bottom-right corner of the empty Details field
4. Click the magic wand to open the summarization dialog
5. The conversation's time range will be used automatically
6. Select a prompt and click Apply to generate a summary

The generated summary will be filled into the Details field.

## Creating Custom Prompts

To create and manage prompts for summarization:

1. Go to **Settings** → **Prompts** (`/settings/prompts`)
2. Click **New Prompt** button in the Prompt Library section
3. Fill in:
   - **Name**: A descriptive name for your prompt
   - **Description**: Optional explanation of what this prompt does
   - **Text**: The actual prompt text (can include placeholders)
4. Save the prompt

Your new prompt will appear in the dropdown list when summarizing conversations.

## Related Files

- `frontend/src/components/dialogs/SummarizeDialog.tsx` - Summarization dialog component
- `frontend/src/pages/TimelinePage.tsx` - Timeline interface with selection handling
- `frontend/src/modules/time/index.tsx` - Time range selection tools

## How to add a new Summary

1. Open an existing conversation

2. Click the "Generate Summary" button

3. Select a model and prompt

4. Click "Apply"

5. The summary will be generated and displayed in the conversation object