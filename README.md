# MagMed (Expo + iOS)

MagMed is an Expo/React Native iPhone app that makes small medicine-label text easier to use. The original SwiftUI prototype remains in `MagMed/`; the Expo app is the primary runnable target.

## What it does

- Takes a label photo with the camera or imports one from Photos.
- Uses native Google ML Kit to recognize text on-device, including word-level positions.
- Supports pinch zoom, panning, and touch/swipe word selection on the original label.
- Uses Gemini to translate a selected word into Korean beside the label.
- Uses Gemini structured output to organize directions, ingredients, uses, warnings, storage, and remaining text into readable cards.

## Run it

1. Run `npm install`.
2. Copy `.env.example` to `.env` and replace the placeholder with a Gemini API key from Google AI Studio.
3. Connect and unlock an iPhone, then run:

   ```sh
   npx expo run:ios --device
   ```

4. Choose the device and signing team when Expo asks. Later runs reuse that selection.

The app targets iOS 16.4 or newer. A real device is needed to test the camera. If Gemini is not configured or temporarily unavailable, label OCR still works and the app falls back to local label organization and a small medicine-term dictionary.

`EXPO_PUBLIC_` variables are compiled into the client and are appropriate only for development. Before distributing the app, proxy Gemini calls through an authenticated backend and keep the production API key there.

The Gemini prompt is constrained to organize explicit label facts without inventing dosage advice. Users should still verify important details against the original package and their clinician's instructions.
